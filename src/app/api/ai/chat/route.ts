import { streamText, tool, isStepCount, convertToModelMessages, type UIMessage } from 'ai'
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
import { withReporterFooter, normalizeActorId } from '@/lib/reporter'
import { assigneesField } from '@/lib/assignee'
import { logEvent, EVENT_TASK_CREATED } from '@/lib/portalEvents'
import { invalidateFolderTasks } from '@/lib/clickupCache'
import { isAwaria, TASK_STATUS_INITIAL } from '@/lib/utils'
import { buildAiChatTags } from '@/lib/autoTags'
import { buildTranscript, transcriptOutcome, textFromParts } from '@/lib/aiTranscript'
import { withInjectionNote } from '@/lib/promptGuard'
import { enqueueReport } from '@/lib/pendingReports'
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
        if (outcome === 'podejrzane') {
          // Do logów kontenera, nie tylko do panelu: to jest ZGUBIONE
          // zgłoszenie klienta, a nie statystyka. Model napisał, że sprawa
          // jest zapisana, i nie wywołał narzędzia.
          console.warn(
            `[ai/chat] model obiecal zgloszenie, ale NIE utworzyl zadania — portal ${portal.slug}, uzytkownik ${session.email}`
          )
        }
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
