import { streamText, tool, isStepCount, convertToModelMessages, type UIMessage } from 'ai'
import { createGoogleGenerativeAI } from '@ai-sdk/google'
import { createAnthropic } from '@ai-sdk/anthropic'
import { createOpenRouter } from '@openrouter/ai-sdk-provider'
import { createOpenAI } from '@ai-sdk/openai'
import { z } from 'zod'
import { NextRequest } from 'next/server'
import { getSession } from '@/lib/auth'
import { db } from '@/lib/db'
import { portals, portalLists, aiUsage } from '@/lib/db/schema'
import { eq } from 'drizzle-orm'
import { createTask } from '@/lib/clickup'
import { computeCost } from '@/lib/aiPricing'
import { withReporterFooter, normalizeActorId } from '@/lib/reporter'
import { logEvent, EVENT_TASK_CREATED } from '@/lib/portalEvents'
import { invalidateFolderTasks } from '@/lib/clickupCache'

export const runtime = 'nodejs'
export const maxDuration = 30

function getModel(fallback = false) {
  // Fallback: if the primary (Gemini) fails, the client retries with fallback=true
  // and we serve the request through OpenAI (ChatGPT) instead.
  if (fallback) {
    const openai = createOpenAI({ apiKey: process.env.OPENAI_API_KEY })
    return { model: openai('gpt-4o-mini'), provider: 'openai', modelId: 'gpt-4o-mini' }
  }
  const provider = process.env.AI_PROVIDER ?? 'gemini'
  if (provider === 'anthropic') {
    const anthropic = createAnthropic({ apiKey: process.env.ANTHROPIC_API_KEY })
    return { model: anthropic('claude-haiku-4-5'), provider: 'anthropic', modelId: 'claude-haiku-4-5' }
  }
  if (provider === 'openrouter') {
    const openrouter = createOpenRouter({ apiKey: process.env.OPENROUTER_API_KEY })
    const modelId = process.env.OPENROUTER_MODEL ?? 'nvidia/nemotron-3-super-120b-a12b:free'
    return { model: openrouter.chat(modelId), provider: 'openrouter', modelId }
  }
  const google = createGoogleGenerativeAI({ apiKey: process.env.GOOGLE_GENERATIVE_AI_API_KEY })
  return { model: google('gemini-2.5-flash'), provider: 'google', modelId: 'gemini-2.5-flash' }
}


