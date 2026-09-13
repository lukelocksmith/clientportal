import { streamText, generateText, tool, isStepCount, convertToModelMessages, type UIMessage } from 'ai'
import { createGoogleGenerativeAI } from '@ai-sdk/google'
import { createAnthropic } from '@ai-sdk/anthropic'
import { createOpenRouter } from '@openrouter/ai-sdk-provider'
import { createOpenAI } from '@ai-sdk/openai'
import { NextRequest, NextResponse } from 'next/server'
import { z } from 'zod'
import { db } from '@/lib/db'
import { portalLists, aiUsage, aiChatLogs } from '@/lib/db/schema'
import { eq } from 'drizzle-orm'
import { requirePortalApi } from '@/lib/apiSession'
import { createTask } from '@/lib/clickup'
import { computeCost } from '@/lib/aiPricing'
import { withReporterFooter, normalizeActorId, newReportMarker } from '@/lib/reporter'
import { assigneesField } from '@/lib/assignee'
import { logEvent, EVENT_TASK_CREATED } from '@/lib/portalEvents'
import { invalidateFolderTasks } from '@/lib/clickupCache'
import { isAwaria, TASK_STATUS_INITIAL } from '@/lib/utils'
import { buildAiChatTags } from '@/lib/autoTags'
import { buildTranscript, transcriptOutcome, textFromParts } from '@/lib/aiTranscript'
import { withInjectionNote } from '@/lib/promptGuard'
import { enqueueReport } from '@/lib/pendingReports'
import { planRatunkowy } from '@/lib/aiRescue'
import { sendOpsAlert } from '@/lib/cronRuns'
import {
  buildNewTaskPrompt,
  taskInputSchema,
  CREATE_TASK_TOOL_DESCRIPTION,
} from '@/lib/taskPrompt'

export const runtime = 'nodejs'
export const maxDuration = 30

/**
 * Jedyna trasa klienta bez schematu do tej pory, a zarazem najdroższa w
 * skutkach: bez walidacji popsuty JSON dawał goły 500, a nieograniczona liczba
 * i rozmiar wiadomości otwierały koszt tokenu od strony wejścia. Limity są
 * hojne wobec realnej rozmowy (60 wiadomości, 200 KB surowego ciała), ale
 * zamykają drogę nadużyciu.
 */
const chatRequestSchema = z.looseObject({
  messages: z
    .array(
      // Bez wymagania `id`: identyfikator generuje klient i serwer go nie
      // czyta, a twarde wymaganie łamałoby kontrakt istniejących wywołań.
      z.looseObject({
        role: z.enum(['system', 'user', 'assistant']),
        parts: z.array(z.unknown()),
      })
    )
    .min(1)
    .max(60),
  slug: z.string().min(1).max(100),
  mode: z.string().optional(),
  fallback: z.boolean().optional(),
})

/** Surowe ciało powyżej tego rozmiaru odrzucamy przed parsowaniem. */
const MAX_BODY_CHARS = 200_000

/**
 * Ile czekamy na dogrywkę z wymuszonym narzędziem.
 *
 * DWADZIEŚCIA sekund, nie osiem. Limit obejmuje CAŁE wywołanie, czyli także
 * wykonanie narzędzia, a `createTask` idzie po sieci do ClickUpa. Pomiar
 * 13.09 na produkcji: przy ośmiu sekundach dogrywka oddała zadanie raz na
 * trzy próby, a pozostałe dwa razy zgłoszenie spadało do kolejki — mimo że
 * ten sam model wołany bez ClickUpa w łańcuchu wyrabiał się 5 razy na 5,
 * w 1,8–5,4 s. Czyli nie zawodził model, tylko nasz zegar.
 *
 * Górna granica jest nadal potrzebna, bo to praca po zamkniętym strumieniu,
 * a za nią stoi kolejka: lepiej oddać pole warstwie, która zadziała na pewno,
 * niż wisieć na dostawcy, który przestał odpowiadać.
 */
