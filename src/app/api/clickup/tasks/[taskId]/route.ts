import { NextRequest, NextResponse } from 'next/server'
import { z } from 'zod'
import { getSession } from '@/lib/auth'
import { db } from '@/lib/db'
import { portals } from '@/lib/db/schema'
import { eq } from 'drizzle-orm'
import { updateTask, verifyTaskBelongsToFolder, getTask } from '@/lib/clickup'
import { getTaskReporter } from '@/lib/portalEvents'
import { invalidateFolderTasks } from '@/lib/clickupCache'
import { getPortalScope } from '@/lib/portalScopeStore'
import { isListInScope } from '@/lib/portalScope'

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
  const slug = request.nextUrl.searchParams.get('slug') ?? undefined
  const session = await getSession(slug)
  if (!session || (slug && session.portalSlug !== slug)) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  const { taskId } = await params

  const portal = await db
    .select()
    .from(portals)
    .where(eq(portals.id, session.portalId))
    .limit(1)
  if (!portal[0]) return NextResponse.json({ error: 'Not found' }, { status: 404 })

  const task = await getTask(taskId)
  const scope = await getPortalScope(portal[0].id)
  // Folder ORAZ lista. Folder klienta moze zawierac listy, ktorych do portalu
  // nie wybralismy, a szuflada szczegolow pokazuje opis, komentarze i zalaczniki.
  if (task.folder?.id !== portal[0].clickupFolderId || !isListInScope(task.list?.id, scope)) {
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
  }

  // Zgłaszający. Dopiero PO sprawdzeniu przynależności zadania do folderu
  // klienta, żeby zapytanie o autora nie było drogą do podejrzenia, czy dane
  // zadanie w ogóle istnieje w innym projekcie.
  const reporter = await getTaskReporter(portal[0].id, taskId)

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
  const slug = request.nextUrl.searchParams.get('slug') ?? undefined
  const session = await getSession(slug)
  if (!session) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const { taskId } = await params

  const parsed = patchSchema.safeParse(await request.json())
  if (!parsed.success) {
    return NextResponse.json({ error: 'Invalid fields', details: parsed.error.flatten() }, { status: 400 })
  }

  // Security: verify task belongs to this client's folder
  const portal = await db
    .select()
    .from(portals)
    .where(eq(portals.id, session.portalId))
    .limit(1)

  if (!portal[0]) return NextResponse.json({ error: 'Not found' }, { status: 404 })

  const scope = await getPortalScope(portal[0].id)
  const belongs = await verifyTaskBelongsToFolder(taskId, portal[0].clickupFolderId, scope)
  if (!belongs) return NextResponse.json({ error: 'Forbidden' }, { status: 403 })

  const task = await updateTask(taskId, parsed.data)

  // Przeciagniecie karty zmienia status w ClickUpie. Bez unieważnienia
  // kolejne wejscie na tablice pokazaloby karte w starej kolumnie, czyli
  // wygladaloby na nieudane przeciagniecie.
  await invalidateFolderTasks(portal[0].clickupFolderId)

  return NextResponse.json({ task })
}