export async function POST(request: NextRequest) {
  const { messages: uiMessages, slug, mode, fallback } = await request.json() as {
    messages: UIMessage[]
    slug: string
    mode?: string
    fallback?: boolean
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
- Ty: "ok. jak to sklasyfikujemy? P1 istotna usterka, bo blokuje zakup, czy P2 drobna, jeśli da się kupić inną drogą?"
- Klient: "P1, bez tego nikt nie kupi"
- Klient: "najlepiej na pojutrze"
- Ty: "dobra, zgłaszam jako P1. zadanie pojawi się za chwilę na tablicy" [TWORZYSZ ZADANIE]

Zwróć uwagę, czego w tym przykładzie NIE MA: nie nadajesz priorytetu sama i nie mówisz „wchodzę z tym jako wysoki". Pytasz, bo od tej klasyfikacji zależy czas reakcji i to klient za nią odpowiada.

## CO MUSISZ WIEDZIEĆ ZANIM STWORZYSZ ZADANIE

Zbieraj przez rozmowę — po jednym pytaniu:
- **Co** — opis problemu lub zlecenia (już z pierwszej wiadomości klienta)
- **Gdzie** — URL, strona, platforma, serwer
- **Kontekst** — co dokładnie się dzieje / co zmienić / jak to wygląda teraz
- **Termin** — kiedy ma być gotowe (jeśli klient nie mówi, zapytaj raz; jeśli mówi "nie wiem" — OK, tworzysz bez terminu)
- **Priorytet** — pytasz o niego ZAWSZE i WPROST. To jedyne pole, którego nie wolno Ci wywnioskować za klienta.

Nie pytaj o "Definition of Done" — opisz go sam na podstawie zgłoszenia.
Nie pytaj o materiały jeśli zadanie ich nie wymaga (np. naprawa buga).

## PRIORYTET — PYTASZ ZAWSZE

Priorytet ustala KOLEJNOŚĆ i CZAS REAKCJI, więc wybiera go klient, nie Ty. Nawet gdy z rozmowy wynika, jak pilna jest sprawa, pokazujesz skalę i prosisz o potwierdzenie. Bez odpowiedzi klienta NIE tworzysz zadania.

Pytasz raz, krótko, podając skalę słowami klienta:

- **P0, alarm** — sklep nie działa albo nie da się złożyć zamówienia, utrata danych, podejrzenie włamania
- **P1, istotna usterka** — sklep sprzedaje, ale kluczowa funkcja nie działa: metoda płatności, synchronizacja, wysyłka
- **P2, usterka drobna** — coś działa lub wyświetla się niepoprawnie, ale nie blokuje sprzedaży ani obsługi zamówień
- **P3, zmiana planowana** — zmiany treści, banery, drobne modyfikacje, konsultacja

Do pola priority wpisujesz: P0 = 1, P1 = 2, P2 = 3, P3 = 4.

Gdy klient poda priorytet po swojemu ("to pilne", "nie spieszy się"), przypisujesz go do jednego z czterech poziomów i UPEWNIASZ SIĘ jednym pytaniem, czy dobrze rozumiesz. Nie zgaduj w milczeniu.

**P0 idzie przyciskiem Alarm, nie przez Ciebie.** Jeżeli opis odpowiada P0, powiedz to wprost: „to brzmi na alarm, wciśnij czerwony przycisk Alarm u góry, trafia od razu do zespołu". Zadanie utwórz dodatkowo, z priorytetem 1, i napisz w rozmowie, że je zapisałaś, ale reakcja idzie z alarmu.

Czasów reakcji NIE podajesz. Zależą od umowy konkretnego klienta, a Ty ich tutaj nie znasz i pomyłka w tej liczbie jest obietnicą, której zespół może nie dotrzymać.

## ZAŁĄCZNIKI / ZRZUTY EKRANU

Jeśli klient napisze że dołącza/dołączył zrzut ekranu lub obrazek — NIE proś o link ani lokalizację obrazka. Zrzut zostaje automatycznie dodany jako załącznik do zadania w systemie. Potraktuj go jako dostarczony materiał, nie dopytuj gdzie jest, i zaznacz w opisie zadania: "Klient dołączył zrzut ekranu".

## KIEDY TWORZYĆ

Twórz zadanie gdy wiesz: CO, GDZIE, jakie są szczegóły ORAZ jaki priorytet wskazał klient. Termin jest opcjonalny, priorytet nie.
Jeśli brakuje URL lub kluczowego kontekstu — zapytaj raz. Jeśli klient mówi "nie wiem" albo "nie ma" — twórz bez tego.
Nie przeciągaj rozmowy. Maksymalnie 4-5 pytań łącznie.

## FORMAT OPISU (wypełnij sam, klient tego nie widzi)

## Cel zadania
[Co ma być zrobione i po co]

## Szczegóły
[URL, platforma, co dokładnie się dzieje / co zmienić]

## Termin i priorytet
[Termin słownie. Priorytet w postaci "P1 (istotna usterka), wybrany przez klienta"
albo "P2 (usterka drobna), potwierdzony przez klienta". Zapisz, że pochodzi od
klienta, bo to on odpowiada za klasyfikację i od niej zależy czas reakcji.]

## Zgłaszający
Klient: ${portal[0].name}

Odpowiadaj TYLKO po polsku. Pisz krótko — jak SMS, nie jak mail.`

  const createTaskTool = tool({
    description: 'Tworzy nowe zadanie w ClickUp. Wywołaj TYLKO gdy masz kompletny briefing: nazwę, pełny opis z kontekstem ORAZ priorytet WSKAZANY PRZEZ KLIENTA. Nie wywołuj z priorytetem, którego klient nie potwierdził. Opis musi mieć min. 100 znaków.',
    inputSchema: z.object({
      name: z.string().describe('Zwięzła nazwa zadania, max 80 znaków'),
      description: z.string().min(100).describe('Pełny opis w Markdown: cel, kontekst, materiały, DoD, zgłaszający'),
      priority: z.number().min(1).max(4).describe('Klasyfikacja WYBRANA PRZEZ KLIENTA: 1=P0 alarm, 2=P1 istotna usterka, 3=P2 usterka drobna, 4=P3 zmiana planowana'),
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
        // Stopkę dokleja serwer, nie model. Prompt prosi o „zgłaszającego" w
        // opisie, ale to jest tekst generowany, więc podlega halucynacji i
        // podpowiedziom z rozmowy. Atrybucja pochodzi z sesji, jednym
        // sposobem dla wszystkich kanałów.
        description: withReporterFooter(description, {
          name: session.name,
          email: session.email,
          portalName: portal[0].name,
          portalSlug: portal[0].slug,
          source: 'ai',
        }),
        priority: priority ?? null,
        due_date: due_date ?? null,
        // Client-submitted tasks land in "do zrobienia" (to-do), not the default backlog,
        // so the team sees incoming requests instead of them being buried.
        status: 'do zrobienia',
      })

      // Bez tego klient zglosilby zadanie przez asystenta, odswiezyl strone
      // i nie zobaczyl go na tablicy przez kilkadziesiat sekund.
      await invalidateFolderTasks(portal[0].clickupFolderId)

      await logEvent({
        portalId: portal[0].id,
        actor: { userId: session.userId, email: session.email, name: session.name },
        action: EVENT_TASK_CREATED,
        resourceId: task.id,
        meta: { source: 'ai', taskName: task.name, url: task.url ?? null, priority: priority ?? null },
      })

      return {
        success: true,
        taskId: task.id,
        taskName: task.name,
        message: `✅ Zadanie "${task.name}" zostało dodane do systemu. Możesz zamknąć to okno — zadanie pojawi się na tablicy po odświeżeniu.`,
      }
    },
  })

  const { model, provider, modelId } = getModel(!!fallback)

  const result = streamText({
    model,
    system: NEW_TASK_PROMPT,
    messages,
    stopWhen: isStepCount(6),
    tools: { createTask: createTaskTool },
    onFinish: async ({ usage }) => {
      try {
        const u = usage as { inputTokens?: number; outputTokens?: number; totalTokens?: number; promptTokens?: number; completionTokens?: number } | undefined
        const input = u?.inputTokens ?? u?.promptTokens ?? 0
        const output = u?.outputTokens ?? u?.completionTokens ?? 0
        const total = u?.totalTokens ?? input + output
        await db.insert(aiUsage).values({
          portalId: portal[0].id,
          // `session.userId` bywa łańcuchem 'admin' (obejście admina w
          // lib/auth.ts), a kolumna jest typu uuid. Bez tej normalizacji insert
          // leciał wyjątkiem, ten catch go zjadał i zużycie AI z sesji admina
          // NIGDY się nie zapisywało, bez żadnego sygnału w panelu.
          userId: normalizeActorId(session.userId),
          userEmail: session.email,
          provider,
          model: modelId,
          inputTokens: input,
          outputTokens: output,
          totalTokens: total,
          costUsd: computeCost(modelId, input, output),
        })
      } catch (e) {
        console.error('ai_usage log failed:', e)
      }
    },
  })

  return result.toUIMessageStreamResponse()
}
