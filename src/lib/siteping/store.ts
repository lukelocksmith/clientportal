import type {
  SitepingStore,
  FeedbackCreateInput,
  FeedbackRecord,
  FeedbackUpdateInput,
  FeedbackQuery,
  FeedbackPage,
  AnnotationRecord,
} from '@siteping/adapter-prisma'
import { StoreNotFoundError } from '@siteping/adapter-prisma'
import { randomUUID } from 'node:crypto'
import {
  createTask,
  updateTask,
  deleteTask,
  addTaskAttachment,
  getTask,
  getAllTasksForFolder,
  verifyTaskBelongsToFolder,
} from '@/lib/clickup'
import type { ClickUpTask } from '@/lib/types'
import {
  extractClientIdFromDescription,
  extractUrlFromDescription,
  buildFeedbackDescription,
  buildFeedbackTitle,
} from '@/lib/siteping/annotationMarker'
import { withReporterFooter } from '@/lib/reporter'
import { logEvent, EVENT_TASK_CREATED } from '@/lib/portalEvents'
import { invalidateFolderTasks } from '@/lib/clickupCache'

const SITEPING_TAG = 'siteping'
const DATA_ATTACHMENT_NAME = 'siteping-data.json'

const STATUS_TO_CLICKUP: Record<FeedbackUpdateInput['status'], string> = {
  open: 'do zrobienia',
  in_progress: 'w trakcie',
  resolved: 'zamknięte',
  wont_fix: 'zamknięte',
}

const STATUS_FROM_CLICKUP: Record<string, FeedbackRecord['status']> = {
  'backlog': 'open',
  'do zrobienia': 'open',
  'w trakcie': 'in_progress',
  'zablokowane': 'in_progress',
  'przegląd': 'in_progress',
  'weryfikacja': 'in_progress',
  'zamknięte': 'resolved',
}

interface StoredPayload {
  data: FeedbackCreateInput
  taskId: string
}

interface PortalContext {
  id: string
  slug: string
  name: string
  clickupFolderId: string
  defaultListId: string
}

function isSitepingTask(task: ClickUpTask): boolean {
  return (task.tags ?? []).some(t => t.name === SITEPING_TAG)
}

function toAnnotationRecords(input: FeedbackCreateInput, feedbackId: string): AnnotationRecord[] {
  // AnnotationRecord requires elementId/anchorKey as `string | null` (never
  // undefined) — AnnotationCreateInput leaves them optional/undefined when
  // absent, so a plain spread would produce a type mismatch.
  return input.annotations.map(a => ({
    ...a,
    elementId: a.elementId ?? null,
    anchorKey: a.anchorKey ?? null,
    id: randomUUID(),
    feedbackId,
    createdAt: new Date(),
  }))
}

function recordFromCreateInput(input: FeedbackCreateInput, taskId: string, createdAt: Date): FeedbackRecord {
  return {
    id: taskId,
    type: input.type,
    message: input.message,
    status: 'open',
    projectName: input.projectName,
    url: input.url,
    urlPattern: input.urlPattern ?? null,
    authorName: input.authorName,
    authorEmail: input.authorEmail,
    clientId: input.clientId,
    viewport: input.viewport,
    userAgent: input.userAgent,
    resolvedAt: null,
    createdAt,
    updatedAt: createdAt,
    annotations: toAnnotationRecords(input, taskId),
    screenshotUrl: input.screenshotDataUrl ?? null,
    screenshotRegion: input.screenshotRegion ?? null,
    diagnostics: input.diagnostics ?? null,
  }
}

/** Dociaga zalacznik JSON zadania i odtwarza pelny FeedbackRecord. */
async function reconstructFeedbackRecord(task: ClickUpTask): Promise<FeedbackRecord | null> {
  const attachment = (task.attachments ?? []).find(a => a.title === DATA_ATTACHMENT_NAME)
  if (!attachment) return null

  const res = await fetch(attachment.url)
  if (!res.ok) return null
  const payload = (await res.json()) as StoredPayload

  const createdAt = new Date(task.date_created ? Number(task.date_created) : Date.now())
  const record = recordFromCreateInput(payload.data, task.id, createdAt)
  record.status = STATUS_FROM_CLICKUP[task.status.status] ?? 'open'
  record.resolvedAt = task.date_closed ? new Date(Number(task.date_closed)) : null
  record.updatedAt = new Date(Number(task.date_updated))
  return record
}

