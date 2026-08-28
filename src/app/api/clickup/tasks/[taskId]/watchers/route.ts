import { NextRequest, NextResponse } from 'next/server'
import { z } from 'zod'
import { readJson } from '@/lib/apiJson'
import { requirePortalApi, requireTaskInPortal } from '@/lib/apiSession'
import { normalizeActorId } from '@/lib/reporter'
import { listWatchers, listCandidates, addWatcher, removeWatcher } from '@/lib/taskWatchers'

/**
 * Obserwatorzy zadania: kto POZA zgłaszającym dostaje maila o tej sprawie.
 *
 * Każda metoda przechodzi przez `requirePortalApi` (sesja portalu) i przez
 * `requireTaskInPortal` (czy to zadanie w ogóle należy do tego projektu).
 * Drugie sprawdzenie jest tu kluczowe, bo identyfikator zadania przychodzi
 * z adresu: bez niego dałoby się dopisać obserwatora do cudzej sprawy albo
 * wylistować, kto ją obserwuje.
 *
 * Kandydatów zwracamy przy okazji GET-a, żeby szuflada nie strzelała dwa razy
 * przy otwarciu jednego zadania. Lista jest krótka: to konta jednego projektu.
 */

const bodySchema = z.object({ userId: z.string().uuid() })

export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ taskId: string }> }
) {
  const gate = await requirePortalApi(request.nextUrl.searchParams.get('slug'))
  if (!gate.ok) return gate.response

  const { taskId } = await params
  const scope = await requireTaskInPortal(taskId, gate.portal)
  if (!scope.ok) return scope.response

  const [watchers, candidates] = await Promise.all([
    listWatchers(gate.portal.id, taskId),
    listCandidates(gate.portal.id),
  ])
  return NextResponse.json({ watchers, candidates })
}

export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ taskId: string }> }
) {
  const gate = await requirePortalApi(request.nextUrl.searchParams.get('slug'))
  if (!gate.ok) return gate.response

  const { taskId } = await params
  const scope = await requireTaskInPortal(taskId, gate.portal)
  if (!scope.ok) return scope.response

  const parsed = bodySchema.safeParse(await readJson(request))
  if (!parsed.success) {
    return NextResponse.json({ error: 'Podaj userId konta z tego projektu' }, { status: 400 })
  }

  // Sesja admina (obejście) nie jest wierszem w `portal_users`, więc jako
  // „dopisujący" idzie NULL. Ten sam sentinel co przy komentarzach.
  const added = await addWatcher({
    portalId: gate.portal.id,
    clickupTaskId: taskId,
    userId: parsed.data.userId,
    addedBy: normalizeActorId(gate.session.userId),
  })
  if (!added) {
    // Konto spoza projektu albo wyłączone. Ta sama odpowiedź w obu wypadkach:
    // po kodzie błędu nie wolno zgadywać, czy dane konto istnieje gdzie indziej.
    return NextResponse.json({ error: 'Nie można dopisać tego konta' }, { status: 400 })
  }

  return NextResponse.json({ watchers: await listWatchers(gate.portal.id, taskId) })
}

export async function DELETE(
  request: NextRequest,
  { params }: { params: Promise<{ taskId: string }> }
) {
  const gate = await requirePortalApi(request.nextUrl.searchParams.get('slug'))
  if (!gate.ok) return gate.response

  const { taskId } = await params
  const scope = await requireTaskInPortal(taskId, gate.portal)
  if (!scope.ok) return scope.response

  const userId = request.nextUrl.searchParams.get('userId')
  if (!userId || !z.string().uuid().safeParse(userId).success) {
    return NextResponse.json({ error: 'Podaj userId' }, { status: 400 })
  }

  await removeWatcher(gate.portal.id, taskId, userId)
  return NextResponse.json({ watchers: await listWatchers(gate.portal.id, taskId) })
}
