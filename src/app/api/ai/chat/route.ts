import { streamText, tool, isStepCount, convertToModelMessages, type UIMessage } from 'ai'
import { createGoogleGenerativeAI } from '@ai-sdk/google'
import { createAnthropic } from '@ai-sdk/anthropic'
import { z } from 'zod'
import { NextRequest } from 'next/server'
import { getSession } from '@/lib/auth'
import { db } from '@/lib/db'
import { portals, portalLists } from '@/lib/db/schema'
import { eq } from 'drizzle-orm'
import { createTask } from '@/lib/clickup'

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


export async function POST(request: NextRequest) {
  const { messages: uiMessages, slug, mode } = await request.json() as {
    messages: UIMessage[]
    slug: string
    mode?: string
  }

  // Only new-task mode is active — other modes are disabled
  if (mode !== 'new-task') {
    return new Response('This AI feature is not available', { status: 403 })
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
    system: NEW_TASK_PROMPT,
    messages,
    stopWhen: isStepCount(6),
    tools: { createTask: createTaskTool },
  })

  return result.toUIMessageStreamResponse()
}
