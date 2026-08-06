import { streamText, tool, isStepCount, convertToModelMessages, type UIMessage } from 'ai'
import { createGoogleGenerativeAI } from '@ai-sdk/google'
import { createAnthropic } from '@ai-sdk/anthropic'
import { createOpenRouter } from '@openrouter/ai-sdk-provider'
import { createOpenAI } from '@ai-sdk/openai'
import { NextRequest } from 'next/server'
import { db } from '@/lib/db'
import { portalLists, aiUsage } from '@/lib/db/schema'
import { eq } from 'drizzle-orm'
import { requirePortalApi } from '@/lib/apiSession'
import { createTask } from '@/lib/clickup'
import { computeCost } from '@/lib/aiPricing'
import { withReporterFooter, normalizeActorId } from '@/lib/reporter'
import { logEvent, EVENT_TASK_CREATED } from '@/lib/portalEvents'
import { invalidateFolderTasks } from '@/lib/clickupCache'
import { AWARIA_TAG, isAwaria } from '@/lib/utils'
import {
  buildNewTaskPrompt,
  taskInputSchema,
  CREATE_TASK_TOOL_DESCRIPTION,
} from '@/lib/taskPrompt'

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

  const gate = await requirePortalApi(slug)
  if (!gate.ok) return gate.response
  const { session, portal } = gate

  const messages = await convertToModelMessages(uiMessages)

  const lists = await db
    .select()
    .from(portalLists)
    .where(eq(portalLists.portalId, portal.id))
    .orderBy(portalLists.sortOrder)

  const defaultList = lists.find(l => l.isDefault) ?? lists[0]
  const today = new Date().toLocaleDateString('pl-PL', { weekday: 'long', year: 'numeric', month: 'long', day: 'numeric' })

  // ── SYSTEM PROMPTS ────────────────────────────────────────────────────────

  const NEW_TASK_PROMPT = buildNewTaskPrompt({ portalName: portal.name, today })

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

      const task = await createTask(targetListId, {
        name,
        // Stopkę dokleja serwer, nie model. Prompt prosi o „zgłaszającego" w
        // opisie, ale to jest tekst generowany, więc podlega halucynacji i
        // podpowiedziom z rozmowy. Atrybucja pochodzi z sesji, jednym
        // sposobem dla wszystkich kanałów.
        description: withReporterFooter(description, {
          name: session.name,
          email: session.email,
          portalName: portal.name,
          portalSlug: portal.slug,
          source: 'ai',
        }),
        priority: priority ?? null,
        due_date: due_date ?? null,
        // Z tagów proponowanych przez model przepuszczamy WYŁĄCZNIE tag awarii.
        // Model dostaje tu swobodne pole tekstowe, a tagi w ClickUpie są
        // wspólne dla całej przestrzeni klientów: bez tego filtra halucynacja
        // albo podpowiedź z rozmowy klienta zakładałaby zespołowi śmieci
        // w słowniku tagów.
        tags: awaria ? [AWARIA_TAG] : undefined,
        // Client-submitted tasks land in "do zrobienia" (to-do), not the default backlog,
        // so the team sees incoming requests instead of them being buried.
        status: 'do zrobienia',
      })

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
    onFinish: async ({ usage }) => {
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
