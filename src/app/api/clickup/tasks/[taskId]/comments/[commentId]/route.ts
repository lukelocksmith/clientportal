import { NextRequest, NextResponse } from 'next/server'
import { updateComment, deleteComment } from '@/lib/clickup'
import { requirePortalApi, requireTaskInPortal } from '@/lib/apiSession'
import { isCommentOwnedBy } from '@/lib/portalEvents'
import { PUBLIC_PREFIX } from '@/lib/publicComments'

/**
 * Edycja / usunięcie WŁASNEGO komentarza klienta.
 *
 * Własność nie jest po stronie klienta do stwierdzenia — sam ClickUp nie wie,
 * który portalowy użytkownik dodał dany komentarz (wszystkie lecą jednym
 * kontem serwisowym). Rozstrzyga `isCommentOwnedBy`, czyli wiersz w naszym
 * audit_log zapisany przy POST-cie. Bez tego sprawdzenia klient znający cudzy
 * `commentId` mógłby edytować lub kasować komentarze innych osób w tym samym
 * portalu.
 */
async function authorize(
  request: NextRequest,
  taskId: string,
  commentId: string
) {
  const gate = await requirePortalApi(request.nextUrl.searchParams.get('slug'))
  if (!gate.ok) return { ok: false as const, response: gate.response }
  const { session, portal } = gate

  const scope = await requireTaskInPortal(taskId, portal)
  if (!scope.ok) return { ok: false as const, response: scope.response }

  const owned = await isCommentOwnedBy(portal.id, commentId, session.email)
  if (!owned) {
    return { ok: false as const, response: NextResponse.json({ error: 'Forbidden' }, { status: 403 }) }
  }

  return { ok: true as const, session }
}

export async function PUT(
  request: NextRequest,
  { params }: { params: Promise<{ taskId: string; commentId: string }> }
) {
  const { taskId, commentId } = await params
  const { text } = await request.json()
  if (!text?.trim()) return NextResponse.json({ error: 'Empty comment' }, { status: 400 })

  const gate = await authorize(request, taskId, commentId)
  if (!gate.ok) return gate.response

  // Ten sam format podpisu co przy tworzeniu (trasa POST) — inaczej
  // edytowany komentarz zniknąłby z widoku klienta albo stracił autora.
  const clientLabel = gate.session.name ? `(${gate.session.name})` : '(Klient)'
  await updateComment(commentId, `${PUBLIC_PREFIX}${clientLabel} ${text}`)

  return NextResponse.json({ ok: true })
}

export async function DELETE(
  request: NextRequest,
  { params }: { params: Promise<{ taskId: string; commentId: string }> }
) {
  const { taskId, commentId } = await params

  const gate = await authorize(request, taskId, commentId)
  if (!gate.ok) return gate.response

  await deleteComment(commentId)

  return NextResponse.json({ ok: true })
}