export function createClickUpSitepingStore(portal: PortalContext): SitepingStore {
  return {
    async createFeedback(data: FeedbackCreateInput): Promise<FeedbackRecord> {
      const existing = await this.findByClientId(data.clientId)
      if (existing) return existing

      const annotation = data.annotations[0] ?? null
      const body = buildFeedbackDescription({
        clientId: data.clientId,
        url: data.url,
        message: data.message,
        annotation,
      })
      const description = withReporterFooter(body, {
        name: data.authorName || null,
        email: data.authorEmail,
        portalName: portal.name,
        portalSlug: portal.slug,
        source: 'siteping',
      })

      const task = await createTask(portal.defaultListId, {
        name: buildFeedbackTitle(data.message),
        description,
        tags: [SITEPING_TAG],
        status: STATUS_TO_CLICKUP.open,
      })

      if (data.screenshotDataUrl) {
        const [, base64] = data.screenshotDataUrl.split(',')
        const bytes = Buffer.from(base64, 'base64')
        await addTaskAttachment(
          task.id,
          new Blob([bytes], { type: 'image/jpeg' }),
          'siteping-screenshot.jpg'
        )
      }

      const payload: StoredPayload = { data, taskId: task.id }
      await addTaskAttachment(
        task.id,
        new Blob([JSON.stringify(payload)], { type: 'application/json' }),
        DATA_ATTACHMENT_NAME
      )

      await invalidateFolderTasks(portal.clickupFolderId)
      await logEvent({
        portalId: portal.id,
        actor: { userId: null, email: data.authorEmail, name: data.authorName || null },
        action: EVENT_TASK_CREATED,
        resourceId: task.id,
        meta: { source: 'siteping', taskName: task.name, url: data.url },
      })

      return recordFromCreateInput(data, task.id, new Date(Number(task.date_created)))
    },

    async findByClientId(clientId: string): Promise<FeedbackRecord | null> {
      const tasks = await getAllTasksForFolder(portal.clickupFolderId)
      const match = tasks.find(
        t => isSitepingTask(t) && extractClientIdFromDescription(t.description) === clientId
      )
      if (!match) return null

      const full = await getTask(match.id)
      return reconstructFeedbackRecord(full)
    },

    async getFeedbacks(query: FeedbackQuery): Promise<FeedbackPage> {
      const tasks = await getAllTasksForFolder(portal.clickupFolderId)
      const candidates = tasks.filter(t => {
        if (!isSitepingTask(t)) return false
        if (extractClientIdFromDescription(t.description) === null) return false
        if (query.url && extractUrlFromDescription(t.description) !== query.url) return false
        return true
      })

      const page = query.page ?? 1
      const limit = query.limit ?? 50
      const pageSlice = candidates.slice((page - 1) * limit, page * limit)

      const fullTasks = await Promise.all(pageSlice.map(t => getTask(t.id)))
      const records = await Promise.all(fullTasks.map(reconstructFeedbackRecord))
      const feedbacks = records.filter((r): r is FeedbackRecord => r !== null)

      return { feedbacks, total: candidates.length }
    },

    async updateFeedback(id: string, data: FeedbackUpdateInput): Promise<FeedbackRecord> {
      const belongs = await verifyTaskBelongsToFolder(id, portal.clickupFolderId)
      if (!belongs) throw new StoreNotFoundError(`Feedback ${id} not found`)

      await updateTask(id, { status: STATUS_TO_CLICKUP[data.status] })
      await invalidateFolderTasks(portal.clickupFolderId)

      const full = await getTask(id)
      const record = await reconstructFeedbackRecord(full)
      if (!record) throw new StoreNotFoundError(`Feedback ${id} has no siteping data attachment`)
      return record
    },

    async deleteFeedback(id: string): Promise<void> {
      const belongs = await verifyTaskBelongsToFolder(id, portal.clickupFolderId)
      if (!belongs) throw new StoreNotFoundError(`Feedback ${id} not found`)

      await deleteTask(id)
      await invalidateFolderTasks(portal.clickupFolderId)
    },

    async deleteAllFeedbacks(): Promise<void> {
      const tasks = await getAllTasksForFolder(portal.clickupFolderId)
      const targets = tasks.filter(isSitepingTask)
      await Promise.all(targets.map(t => deleteTask(t.id)))
      if (targets.length > 0) await invalidateFolderTasks(portal.clickupFolderId)
    },

    async verifyProjectOwnership(id: string): Promise<boolean> {
      return verifyTaskBelongsToFolder(id, portal.clickupFolderId)
    },
  }
}
