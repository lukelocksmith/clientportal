import { NextRequest, NextResponse } from 'next/server'
import { getTaskComments, addComment } from '@/lib/clickup'
import { requirePortalApi, requireTaskInPortal } from '@/lib/apiSession'
import { filterPublicComments, PUBLIC_PREFIX } from '@/lib/publicComments'
import { logEvent, getOwnedCommentIds, EVENT_COMMENT_ADDED } from '@/lib/portalEvents'
import { sortOldestFirst } from '@/lib/utils'

export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ taskId: string }> }
) {
  const gate = await requirePortalApi(request.nextUrl.searchParams.get('slug'))
  if (!gate.ok) return gate.response
  const { session, portal } = gate

  const { taskId } = await params
  const scope = await requireTaskInPortal(taskId, gate.portal)
  if (!scope.ok) return scope.response

  const comments = await getTaskComments(taskId)
  // Reguła [PUBLIC] żyje w lib/publicComments.ts, bo ma dwóch konsumentów:
  // tę trasę i indekser Historii. Patrz komentarz w tamtym pliku.
  const visible = sortOldestFirst(filterPublicComments(comments))
  // isOwn steruje przyciskami edycji/usuwania w szufladzie — tylko przy
  // komentarzach, które ten adres sam dodał z portalu.
  const ownedIds = await getOwnedCommentIds(portal.id, session.email, visible.map(c => c.id))
  return NextResponse.json({
    comments: visible.map(c => ({ ...c, isOwn: ownedIds.has(c.id) })),
  })
}

export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ taskId: string }> }
) {
  const gate = await requirePortalApi(request.nextUrl.searchParams.get('slug'))
  if (!gate.ok) return gate.response
  const { session } = gate

  const { taskId } = await params
  const { text } = await request.json()

  if (!text?.trim()) return NextResponse.json({ error: 'Empty comment' }, { status: 400 })

  const scope = await requireTaskInPortal(taskId, gate.portal)
  if (!scope.ok) return scope.response

  // All client comments are public by definition — prefix so they pass the filter on GET.
  // Agency team must manually add [PUBLIC] in ClickUp to expose their replies.
  const clientLabel = session.name ? `(${session.name})` : '(Klient)'
  const comment = await addComment(taskId, `${PUBLIC_PREFIX}${clientLabel} ${text}`)

  // Podpis "(Imię)" w ClickUpie jest tekstem i imiona się powtarzają, więc
  // rozstrzygające przypisanie do konta trzymamy u siebie.
  // resourceId = id KOMENTARZA (nie zadania) — to on jest kluczem, po którym
  // trasa PUT/DELETE rozstrzyga, czy wolno go edytować/usunąć. taskId zostaje
  // w meta, gdyby był kiedyś potrzebny do wyświetlenia.
  await logEvent({
    portalId: session.portalId,
    actor: { userId: session.userId, email: session.email, name: session.name },
    action: EVENT_COMMENT_ADDED,
    resourceId: comment.id,
    meta: { excerpt: text.trim().slice(0, 200), taskId },
  })

  return NextResponse.json({ comment })
}
