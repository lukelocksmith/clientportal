import { NextRequest, NextResponse } from 'next/server'
import { createHmac, timingSafeEqual } from 'crypto'
import { revalidatePath } from 'next/cache'
import { db } from '@/lib/db'
import { portals } from '@/lib/db/schema'
import { getTask } from '@/lib/clickup'
import { indexSingleTask, removeTaskFromIndex } from '@/lib/taskIndex'
import { recordStatusChange } from '@/lib/statusHistory'
import {
  notifyOnComment,
  notifyOnStatusChange,
  notifyOnTaskCreated,
} from '@/lib/notifyFromWebhook'
import { parseStatusChange, type ClickUpHistoryItem } from '@/lib/clickupHistoryItems'

const WEBHOOK_SECRET = process.env.CLICKUP_WEBHOOK_SECRET

/** Zdarzenia dotyczące samego zadania. */
const TASK_EVENTS = [
  'taskCreated',
  'taskUpdated',
  'taskDeleted',
  'taskStatusUpdated',
  'taskPriorityUpdated',
  'taskMoved',
]

/**
 * Zdarzenia komentarzy. Ważne dla indeksu Historii, bo wyszukiwarka obejmuje
 * komentarze [PUBLIC], a zmiana komentarza NIE musi ruszyć `date_updated`
 * zadania. Bez tych zdarzeń przyrostowa synchronizacja mogłaby przeoczyć
 * zdjęcie prefiksu [PUBLIC], czyli zostawić wycofaną treść w indeksie.
 * Tygodniowy przebieg z `force=1` jest siatką bezpieczeństwa, to jest ścieżka
 * szybka.
 */
const COMMENT_EVENTS = ['taskCommentPosted', 'taskCommentUpdated']

