import { streamText, tool, isStepCount, convertToModelMessages, type UIMessage } from 'ai'
import { createGoogleGenerativeAI } from '@ai-sdk/google'
import { createAnthropic } from '@ai-sdk/anthropic'
import { z } from 'zod'
import { NextRequest } from 'next/server'
import { getSession } from '@/lib/auth'
import { db } from '@/lib/db'
import { portals, portalLists } from '@/lib/db/schema'
import { eq } from 'drizzle-orm'
import { createTask, getTask, getTaskComments, verifyTaskBelongsToFolder } from '@/lib/clickup'

export const runtime = 'nodejs'
export const maxDuration = 30

function getModel() {
  const provider = process.env.AI_PROVIDER ?? 'gemini'
  if (provider === 'anthropic') {
    const anthropic = createAnthropic({ apiKey: process.env.ANTHROPIC_API_KEY })
    return anthropic('claude-haiku-4-5')
  }
  const google = createGoogleGenerativeAI({ apiKey: process.env.GOOGLE_GENERATIVE_AI_API_KEY })
  return google('gemini-2.5-flash')
}

const PUBLIC_PREFIX = '[PUBLIC] '
const CLIENT_NAME_RE = /^\(([^)]+)\) /

function parsePublicComments(allComments: Awaited<ReturnType<typeof getTaskComments>>) {
  return allComments
    .filter(c => c.comment_text?.startsWith(PUBLIC_PREFIX))
    .map(c => {
      const withoutPrefix = c.comment_text!.slice(PUBLIC_PREFIX.length)
      const clientMatch = withoutPrefix.match(CLIENT_NAME_RE)
      return {
        author: clientMatch ? clientMatch[1] : 'Important.is',
        text: clientMatch ? withoutPrefix.slice(clientMatch[0].length) : withoutPrefix,
        date: c.date ? new Date(Number(c.date)).toLocaleDateString('pl-PL') : '',
      }
    })
}

