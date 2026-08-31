import { readJson } from '@/lib/apiJson'
import { NextRequest, NextResponse } from 'next/server'
import { z } from 'zod'
import { db } from '@/lib/db'
import { portalLists } from '@/lib/db/schema'
import { eq, and } from 'drizzle-orm'
import { requirePortalApi } from '@/lib/apiSession'
import { getAllTasksForFolder, getAllTasksForLists, getRecentlyClosedTasksForFolder, getRecentlyClosedTasksForLists, createTask } from '@/lib/clickup'
import { getPortalScope } from '@/lib/portalScopeStore'
import { getSnapshotMap, mergeTrackedTime } from '@/lib/timeSnapshots'
import { withReporterFooter } from '@/lib/reporter'
import { assigneesField } from '@/lib/assignee'
import { logEvent, EVENT_TASK_CREATED } from '@/lib/portalEvents'
import { invalidateFolderTasks } from '@/lib/clickupCache'
import { enqueueReport } from '@/lib/pendingReports'
import { normalizeActorId } from '@/lib/reporter'

// GET /api/clickup/tasks?slug=wdf
export async function GET(request: NextRequest) {
  const gate = await requirePortalApi(request.nextUrl.searchParams.get('slug'))
  if (!gate.ok) return gate.response
  const { portal } = gate

  // CELOWO bez cache'u, w przeciwieństwie do renderowania strony. Tę trasę
  // woła przycisk „Odśwież", więc podanie z bufora zamieniłoby go w atrapę:
  // klient klika, widzi kręcące się kółko i te same dane.
  const scope = await getPortalScope(portal.id)
  const rawTasks = scope.length > 0
    ? await getAllTasksForLists(scope)
    : await getAllTasksForFolder(portal.clickupFolderId)
  const recentlyClosed = portal.statusControlsEnabled
    ? scope.length > 0
      ? await getRecentlyClosedTasksForLists(scope)
      : await getRecentlyClosedTasksForFolder(portal.clickupFolderId)
    : []
  const snapshots = await getSnapshotMap(portal.id)
  const tasks = mergeTrackedTime([...rawTasks, ...recentlyClosed], snapshots)

  // Świeże dane właśnie zobaczył klient, więc bufor strony jest od tej chwili
  // starszy niż jego ekran. Unieważniamy, żeby kolejne wejście na tablicę nie
  // cofnęło widoku.
  await invalidateFolderTasks(portal.clickupFolderId)

  return NextResponse.json({ tasks }, {
    headers: { 'Cache-Control': 'private, max-age=30' }
  })
}

// POST /api/clickup/tasks — create task

/**
 * Schemat tworzenia zadania z formularza. Do tej pory pola szły z ciała bez
 * typów i limitów, w kontraście do PATCH obok, który ma `patchSchema.strict()`.
 * Limity są spójne z limitem opisu w PATCH (10k znaków).
 */
const createTaskSchema = z.object({
  slug: z.string().min(1).max(100),
  name: z.string().min(1).max(500),
  description: z.string().max(10000).optional(),
  priority: z.number().int().min(1).max(4).nullable().optional(),
  due_date: z.number().int().nullable().optional(),
})

export async function POST(request: NextRequest) {
  const parsed = createTaskSchema.safeParse(await readJson(request))
  if (!parsed.success) {
    return NextResponse.json({ error: 'Missing required fields', details: parsed.error.flatten() }, { status: 400 })
  }
  const { slug, name, description, priority, due_date } = parsed.data

  const gate = await requirePortalApi(slug)
  if (!gate.ok) return gate.response
  const { session, portal } = gate

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

  // Reguły (stopka, przypisanie) liczymy RAZ i tak samo dla obu dróg: wprost
  // do ClickUpa i do kolejki. Druga implementacja tych samych reguł rozjechałaby
  // się przy pierwszej zmianie.
  const payload = {
    name,
    // Kto to podejmie: ustawienie projektu, a w zapasie osoba agencji
    // (lib/assignee.ts). Brak jednego i drugiego zostawia zadanie
    // nieprzypisane — widoczne na tablicy, więc nie ginie.
    ...assigneesField(portal.defaultAssigneeId),
    // Stopka z autorem. Zespół pracuje w ClickUpie i tam musi widzieć, kto
    // zgłosił, bo wszystkie zadania z portalu tworzy jedno konto serwisowe
    // agencji, więc pole „autor" w ClickUpie zawsze pokazuje nas.
    description: withReporterFooter(description, {
      name: session.name,
      email: session.email,
      portalName: portal.name,
      portalSlug: portal.slug,
      source: 'form' as const,
    }),
    priority: priority ?? null,
    due_date: due_date ?? null,
  }

  let task
  try {
    task = await createTask(list[0].clickupListId, payload)
  } catch (error) {
    /**
     * ClickUp odmówił. Do 31.08 leciało stąd 500, a TREŚĆ ZGŁOSZENIA GINĘŁA:
     * u nas nie zostawało z niej nic. Teraz zgłoszenie ląduje w naszej
     * kolejce, cron je dowozi, a klient dostaje potwierdzenie, bo jego
     * zgłoszenie JEST przyjęte — tylko jeszcze nie widać go na tablicy.
     */
    console.error('[zadania] ClickUp odrzucił utworzenie zadania z formularza:', error)
    const wKolejce = await enqueueReport({
      portalId: portal.id,
      source: 'form',
      clickupListId: list[0].clickupListId,
      payload,
      actor: { userId: normalizeActorId(session.userId), email: session.email, name: session.name },
      error,
    })

    // Jedyny przypadek, w którym klient widzi porażkę: padł ClickUp ORAZ nasza
    // baza, czyli zgłoszenia nie ma już nigdzie i udawanie sukcesu byłoby
    // kłamstwem.
    if (!wKolejce) {
      return NextResponse.json(
        { error: 'Nie udało się zapisać zgłoszenia. Spróbuj ponownie albo kliknij Alarm.' },
        { status: 503 }
      )
    }

    await logEvent({
      portalId: session.portalId,
      actor: { userId: session.userId, email: session.email, name: session.name },
      action: EVENT_TASK_CREATED,
      resourceId: null,
      meta: { source: 'form', taskName: name, wKolejce: true, priority: priority ?? null },
    })

    return NextResponse.json({
      queued: true,
      task: null,
      message: 'Zgłoszenie przyjęte. Pojawi się na tablicy w ciągu kilku minut.',
    })
  }

  await invalidateFolderTasks(portal.clickupFolderId)

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
