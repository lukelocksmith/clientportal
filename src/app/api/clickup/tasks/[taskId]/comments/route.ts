import { NextRequest, NextResponse } from 'next/server'
import { getSession } from '@/lib/auth'
import { db } from '@/lib/db'
import { portals } from '@/lib/db/schema'
import { eq } from 'drizzle-orm'
import { getTaskComments, addComment, verifyTaskBelongsToFolder } from '@/lib/clickup'
import { filterPublicComments, PUBLIC_PREFIX } from '@/lib/publicComments'
import { logEvent, EVENT_COMMENT_ADDED } from '@/lib/portalEvents'
import { getPortalScope } from '@/lib/portalScopeStore'
import { sortOldestFirst } from '@/lib/utils'

export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ taskId: string }> }
) {
  const slug = request.nextUrl.searchParams.get("slug") ?? undefined
  const session = await getSession(slug)
  if (!session) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const { taskId } = await params

  const portal = await db.select().from(portals).where(eq(portals.id, session.portalId)).limit(1)
  if (!portal[0]) return NextResponse.json({ error: 'Not found' }, { status: 404 })

  // Zakres list portalu, nie tylko folder: bez tego klient odczytalby komentarze
  // zadania z listy, ktorej mu nie udostepnilismy, znajac jego identyfikator.
  const scope = await getPortalScope(portal[0].id)
  const belongs = await verifyTaskBelongsToFolder(taskId, portal[0].clickupFolderId, scope)
  if (!belongs) return NextResponse.json({ error: 'Forbidden' }, { status: 403 })

  const comments = await getTaskComments(taskId)
  // Reguła [PUBLIC] żyje w lib/publicComments.ts, bo ma dwóch konsumentów:
  // tę trasę i indekser Historii. Patrz komentarz w tamtym pliku.
  return NextResponse.json({ comments: sortOldestFirst(filterPublicComments(comments)) })
}

export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ taskId: string }> }
) {
  const slug = request.nextUrl.searchParams.get("slug") ?? undefined
  const session = await getSession(slug)
  if (!session) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const { taskId } = await params
  const { text } = await request.json()

  if (!text?.trim()) return NextResponse.json({ error: 'Empty comment' }, { status: 400 })

  const portal = await db.select().from(portals).where(eq(portals.id, session.portalId)).limit(1)
  if (!portal[0]) return NextResponse.json({ error: 'Not found' }, { status: 404 })

  // Zakres list portalu, nie tylko folder: bez tego klient odczytalby komentarze
  // zadania z listy, ktorej mu nie udostepnilismy, znajac jego identyfikator.
  const scope = await getPortalScope(portal[0].id)
  const belongs = await verifyTaskBelongsToFolder(taskId, portal[0].clickupFolderId, scope)
  if (!belongs) return NextResponse.json({ error: 'Forbidden' }, { status: 403 })

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
