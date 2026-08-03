import { NextRequest, NextResponse } from 'next/server'
import { getSession } from '@/lib/auth'
import { db } from '@/lib/db'
import { portals, portalLists } from '@/lib/db/schema'
import { eq, and } from 'drizzle-orm'
import { getAllTasksForFolder, getAllTasksForLists, createTask } from '@/lib/clickup'
import { getPortalScope } from '@/lib/portalScopeStore'
import { getSnapshotMap, mergeTrackedTime } from '@/lib/timeSnapshots'
import { withReporterFooter } from '@/lib/reporter'
import { logEvent, EVENT_TASK_CREATED } from '@/lib/portalEvents'
import { invalidateFolderTasks } from '@/lib/clickupCache'

// GET /api/clickup/tasks?slug=wdf
export async function GET(request: NextRequest) {
  const slug = request.nextUrl.searchParams.get('slug')
  if (!slug) return NextResponse.json({ error: 'Missing slug' }, { status: 400 })

  const session = await getSession(slug ?? undefined)
  if (!session || session.portalSlug !== slug) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  const portal = await db
    .select()
    .from(portals)
    .where(eq(portals.slug, slug))
    .limit(1)

  if (!portal[0]) return NextResponse.json({ error: 'Not found' }, { status: 404 })

  // CELOWO bez cache'u, w przeciwieństwie do renderowania strony. Tę trasę
  // woła przycisk „Odśwież", więc podanie z bufora zamieniłoby go w atrapę:
  // klient klika, widzi kręcące się kółko i te same dane.
  const scope = await getPortalScope(portal[0].id)
  const rawTasks = scope.length > 0
    ? await getAllTasksForLists(scope)
    : await getAllTasksForFolder(portal[0].clickupFolderId)
  const snapshots = await getSnapshotMap(portal[0].id)
  const tasks = mergeTrackedTime(rawTasks, snapshots)

  // Świeże dane właśnie zobaczył klient, więc bufor strony jest od tej chwili
  // starszy niż jego ekran. Unieważniamy, żeby kolejne wejście na tablicę nie
  // cofnęło widoku.
  await invalidateFolderTasks(portal[0].clickupFolderId)

  return NextResponse.json({ tasks }, {
    headers: { 'Cache-Control': 'private, max-age=30' }
  })
}

// POST /api/clickup/tasks — create task
export async function POST(request: NextRequest) {
  const body = await request.json()
  const { slug, name, description, priority, due_date } = body

  const session = await getSession(slug ?? undefined)
  if (!session) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  if (!slug || !name) {
    return NextResponse.json({ error: 'Missing required fields' }, { status: 400 })
  }

  if (session.portalSlug !== slug) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  // Get default list for this portal
  const list = await db
    .select()
    .from(portalLists)
    .where(and(
      eq(portalLists.portalId, session.portalId),
      eq(portalLists.isDefault, true)
    ))
    .limit(1)

  if (!list[0]) {
    return NextResponse.json({ error: 'No default list configured' }, { status: 500 })
  }

  const portal = await db.select().from(portals).where(eq(portals.id, session.portalId)).limit(1)
  if (!portal[0]) return NextResponse.json({ error: 'Not found' }, { status: 404 })

  const task = await createTask(list[0].clickupListId, {
    name,
    // Stopka z autorem. Zespół pracuje w ClickUpie i tam musi widzieć, kto
    // zgłosił, bo wszystkie zadania z portalu tworzy jedno konto serwisowe
    // agencji, więc pole „autor" w ClickUpie zawsze pokazuje nas.
    description: withReporterFooter(description, {
      name: session.name,
      email: session.email,
      portalName: portal[0].name,
      portalSlug: portal[0].slug,
      source: 'form',
    }),
    priority: priority ?? null,
    due_date: due_date ?? null,
  })

  await invalidateFolderTasks(portal[0].clickupFolderId)

  // Po utworzeniu, nie przed: zapis historii nie może zablokować zgłoszenia,
  // a wiersz bez istniejącego zadania byłby historią czegoś, co nie powstało.
  await logEvent({
    portalId: session.portalId,
    actor: { userId: session.userId, email: session.email, name: session.name },
    action: EVENT_TASK_CREATED,
    resourceId: task.id,
    meta: { source: 'form', taskName: task.name, url: task.url ?? null, priority: priority ?? null },
  })

  return NextResponse.json({ task })
}
