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

export async function POST(request: NextRequest) {
  const session = await getSession()
  if (!session) return new Response('Unauthorized', { status: 401 })

  const { messages: uiMessages, slug, contextTaskId } = await request.json() as { messages: UIMessage[]; slug: string; contextTaskId?: string }

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

  const systemPrompt = `Jesteś asystentem AI w portalu klienta agencji important.is (agencji digital/webowej).
Twoim jedynym zadaniem jest zebranie kompletnych informacji i stworzenie dobrze opisanego zadania w systemie.

Portal: ${portal[0].name}
Dostępne listy: ${lists.map(l => `${l.displayName} (id: ${l.clickupListId})`).join(', ')}
Domyślna lista: ${defaultList?.displayName ?? 'brak'}
Dzisiaj jest: ${today}

## ZASADA NADRZĘDNA
Zadanie może zostać stworzone TYLKO gdy masz wystarczający kontekst, żeby wykonawca mógł je zrealizować BEZ żadnych dodatkowych pytań do klienta. Brak informacji = niewykonalne zadanie = strata czasu klienta i agencji.

## CO MUSISZ ZEBRAĆ (w zależności od typu zadania)

### Zadania techniczne / serwerowe / hostingowe
WYMAGANE: obecny serwer/hosting (nazwa, panel np. cPanel/Coolify/Hetzner), docelowy serwer/hosting, co przenosić (pliki+baza? tylko pliki? maile?), adres strony/domeny, dane dostępowe LUB potwierdzenie gdzie są (np. "dane są w LastPass"), dodatkowe wymagania (SSL, przekierowania, czas przestoju)

### Zadania dotyczące strony www / zmian treści
WYMAGANE: konkretny URL strony, co dokładnie zmienić (stary tekst → nowy tekst, lub opis zmiany), grafiki/materiały (czy klient ma czy agencja ma przygotować), gdzie materiały są dostępne

### Zadania projektowe / graficzne
WYMAGANE: format i rozmiary, cel/gdzie będzie użyte, styl (referencje, brand guidelines), materiały wejściowe, deadline

### Zadania kampanie / marketing / reklamy
WYMAGANE: platforma (Meta/Google/etc.), budżet, cel kampanii, grupa docelowa, materiały reklamowe (czy gotowe czy do przygotowania)

### Inne zadania
WYMAGANE: kontekst wystarczający żeby wykonawca wiedział co, jak i gdzie

## JAK PYTAĆ
- Zadaj WSZYSTKIE brakujące pytania naraz, w jednej wiadomości — nie pytaj o jedno na raz
- Grupuj pytania logicznie (np. "Żeby dobrze opisać zadanie, potrzebuję kilku informacji:")
- Używaj listy numerowanej, max 5 pytań naraz
- Jeśli klient podał termin jako dzień tygodnia ("do poniedziałku"), przelicz na konkretną datę używając dzisiejszej daty i zapisz w due_date_days
- Jeśli klient mówi "pilne" bez terminu, zapytaj o konkretny deadline

## FORMAT OPISU ZADANIA (opis musi być po polsku, strukturalny)
Gdy masz wszystkie informacje, utwórz zadanie z opisem w tym formacie:

\`\`\`
## Opis
[Co trzeba zrobić — 2-3 zdania]

## Szczegóły techniczne / kontekst
[Wszystkie zebrane informacje: URL, serwer źródłowy, docelowy, co migrować, itp.]

## Materiały i dostępy
[Gdzie są dane dostępowe, linki, pliki, grafiki]

## Wymagania dodatkowe
[SSL, przekierowania, czas przestoju, inne warunki — lub "brak"]

## Zgłaszający
[Klient portalu ${portal[0].name}]
\`\`\`

## KIEDY TWORZYĆ ZADANIE
Stwórz zadanie gdy:
✅ Wiesz CO konkretnie trzeba zrobić
✅ Wiesz NA CZYM / GDZIE (URL, serwer, platforma)
✅ Wiesz skąd wziąć materiały/dostępy (lub klient potwierdził że dostarczy przed realizacją)
✅ Masz termin lub klient powiedział że termin nie jest ważny

NIE twórz zadania gdy:
❌ Brakuje danych dostępowych i klient nie powiedział gdzie są
❌ Nie wiesz co dokładnie zmienić / przenieść
❌ Opis zadania byłby niewystarczający do wykonania bez dodatkowych pytań

Odpowiadaj TYLKO po polsku. Bądź konkretny i pomocny. Nie lej wody.

## KONTEKST AKTUALNIE OTWARTEGO ZADANIA
${contextTaskId
  ? `Klient ma otwarte zadanie ID: ${contextTaskId}. Gdy pyta o status, postęp, komentarze lub cokolwiek związanego z tym zadaniem — użyj narzędzia getTaskInfo żeby pobrać aktualne dane, a następnie odpowiedz rzeczowo, grzecznie i dyplomatycznie.`
  : 'Brak otwartego zadania — klient chce zgłosić nowe lub pyta ogólnie.'
}`

  const result = streamText({
    model: getModel(),
    system: systemPrompt,
    messages,
    stopWhen: isStepCount(5),
    tools: {
      getTaskInfo: tool({
        description: 'Pobiera aktualne informacje o zadaniu: status, opis, komentarze publiczne. Używaj gdy klient pyta o postęp, status lub co się dzieje z zadaniem.',
        inputSchema: z.object({
          taskId: z.string().describe('ID zadania z kontekstu'),
        }),
        execute: async ({ taskId }) => {
          const belongs = await verifyTaskBelongsToFolder(taskId, portal[0].clickupFolderId)
          if (!belongs) return { error: 'Brak dostępu do tego zadania' }

          const [task, allComments] = await Promise.all([
            getTask(taskId),
            getTaskComments(taskId),
          ])

          const PUBLIC_PREFIX = '[PUBLIC] '
          const publicComments = allComments
            .filter(c => c.comment_text?.startsWith(PUBLIC_PREFIX))
            .map(c => ({
              author: c.user?.username ?? 'Agencja',
              text: c.comment_text!.slice(PUBLIC_PREFIX.length),
              date: c.date,
            }))

          return {
            name: task.name,
            status: task.status.status,
            priority: task.priority?.priority ?? 'brak',
            description: task.description ?? 'brak opisu',
            due_date: task.date_due ? new Date(Number(task.date_due)).toLocaleDateString('pl-PL') : 'brak',
            publicComments,
            subtasks: task.subtasks?.map(s => ({
              name: s.name,
              status: s.status.status,
            })) ?? [],
          }
        },
      }),
      createTask: tool({
        description: 'Tworzy nowe zadanie w ClickUp. Wywołaj TYLKO gdy zebrałeś kompletny briefing. Opis musi zawierać WSZYSTKIE informacje potrzebne do wykonania.',
        inputSchema: z.object({
          name: z.string().describe('Zwięzła nazwa zadania (max 80 znaków), np. "Przeniesienie strony wodadlafirmy.pl na serwer Hetzner"'),
          description: z.string().describe('Pełny briefing w formacie Markdown ze wszystkimi zebranymi informacjami: co zrobić, gdzie, skąd, dane dostępowe/gdzie są, wymagania. Minimum 100 znaków.'),
          priority: z.number().min(1).max(4).describe('Priorytet: 1=pilne, 2=wysokie, 3=normalne, 4=niskie'),
          listId: z.string().optional().describe('ID listy — tylko gdy klient wskazał konkretną listę'),
          due_date_days: z.number().optional().describe('Za ile dni od dziś jest termin (np. "do poniedziałku" = przelicz na dni). Zostaw puste gdy brak terminu.'),
        }),
        execute: async ({ name, description, priority, listId, due_date_days }) => {
          // Security: listId must be from this portal's lists only
          const targetListId = listId && lists.some(l => l.clickupListId === listId)
            ? listId
            : (defaultList?.clickupListId ?? '')

          if (!targetListId) return { error: 'Brak skonfigurowanej listy' }

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
            message: `✅ Zadanie "${task.name}" zostało dodane.`,
          }
        },
      }),
    },
  })

  return result.toUIMessageStreamResponse()
}
