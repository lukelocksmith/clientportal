import { readJson } from '@/lib/apiJson'
import { NextRequest, NextResponse } from 'next/server'
import { z } from 'zod'
import { requirePortalApi, requireTaskInPortal } from '@/lib/apiSession'
import { updateTask, getTask } from '@/lib/clickup'
import { getTaskReporter } from '@/lib/portalEvents'
import { recordStatusChange } from '@/lib/statusHistory'
import { logEvent, EVENT_STATUS_CHANGED } from '@/lib/portalEvents'
import { invalidateFolderTasks } from '@/lib/clickupCache'
import { getPortalScope } from '@/lib/portalScopeStore'
import { taskBelongsToPortal } from '@/lib/portalScope'

/**
 * GET /api/clickup/tasks/{taskId}?slug=onyx
 *
 * Zwraca zadanie ORAZ jego załączniki (endpointy listowe załączników nie
 * dają, dlatego ta trasa powstała).
 *
 * `task` doszło dla zakładki Historia: tabela ma tylko chudą projekcję z
 * indeksu, a szuflada szczegółów chce pełnego ClickUpTask. Kanban czyta
 * dalej samo `attachments`, bo pełne zadanie ma już w stanie tablicy, więc
 * ta zmiana niczego mu nie psuje.
 *
 * `attachments` zostaje jako osobne pole, mimo że jest też w `task`.
 * Zdejmowanie go byłoby zmianą łamiącą dla kanbanu bez żadnego zysku.
 */
export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ taskId: string }> }
) {
  const gate = await requirePortalApi(request.nextUrl.searchParams.get('slug'))
  if (!gate.ok) return gate.response
  const { portal } = gate

  const { taskId } = await params

  // Zadanie pobieramy raz i na nim sprawdzamy przynależność, zamiast wołać
  // `requireTaskInPortal`, które pobrałoby je po raz drugi. Reguła jest ta sama.
  const task = await getTask(taskId)
  const scope = await getPortalScope(portal.id)
  if (!taskBelongsToPortal(task, portal.clickupFolderId, scope)) {
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
  }

  // Zgłaszający. Dopiero PO sprawdzeniu przynależności zadania do folderu
  // klienta, żeby zapytanie o autora nie było drogą do podejrzenia, czy dane
  // zadanie w ogóle istnieje w innym projekcie.
  const reporter = await getTaskReporter(portal.id, taskId)

  return NextResponse.json({ task, attachments: task.attachments ?? [], reporter })
}

const patchSchema = z.object({
  name: z.string().min(1).max(500).optional(),
  description: z.string().max(10000).optional(),
  status: z.string().max(100).optional(),
  priority: z.number().int().min(1).max(4).nullable().optional(),
  due_date: z.number().int().nullable().optional(),
}).strict()

export async function PATCH(
  request: NextRequest,
  { params }: { params: Promise<{ taskId: string }> }
) {
  const gate = await requirePortalApi(request.nextUrl.searchParams.get('slug'))
  if (!gate.ok) return gate.response
  const { portal } = gate

  const { taskId } = await params

  const parsed = patchSchema.safeParse(await readJson(request))
  if (!parsed.success) {
    return NextResponse.json({ error: 'Invalid fields', details: parsed.error.flatten() }, { status: 400 })
  }

  // Security: verify task belongs to this client's folder
  const scope = await requireTaskInPortal(taskId, portal)
  if (!scope.ok) return scope.response

  // Stan PRZED zmianą, żeby historia miała `from`. Pobieramy tylko wtedy, gdy
  // żądanie faktycznie rusza status — przy zmianie samej nazwy byłoby to
  // zmarnowane wywołanie wspólnego tokenu ClickUpa.
  const przed = parsed.data.status ? await getTask(taskId).catch(() => null) : null

  const task = await updateTask(taskId, parsed.data)

  // HISTORIA STATUSÓW. Klient przeciągnął kartę, więc podpisujemy zmianę jego
  // kontem — webhook z ClickUpa przyjdzie chwilę później i podpisałby ją
  // kontem serwisowym agencji, czyli nami.
  if (parsed.data.status) {
    await recordStatusChange({
      portalId: portal.id,
      clickupTaskId: taskId,
      taskName: task.name ?? przed?.name ?? taskId,
      fromStatus: przed?.status?.status ?? null,
      toStatus: parsed.data.status,
      source: 'portal',
      actorUserId: gate.session.userId === 'admin' ? null : gate.session.userId,
      actorLabel: gate.session.name ?? gate.session.email,
    })

    /**
     * Ślad do TŁUMIENIA POWIADOMIENIA o własnym działaniu.
     *
     * `recordStatusChange` wyżej jest historią dla klienta, ta linia jest
     * wpisem technicznym: webhook ClickUpa przyjdzie za chwilę z tą samą
     * zmianą, podpisaną kontem serwisowym agencji, i bez tego wpisu wysłałby
     * klientowi powiadomienie o tym, co sam właśnie zrobił. Producent szuka
     * tutaj po `resourceId` (zadanie) i `meta.toStatus` (wartość), w oknie
     * dwóch minut. Patrz `actorOfRecentStatusChange`.
     */
    await logEvent({
      portalId: portal.id,
      actor: {
        userId: gate.session.userId,
        email: gate.session.email,
        name: gate.session.name,
      },
      action: EVENT_STATUS_CHANGED,
      resourceId: taskId,
      meta: { toStatus: parsed.data.status },
    })
  }

  // Przeciagniecie karty zmienia status w ClickUpie. Bez unieważnienia
  // kolejne wejscie na tablice pokazaloby karte w starej kolumnie, czyli
  // wygladaloby na nieudane przeciagniecie.
  await invalidateFolderTasks(portal.clickupFolderId)

  return NextResponse.json({ task })
}
