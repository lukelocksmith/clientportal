import { NextRequest, NextResponse } from 'next/server'
import { getTaskComments, addComment } from '@/lib/clickup'
import { requirePortalApi, requireTaskInPortal } from '@/lib/apiSession'
import { filterPublicComments, PUBLIC_PREFIX } from '@/lib/publicComments'
import { logEvent, EVENT_COMMENT_ADDED } from '@/lib/portalEvents'
import { sortOldestFirst } from '@/lib/utils'

export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ taskId: string }> }
) {
  const gate = await requirePortalApi(request.nextUrl.searchParams.get('slug'))
  if (!gate.ok) return gate.response

  const { taskId } = await params
  const scope = await requireTaskInPortal(taskId, gate.portal)
  if (!scope.ok) return scope.response

  const comments = await getTaskComments(taskId)
  // Reguła [PUBLIC] żyje w lib/publicComments.ts, bo ma dwóch konsumentów:
  // tę trasę i indekser Historii. Patrz komentarz w tamtym pliku.
  return NextResponse.json({ comments: sortOldestFirst(filterPublicComments(comments)) })
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
  await logEvent({
    portalId: session.portalId,
    actor: { userId: session.userId, email: session.email, name: session.name },
    action: EVENT_COMMENT_ADDED,
    resourceId: taskId,
    meta: { excerpt: text.trim().slice(0, 200) },
  })

  return NextResponse.json({ comment })
}