export async function POST(request: NextRequest) {
  const { messages: uiMessages, slug, contextTaskId, mode } = await request.json() as {
    messages: UIMessage[]
    slug: string
    contextTaskId?: string
    mode?: 'new-task' | 'task' | 'general'
  }

  const session = await getSession(slug)
  if (!session) return new Response('Unauthorized', { status: 401 })
  if (session.portalSlug !== slug) return new Response('Forbidden', { status: 403 })

  const messages = await convertToModelMessages(uiMessages)

  const portal = await db.select().from(portals).where(eq(portals.slug, slug)).limit(1)
  if (!portal[0]) return new Response('Not found', { status: 404 })

  const lists = await db
    .select()
    .from(portalLists)
    .where(eq(portalLists.portalId, portal[0].id))
    .orderBy(portalLists.sortOrder)

  const defaultList = lists.find(l => l.isDefault) ?? lists[0]
  const today = new Date().toLocaleDateString('pl-PL', { weekday: 'long', year: 'numeric', month: 'long', day: 'numeric' })

  // Determine effective mode
  const effectiveMode: 'new-task' | 'task' | 'general' =
    contextTaskId ? 'task' : (mode === 'new-task' ? 'new-task' : 'general')

  // Pre-load task data for task mode (so AI can answer immediately without tool call)
  type TaskData = {
    name: string; status: string; priority: string; description: string; due_date: string
    publicComments: Array<{ author: string; text: string; date: string }>
    subtasks: Array<{ name: string; status: string }>
  }
  let taskData: TaskData | null = null

  if (effectiveMode === 'task' && contextTaskId) {
    try {
      const belongs = await verifyTaskBelongsToFolder(contextTaskId, portal[0].clickupFolderId)
      if (belongs) {
        const [task, allComments] = await Promise.all([
          getTask(contextTaskId),
          getTaskComments(contextTaskId),
        ])
        taskData = {
          name: task.name,
          status: task.status.status,
          priority: task.priority?.priority ?? 'brak',
          description: task.description ?? 'brak opisu',
          due_date: task.date_due ? new Date(Number(task.date_due)).toLocaleDateString('pl-PL') : 'brak',
          publicComments: parsePublicComments(allComments),
          subtasks: task.subtasks?.map(s => ({ name: s.name, status: s.status.status })) ?? [],
        }
      }
    } catch {
      // proceed without preloaded data, AI will use getTaskInfo tool
    }
  }

  // ── SYSTEM PROMPTS ────────────────────────────────────────────────────────

  const NEW_TASK_PROMPT = `Jesteś Asią — asystentką agencji important.is, która pomaga klientom zgłaszać zadania. Rozmawiasz jak człowiek, nie jak formularz.

Portal klienta: ${portal[0].name}
Dzisiaj: ${today}

## JAK ROZMAWIASZ

Prowadzisz luźną, naturalną rozmowę. Zadajesz **jedno pytanie na raz** — tak jak zrobiłaby to osoba przez WhatsApp. Nie piszesz list numerowanych, nie pokazujesz pól formularza. Kiedy masz odpowiedź — drążysz dalej jednym pytaniem.

Przykład dobrego zachowania:
- Klient: "nie działa przycisk dodaj do koszyka"
- Ty: "a na jakiej stronie? wklej linka jeśli możesz"
- Klient: "sklep.pl/produkty"
- Ty: "rozumiem. co dokładnie się dzieje gdy klikasz? button jest nieaktywny, pojawia się błąd, coś innego?"
- Klient: "w ogóle nic się nie dzieje"
- Ty: "ok. to ważne dla sklepu — wchodzę z tym jako priorytet wysoki. na kiedy potrzebujesz żeby było naprawione?"
- Klient: "najlepiej na pojutrze"
- Ty: "dobra, zgłaszam. zadanie pojawi się za chwilę na tablicy" [TWORZYSZ ZADANIE]

## CO MUSISZ WIEDZIEĆ ZANIM STWORZYSZ ZADANIE

Zbieraj przez rozmowę — po jednym pytaniu:
- **Co** — opis problemu lub zlecenia (już z pierwszej wiadomości klienta)
- **Gdzie** — URL, strona, platforma, serwer
- **Kontekst** — co dokładnie się dzieje / co zmienić / jak to wygląda teraz
- **Termin** — kiedy ma być gotowe (jeśli klient nie mówi, zapytaj raz; jeśli mówi "nie wiem" — OK, tworzysz bez terminu)
- **Priorytet** — wywniosku sam z kontekstu:
  - "na jutro" / "ASAP" / problem blokujący klientów = pilne (1)
  - "ważne" / "chcemy szybko" = wysokie (2)
  - brak wskazówek / "jak będzie czas" = normalne (3)
  - "kiedyś" / "nie spieszy się" = niskie (4)

Nie pytaj o priorytet wprost — określ go sam na podstawie rozmowy.
Nie pytaj o "Definition of Done" — opisz go sam na podstawie zgłoszenia.
Nie pytaj o materiały jeśli zadanie ich nie wymaga (np. naprawa buga).

## KIEDY TWORZYĆ

Twórz zadanie gdy wiesz: CO, GDZIE, i jakie są szczegóły. Termin jest opcjonalny.
Jeśli brakuje URL lub kluczowego kontekstu — zapytaj raz. Jeśli klient mówi "nie wiem" albo "nie ma" — twórz bez tego.
Nie przeciągaj rozmowy. Maksymalnie 4-5 pytań łącznie.

## FORMAT OPISU (wypełnij sam, klient tego nie widzi)

## Cel zadania
[Co ma być zrobione i po co]

## Szczegóły
[URL, platforma, co dokładnie się dzieje / co zmienić]

## Termin i priorytet
[Termin słownie + uzasadnienie priorytetu]

## Zgłaszający
Klient: ${portal[0].name}

Odpowiadaj TYLKO po polsku. Pisz krótko — jak SMS, nie jak mail.`

  const TASK_PROMPT = taskData
    ? `Jesteś asystentem który odpowiada na pytania klienta dotyczące konkretnego zadania w agencji important.is.

## DANE ZADANIA (pobrane właśnie z ClickUp — aktualne na tę chwilę)

**Nazwa:** ${taskData.name}
**Status:** ${taskData.status}
**Priorytet:** ${taskData.priority}
**Termin:** ${taskData.due_date}

**Opis zadania:**
${taskData.description}

**Podzadania (${taskData.subtasks.length}):**
${taskData.subtasks.length > 0
  ? taskData.subtasks.map(s => `- ${s.name} [${s.status}]`).join('\n')
  : 'brak podzadań'}

**Komentarze publiczne (${taskData.publicComments.length}):**
${taskData.publicComments.length > 0
  ? taskData.publicComments.map(c => `[${c.date}] ${c.author}: ${c.text}`).join('\n')
  : 'Brak komentarzy publicznych — agencja jeszcze nie dodała wiadomości dla klienta.'}

## ZASADY ODPOWIADANIA
- Odpowiadaj na podstawie danych powyżej — masz aktualne informacje
- Jeśli klient pyta "czy to gotowe dziś/kiedy skończą" — mówisz że nie wiesz, ale możesz zasugerować żeby napisał komentarz do zadania w zakładce "Szczegóły"
- Bądź dyplomatyczny — nie oceniaj pracy agencji, nie obiecuj terminów
- Jeśli klient chce "sprawdzić co nowego" — użyj narzędzia getTaskInfo żeby odświeżyć dane
- Odpowiadaj krótko i rzeczowo, bez zbędnych wstępów

Odpowiadaj TYLKO po polsku.`
    : `Jesteś asystentem który odpowiada na pytania klienta dotyczące zadania ID: ${contextTaskId}.
Użyj narzędzia getTaskInfo żeby pobrać dane zadania, a następnie odpowiedz na pytanie klienta.
Bądź dyplomatyczny i pomocny. Odpowiadaj TYLKO po polsku.`

  const GENERAL_PROMPT = `Jesteś asystentem AI w portalu klienta agencji important.is.

Portal: ${portal[0].name}
Dzisiaj: ${today}

Możesz:
1. Odpowiadać na pytania o projekty i współpracę z agencją
2. Pomagać zgłosić nowe zadanie gdy klient o to poprosi

Jeśli klient chce zgłosić zadanie — zbierz kompletne informacje (co, gdzie, kiedy, priorytet, materiały) zanim je stworzysz. Opis jest obowiązkowy.

Odpowiadaj TYLKO po polsku. Bądź konkretny i pomocny.`

  const systemPrompt = effectiveMode === 'new-task'
    ? NEW_TASK_PROMPT
    : effectiveMode === 'task'
    ? TASK_PROMPT
    : GENERAL_PROMPT

  // Tools per mode
  const getTaskInfoTool = tool({
    description: 'Pobiera aktualne informacje o zadaniu z ClickUp: status, opis, podzadania, komentarze publiczne. Użyj gdy klient pyta o najnowszy stan zadania.',
    inputSchema: z.object({
      taskId: z.string(),
    }),
    execute: async ({ taskId }) => {
      const belongs = await verifyTaskBelongsToFolder(taskId, portal[0].clickupFolderId)
      if (!belongs) return { error: 'Brak dostępu do tego zadania' }

      const [task, allComments] = await Promise.all([
        getTask(taskId),
        getTaskComments(taskId),
      ])

      return {
        name: task.name,
        status: task.status.status,
        priority: task.priority?.priority ?? 'brak',
        description: task.description ?? 'brak opisu',
        due_date: task.date_due ? new Date(Number(task.date_due)).toLocaleDateString('pl-PL') : 'brak',
        publicComments: parsePublicComments(allComments),
        subtasks: task.subtasks?.map(s => ({ name: s.name, status: s.status.status })) ?? [],
      }
    },
  })

  const createTaskTool = tool({
    description: 'Tworzy nowe zadanie w ClickUp. Wywołaj TYLKO gdy masz kompletny briefing (nazwa, pełny opis z kontekstem, priorytet). Opis musi mieć min. 100 znaków.',
    inputSchema: z.object({
      name: z.string().describe('Zwięzła nazwa zadania, max 80 znaków'),
      description: z.string().min(100).describe('Pełny opis w Markdown: cel, kontekst, materiały, DoD, zgłaszający'),
      priority: z.number().min(1).max(4).describe('1=pilne, 2=wysokie, 3=normalne, 4=niskie'),
      listId: z.string().optional().describe('ID listy — zostaw puste żeby użyć domyślnej'),
      due_date_days: z.number().optional().describe('Za ile dni od dziś jest termin'),
    }),
    execute: async ({ name, description, priority, listId, due_date_days }) => {
      const targetListId = listId && lists.some(l => l.clickupListId === listId)
        ? listId
        : (defaultList?.clickupListId ?? '')

      if (!targetListId) return { error: 'Brak skonfigurowanej listy w portalu' }

      const due_date = due_date_days
        ? Date.now() + due_date_days * 24 * 60 * 60 * 1000
        : undefined

      const task = await createTask(targetListId, {
        name,
        description,
        priority: priority ?? null,
        due_date: due_date ?? null,
      })

      return {
        success: true,
        taskId: task.id,
        taskName: task.name,
        message: `✅ Zadanie "${task.name}" zostało dodane do systemu. Możesz zamknąć to okno — zadanie pojawi się na tablicy po odświeżeniu.`,
      }
    },
  })

  const result = streamText({
    model: getModel(),
    system: systemPrompt,
    messages,
    stopWhen: isStepCount(6),
    tools: effectiveMode === 'task'
      ? { getTaskInfo: getTaskInfoTool }
      : effectiveMode === 'new-task'
      ? { createTask: createTaskTool }
      : { createTask: createTaskTool, getTaskInfo: getTaskInfoTool },
  })

  return result.toUIMessageStreamResponse()
}