export async function POST(request: NextRequest) {
  if (!WEBHOOK_SECRET) {
    console.error('[webhook] CLICKUP_WEBHOOK_SECRET is not set — rejecting all webhooks')
    return NextResponse.json({ error: 'Webhook not configured' }, { status: 503 })
  }

  const signature = request.headers.get('x-signature')
  const body = await request.text()

  const expected = createHmac('sha256', WEBHOOK_SECRET).update(body).digest('hex')
  const signatureOk = signature != null &&
    signature.length === expected.length &&
    timingSafeEqual(Buffer.from(signature, 'utf8'), Buffer.from(expected, 'utf8'))

  if (!signatureOk) {
    return NextResponse.json({ error: 'Invalid signature' }, { status: 401 })
  }

  let payload: {
    event: string
    task_id?: string
    webhook_id?: string
    history_items?: ClickUpHistoryItem[]
  }
  try {
    payload = JSON.parse(body)
  } catch {
    return NextResponse.json({ error: 'Invalid JSON' }, { status: 400 })
  }

  const isTaskEvent = TASK_EVENTS.includes(payload.event)
  const isCommentEvent = COMMENT_EVENTS.includes(payload.event)
  if (!isTaskEvent && !isCommentEvent) {
    return NextResponse.json({ ok: true, ignored: payload.event })
  }

  const allPortals = await db
    .select({ id: portals.id, slug: portals.slug, folderId: portals.clickupFolderId })
    .from(portals)

  // Kanban czyta ClickUpa na żywo, więc jego wystarczy unieważnić.
  for (const { slug } of allPortals) {
    revalidatePath(`/${slug}`)
  }

  const taskId = payload.task_id
  if (!taskId) return NextResponse.json({ ok: true })

  if (payload.event === 'taskDeleted') {
    // Usunięte zadanie nie da się już pobrać, więc nie wiemy, do którego
    // folderu należało. Kasujemy z indeksu każdego portalu; wiersz istnieje
    // najwyżej w jednym, a klucz (portal_id, clickup_task_id) czyni to tanim.
    for (const portal of allPortals) {
      await removeTaskFromIndex(portal.id, taskId)
      revalidatePath(`/${portal.slug}/historia`)
    }
    return NextResponse.json({ ok: true, removed: taskId })
  }

  try {
    // Folder zadania decyduje, do którego portalu należy. Bierzemy go z
    // ClickUpa, nie z payloadu, bo payload folderu nie zawiera. To ta sama
    // granica bezpieczeństwa co przy pozostałych ścieżkach.
    const task = await getTask(taskId)
    const folderId = task.folder?.id
    const target = folderId ? allPortals.find(p => p.folderId === folderId) : undefined

    if (!target) {
      // Zadanie spoza folderów klienckich (np. wewnętrzne agencji). Jeśli
      // wcześniej było w indeksie, znaczy że je przeniesiono i musi z niego
      // wypaść, inaczej klient zachowałby przeszukiwalną kopię.
      for (const portal of allPortals) {
        await removeTaskFromIndex(portal.id, taskId)
      }
      return NextResponse.json({ ok: true, outsideClientFolders: true })
    }

    // Przeniesienie MIĘDZY folderami klientów: usuń ze wszystkich pozostałych,
    // zanim zapiszesz w docelowym.
    for (const portal of allPortals) {
      if (portal.id !== target.id) await removeTaskFromIndex(portal.id, taskId)
    }

    await indexSingleTask(target.id, taskId)

    // HISTORIA STATUSÓW. Zapisujemy PO ustaleniu portalu, bo wiersz bez
    // projektu byłby historią niczyją, i tylko gdy zdarzenie faktycznie niesie
    // zmianę statusu — `taskUpdated` przychodzi też przy zmianie opisu.
    //
    // Nazwę zadania bierzemy z zadania pobranego wyżej, a nie z payloadu:
    // payload jej nie zawiera, a kolumna jest zdenormalizowana właśnie po to,
    // żeby wiersz przeżył usunięcie zadania w ClickUpie.
    const zmiana = parseStatusChange(payload.history_items)
    if (zmiana) {
      await recordStatusChange({
        portalId: target.id,
        clickupTaskId: taskId,
        taskName: task.name ?? taskId,
        fromStatus: zmiana.fromStatus,
        toStatus: zmiana.toStatus,
        source: 'webhook',
        actorLabel: zmiana.actorLabel,
        changedAt: zmiana.changedAt ?? undefined,
      })
    }

    /**
     * POWIADOMIENIA. Krok osobny i po indeksowaniu, bo indeks Historii jest
     * ważniejszy: gdyby powiadomienie wywróciło trasę, ClickUp ponawiałby
     * zdarzenie, a po serii nieudanych prób wyłączyłby subskrypcję i zabrałby
     * przy okazji indeksowanie. `produceNotifications` nie rzuca wyjątkiem,
     * a `catch` niżej jest drugą siatką.
     *
     * Brama projektu jest wewnątrz producenta: portal bez ustawionej macierzy
     * nie dostaje nic, więc ta ścieżka jest domyślnie cicha wszędzie.
     */
    try {
      if (isCommentEvent) {
        await notifyOnComment({ portalId: target.id, taskId, taskName: task.name ?? taskId })
      } else if (zmiana) {
        await notifyOnStatusChange({
          portalId: target.id,
          taskId,
          taskName: task.name ?? taskId,
          change: zmiana,
        })
      } else if (payload.event === 'taskCreated') {
        await notifyOnTaskCreated({ portalId: target.id, taskId, taskName: task.name ?? taskId })
      }
    } catch (e) {
      console.error(`[webhook] powiadomienia dla zadania ${taskId} nie powiodły się:`, e)
    }

    revalidatePath(`/${target.slug}/historia`)

    return NextResponse.json({ ok: true, indexed: taskId, portal: target.slug })
  } catch (e) {
    // Webhook nie może zwrócić błędu z powodu jednego zadania, bo ClickUp
    // zacząłby ponawiać albo wyłączyłby subskrypcję. Cron i tak to nadrobi.
    console.error(`[webhook] nie udało się zindeksować zadania ${taskId}:`, e)
    return NextResponse.json({ ok: true, indexFailed: taskId })
  }
}