const DOMKNIECIE_TIMEOUT_MS = 20_000

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
  const raw = await request.text()
  if (raw.length > MAX_BODY_CHARS) {
    return NextResponse.json({ error: 'Rozmowa jest zbyt długa. Otwórz nową.' }, { status: 413 })
  }

  let body: unknown
  try {
    body = JSON.parse(raw)
  } catch {
    return NextResponse.json({ error: 'Invalid request' }, { status: 400 })
  }

  const parsed = chatRequestSchema.safeParse(body)
  if (!parsed.success) {
    return NextResponse.json({ error: 'Invalid request' }, { status: 400 })
  }
  const { messages: uiMessages, slug, mode, fallback } = parsed.data

  // Only new-task mode is active — other modes are disabled
  if (mode !== 'new-task') {
    return new Response('This AI feature is not available', { status: 403 })
  }

  const gate = await requirePortalApi(slug)
  if (!gate.ok) return gate.response
  const { session, portal } = gate

  // Schemat gwarantuje szkielet wiadomości (id, role, parts); pełny typ
  // UIMessage przywraca cast, a `convertToModelMessages` i tak odrzuca treść,
  // której nie umie zinterpretować.
  const messages = await convertToModelMessages(uiMessages as unknown as UIMessage[])

  const lists = await db
    .select()
    .from(portalLists)
    .where(eq(portalLists.portalId, portal.id))
    .orderBy(portalLists.sortOrder)

  const defaultList = lists.find(l => l.isDefault) ?? lists[0]
  const today = new Date().toLocaleDateString('pl-PL', { weekday: 'long', year: 'numeric', month: 'long', day: 'numeric' })

  // ── SYSTEM PROMPTS ────────────────────────────────────────────────────────

  const NEW_TASK_PROMPT = buildNewTaskPrompt({ portalName: portal.name, today })

  /**
   * Same wypowiedzi klienta z tej rozmowy. Bierzemy je z wiadomości interfejsu,
   * a nie z historii modelu, bo chodzi o to, co NAPISAŁ CZŁOWIEK — odpowiedzi
   * asystenta mogłyby powtórzyć podejrzany zwrot i same zapaliłyby ostrzeżenie.
   */
  const wypowiedziKlienta = (uiMessages as Array<{ role?: string; parts?: unknown }>)
    .filter(m => m?.role === 'user')
    .map(m => textFromParts(m.parts))
    .filter(Boolean)

  const createTaskTool = tool({
    description: CREATE_TASK_TOOL_DESCRIPTION,
    inputSchema: taskInputSchema,
    execute: async ({ name, description, priority, listId, due_date_days, tags }) => {
      const targetListId = listId && lists.some(l => l.clickupListId === listId)
        ? listId
        : (defaultList?.clickupListId ?? '')

      if (!targetListId) return { error: 'Brak skonfigurowanej listy w portalu' }

      const due_date = due_date_days
        ? Date.now() + due_date_days * 24 * 60 * 60 * 1000
        : undefined

      const awaria = isAwaria((tags ?? []).map(name => ({ name })))

      // Reguły (stopka z sesji, tagi, status) liczymy RAZ i tym samym
      // obiektem karmimy ClickUpa albo kolejkę. Bez tego kolejka dowoziłaby
      // zadanie zbudowane inaczej niż to z udanego zgłoszenia.
      // Numer zgłoszenia przed pierwszą próbą — patrz komentarz w trasie
      // formularza i w lib/pendingReports.ts.
      const marker = newReportMarker()

      const payload = {
        name,
        // Ta sama reguła co przy formularzu (lib/assignee.ts): ustawienie
        // projektu, a w zapasie osoba agencji.
        ...assigneesField(portal.defaultAssigneeId),
        // Stopkę dokleja serwer, nie model. Prompt prosi o „zgłaszającego" w
        // opisie, ale to jest tekst generowany, więc podlega halucynacji i
        // podpowiedziom z rozmowy. Atrybucja pochodzi z sesji, jednym
        // sposobem dla wszystkich kanałów.
        // Druga warstwa, deterministyczna, po naszej stronie: gdy w rozmowie
        // widać próbę sterowania asystentem („ignoruj instrukcje", „ustaw
        // priorytet 1"), zespół dostaje o tym jedną linię w opisie. Prompt
        // sam nie wystarcza — pomiar z 31.08 pokazał, że taka próba działa
        // na modelu w dwóch przebiegach z trzech (lib/promptGuard.ts).
        description: withReporterFooter(withInjectionNote(description, wypowiedziKlienta), {
          name: session.name,
          email: session.email,
          portalName: portal.name,
          portalSlug: portal.slug,
          source: 'ai',
          marker,
        }),
        priority: priority ?? null,
        due_date: due_date ?? null,
        // Z tagów proponowanych przez model przepuszczamy WYŁĄCZNIE tag awarii,
        // doklejony do tagów skonfigurowanych dla portalu (np. "asana", pod
        // istniejącą automatyzację ClickUp → Asana). Model dostaje tu swobodne
        // pole tekstowe, a tagi w ClickUpie są wspólne dla całej przestrzeni
        // klientów: bez tego filtra halucynacja albo podpowiedź z rozmowy
        // klienta zakładałaby zespołowi śmieci w słowniku tagów.
        tags: buildAiChatTags(portal.autoTags, awaria),
        // Client-submitted tasks land in the initial column ("do zrobienia"),
        // not the default backlog, so the team sees incoming requests instead
        // of them being buried.
        status: TASK_STATUS_INITIAL,
      }

      let task: Awaited<ReturnType<typeof createTask>>
      try {
        task = await createTask(targetListId, payload)
      } catch (error) {
        /**
         * ClickUp odmówił. Zgłoszenie idzie do NASZEJ kolejki, a nie do kosza:
         * klient odbył całą rozmowę, opisał sprawę i nie ma go za co karać
         * awarią cudzego API. Cron dowozi zadanie z ponawianiem.
         *
         * Modelowi mówimy prawdę, ale prawdę użyteczną: zgłoszenie przyjęte,
         * na tablicy pojawi się za chwilę. Gdyby dostał tu goły błąd, zaczynałby
         * rozmowę od nowa i klient opowiadałby wszystko drugi raz.
         */
        console.error('[ai/chat] ClickUp odrzucil utworzenie zadania:', error)
        const wKolejce = await enqueueReport({
          portalId: portal.id,
          source: 'ai',
          clickupListId: targetListId,
          payload,
          marker,
          actor: { userId: normalizeActorId(session.userId), email: session.email, name: session.name },
          error,
        })

        if (!wKolejce) {
          return { error: 'Nie udało się zapisać zgłoszenia. Poproś klienta, żeby kliknął czerwony przycisk Alarm.' }
        }

        await logEvent({
          portalId: portal.id,
          actor: { userId: session.userId, email: session.email, name: session.name },
          action: EVENT_TASK_CREATED,
          resourceId: null,
          meta: { source: 'ai', taskName: payload.name, wKolejce: true, awaria },
        })

        return {
          success: true,
          queued: true,
          taskId: null,
          taskName: payload.name,
          message: `✅ Zgłoszenie „${payload.name}" zostało przyjęte. Na tablicy pojawi się w ciągu kilku minut.`,
        }
      }

      // Bez tego klient zglosilby zadanie przez asystenta, odswiezyl strone
      // i nie zobaczyl go na tablicy przez kilkadziesiat sekund.
      await invalidateFolderTasks(portal.clickupFolderId)

      await logEvent({
        portalId: portal.id,
        actor: { userId: session.userId, email: session.email, name: session.name },
        action: EVENT_TASK_CREATED,
        resourceId: task.id,
        meta: { source: 'ai', taskName: task.name, url: task.url ?? null, priority: priority ?? null, awaria },
      })

      return {
        success: true,
        taskId: task.id,
        taskName: task.name,
        message: `✅ Zadanie "${task.name}" zostało dodane do systemu. Możesz zamknąć to okno — zadanie pojawi się na tablicy po odświeżeniu.`,
      }
    },
  })

  /**
   * DRUGA TURA, W KTÓREJ MODEL NIE MA JAK ODPISAĆ TEKSTEM.
   *
   * Prompt nie zmusi modelu do wywołania narzędzia — 4 września u Onyxa nie
   * zmusił, mimo że mówi o tym wprost w trzech miejscach. `toolChoice:
   * 'required'` odbiera modelowi wybór na poziomie protokołu: w tej turze
   * jedyną dozwoloną odpowiedzią jest wywołanie `createTask`, więc „napisał,
   * że zgłosił, i nie zgłosił" przestaje być możliwe.
   *
   * Rozmowa jest ta sama, narzędzie jest to samo, więc zadanie powstaje
   * normalną drogą: z nazwą i opisem OD MODELU, stopką z sesji, przypisaniem
   * projektu i kolejką przy awarii ClickUpa. To jest istotna różnica wobec
   * ratunku z transkryptu, który umie tylko przepisać surową rozmowę.
   *
   * Krótki limit czasu i zero ponowień: to jest dogrywka po zamkniętym już
   * strumieniu, a za nią czeka warstwa ostatnia. Lepiej szybko oddać pole
   * kolejce niż wisieć na dostawcy, który właśnie przestał odpowiadać.
   */
  async function domknijWymuszeniem(): Promise<boolean> {
    try {
      const wynik = await generateText({
        model,
        system: `${NEW_TASK_PROMPT}\n\n## DOGRYWKA\nRozmowa jest skończona, a klient uważa, że zgłoszenie zostało przyjęte. Utwórz zadanie TERAZ, z tego, co już wiesz. Czego nie wiesz, tego nie zgaduj — dopisz w opisie linię „Klient nie podał: …". Nie zadawaj pytań.`,
        messages,
        tools: { createTask: createTaskTool },
        toolChoice: 'required',
        stopWhen: isStepCount(2),
        maxRetries: 0,
        timeout: DOMKNIECIE_TIMEOUT_MS,
      })

      const kroki = (wynik as { steps?: Array<{ toolResults?: Array<{ output?: unknown }> }> }).steps ?? []
      for (const krok of kroki) {
        for (const r of krok.toolResults ?? []) {
          const out = r?.output as { success?: boolean } | undefined
          if (out?.success === true) return true
        }
      }
      console.error('[ai/chat] wymuszone domkniecie nie oddalo zadania — zostaje ratunek z transkryptu')
      return false
    } catch (e) {
      console.error('[ai/chat] wymuszone domkniecie nieudane:', e)
      return false
    }
  }

  /**
   * Ratunek zgłoszenia, które asystent obiecał klientowi i nie założył.
   *
   * Wołane z `onEnd`, gdy zapis rozmowy wyszedł jako `podejrzane`. Zadanie
   * składamy z samej rozmowy (lib/aiRescue.ts) i oddajemy kolejce, a nie
   * ClickUpowi wprost: kolejka ma ponawianie, odsiew duplikatów po markerze
   * i alarm po piętnastu minutach, więc jest jedyną drogą, która sama z siebie
   * nie milczy. Reguły opisu i przypisania są te same co przy zwykłym
   * zgłoszeniu, bo to ma być TO SAMO zadanie, tylko dowiezione okrężnie.
   *
   * Nic tutaj nie ma prawa przewrócić `onEnd`: to już jest ścieżka awaryjna,
   * a wyjątek z niej zabrałby przy okazji zapis zużycia tokenów.
   */
  async function ratujPorzuconeZgloszenie(
    transcript: Parameters<typeof planRatunkowy>[0]
  ): Promise<{ nazwa: string; uratowane: boolean } | null> {
    try {
      const plan = planRatunkowy(transcript)
      if (!plan) return null

      const targetListId = defaultList?.clickupListId ?? ''
      if (!targetListId) {
        console.error('[ai/chat] ratunek niemozliwy: portal nie ma skonfigurowanej listy')
        return { nazwa: plan.name, uratowane: false }
      }

      const marker = newReportMarker()
      const payload = {
        name: plan.name,
        ...assigneesField(portal.defaultAssigneeId),
        description: withReporterFooter(withInjectionNote(plan.description, wypowiedziKlienta), {
          name: session.name,
          email: session.email,
          portalName: portal.name,
          portalSlug: portal.slug,
          source: 'ai' as const,
          marker,
        }),
        // Poziomu NIE zgadujemy z tekstu obietnicy. Model, który nie wywołał
        // narzędzia, nie jest źródłem, na którym można oprzeć kolejkę pracy
        // zespołu; opis mówi wprost, że poziom jest do ustalenia.
        priority: null,
        due_date: null,
        // Bez tagu awarii: ten nadaje się z opisu w rozmowie, a tutaj nikt
        // tego nie potwierdził. Alarm ma własny przycisk.
        tags: buildAiChatTags(portal.autoTags, false),
        status: TASK_STATUS_INITIAL,
      }

      const wKolejce = await enqueueReport({
        portalId: portal.id,
        source: 'ai',
        clickupListId: targetListId,
        payload,
        marker,
        actor: { userId: normalizeActorId(session.userId), email: session.email, name: session.name },
        error: 'Asystent potwierdzil zgloszenie klientowi, ale nie wywolal narzedzia createTask',
      })

      if (!wKolejce) {
        console.error('[ai/chat] RATUNEK NIEUDANY — zgloszenie klienta przepadlo:', payload.name)
        return { nazwa: payload.name, uratowane: false }
      }

      await logEvent({
        portalId: portal.id,
        actor: { userId: session.userId, email: session.email, name: session.name },
        action: EVENT_TASK_CREATED,
        resourceId: null,
        meta: { source: 'ai', taskName: payload.name, wKolejce: true, ratunek: true },
      })

      return { nazwa: payload.name, uratowane: true }
    } catch (e) {
      console.error('[ai/chat] ratunek porzuconego zgloszenia nieudany:', e)
      return { nazwa: 'nieznana', uratowane: false }
    }
  }

  const { model, provider, modelId } = getModel(!!fallback)

  const result = streamText({
    model,
    system: NEW_TASK_PROMPT,
    messages,
    stopWhen: isStepCount(6),
    tools: { createTask: createTaskTool },
    // `onError` jest jedynym miejscem, w którym widać awarię SAMEGO
    // strumienia (odmowa dostawcy modelu, zerwane połączenie). Bez tego
    // nieudana rozmowa nie zostawiała żadnego śladu — ani w logach, ani
    // w zużyciu, bo `onEnd` wtedy nie leci.
    onError: ({ error }) => {
      console.error('[ai/chat] strumień modelu przerwany:', error)
    },
    // `onFinish` jest w ai 7 przestarzałe, zastąpione przez `onEnd`.
    onEnd: async ({ usage, steps, finishReason }) => {
      // Zapis rozmowy przed zużyciem: to on odpowiada na pytanie „czemu
      // zadanie nie powstało", a zużycie jest tylko liczbą (patrz
      // lib/aiTranscript.ts i komentarz przy tabeli ai_chat_logs).
      try {
        const transcript = buildTranscript(uiMessages, steps)
        const { outcome, taskId, taskName } = transcriptOutcome(transcript)
        await db.insert(aiChatLogs).values({
          portalId: portal.id,
          // Ta sama normalizacja co przy zużyciu: sesja admina ma userId
          // 'admin', a kolumna jest typu uuid.
          userId: normalizeActorId(session.userId),
          userEmail: session.email,
          provider,
          model: modelId,
          outcome,
          taskId,
          taskName,
          finishReason: typeof finishReason === 'string' ? finishReason : null,
          transcript,
        })

        /**
         * Ratunek i alarm PO zapisie rozmowy, w osobnym `try`.
         *
         * Kolejność nie jest kosmetyką: 13.09 alarm poleciał przed zapisem,
         * wywrócił się na pustym wyniku i zabrał ze sobą CAŁY wpis
         * do `ai_chat_logs` — czyli jedyny ślad po zgłoszeniu, którego
         * dotyczył. Siatka bezpieczeństwa, która przy okazji zrzuca z liny,
         * jest gorsza od jej braku.
         */
        if (outcome === 'podejrzane') {
          // Do logów kontenera, nie tylko do panelu: to jest ZGUBIONE
          // zgłoszenie klienta, a nie statystyka.
          console.warn(
            `[ai/chat] model obiecal zgloszenie, ale NIE utworzyl zadania — portal ${portal.slug}, uzytkownik ${session.email}`
          )
          try {
            /**
             * Kolejność ma znaczenie: najpierw próbujemy domknąć rozmowę
             * modelem, bo to daje zadanie opisane po ludzku. Ratunek
             * z transkryptu jest warstwą OSTATNIĄ, nie pierwszą — odpala się
             * wyłącznie wtedy, gdy dogrywka nie oddała zadania, więc nie ma
             * drogi, którą klient dostałby dwa zgłoszenia o tej samej sprawie.
             */
            const domkniete = await domknijWymuszeniem()
            const ratunek = domkniete ? null : await ratujPorzuconeZgloszenie(transcript)

            /**
             * ALARM DO ZESPOŁU, osobno od ratunku.
             *
             * Ratunek dowozi zgłoszenie i przez to GASI jedyny sygnał, jaki
             * mieliśmy: kolejka pustoszeje w minutę, więc jej alarm po
             * piętnastu minutach nigdy nie zapali. Bez tej linii model mógłby
             * kłamać klientom codziennie, a my zobaczylibyśmy to wyłącznie
             * wtedy, gdy ktoś z własnej woli otworzy panel — czyli po fakcie.
             *
             * Kanał ten sam co przy czerwonym przycisku (Discord zespołu), bo
             * to jest to samo pytanie: czy droga zgłoszeń klienta jest
             * przejezdna.
             */
            await sendOpsAlert(
              [
                '⚠️ Asystent AI obiecał klientowi zgłoszenie i NIE utworzył zadania.',
                `Projekt: ${portal.slug} · klient: ${session.email}`,
                domkniete
                  ? 'Zadanie zostało domknięte drugą turą z wymuszonym narzędziem — jest na tablicy.'
                  : ratunek?.uratowane
                    ? `Dogrywka z modelem też nie wyszła. Zgłoszenie „${ratunek.nazwa}" zostało uratowane do kolejki z zapisu rozmowy.`
                    : 'ANI DOGRYWKA, ANI RATUNEK — treść zgłoszenia jest tylko w zapisie rozmowy.',
                `Rozmowa: panel admina → projekt ${portal.slug} → AI → Rozmowy z asystentem.`,
              ].join('\n')
            )
          } catch (e) {
            console.error('[ai/chat] ratunek albo alarm o porzuconym zgloszeniu nieudany:', e)
          }
        }
      } catch (e) {
        console.error('ai_chat_log zapis nieudany:', e)
      }

      try {
        const u = usage as { inputTokens?: number; outputTokens?: number; totalTokens?: number; promptTokens?: number; completionTokens?: number } | undefined
        const input = u?.inputTokens ?? u?.promptTokens ?? 0
        const output = u?.outputTokens ?? u?.completionTokens ?? 0
        const total = u?.totalTokens ?? input + output
        await db.insert(aiUsage).values({
          portalId: portal.id,
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
