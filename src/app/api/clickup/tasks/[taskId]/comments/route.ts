import { NextRequest, NextResponse } from 'next/server'
import { getSession } from '@/lib/auth'
import { db } from '@/lib/db'
import { portals } from '@/lib/db/schema'
import { eq } from 'drizzle-orm'
import { getTaskComments, addComment, verifyTaskBelongsToFolder } from '@/lib/clickup'

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

  const belongs = await verifyTaskBelongsToFolder(taskId, portal[0].clickupFolderId)
  if (!belongs) return NextResponse.json({ error: 'Forbidden' }, { status: 403 })

  const comments = await getTaskComments(taskId)
  // Opt-in model: only show comments explicitly marked [PUBLIC] by the agency,
  // plus comments added by clients through the portal (prefixed [PUBLIC] automatically on POST).
  const PUBLIC_PREFIX = '[PUBLIC] '
  const CLIENT_NAME_RE = /^\(([^)]+)\) /  // matches "(Name) " at start

  const clientComments = comments
    .filter(c => c.comment_text?.startsWith(PUBLIC_PREFIX))
    .map(c => {
      const withoutPrefix = c.comment_text!.slice(PUBLIC_PREFIX.length)
      const clientMatch = withoutPrefix.match(CLIENT_NAME_RE)
      if (clientMatch) {
        return { ...c, comment_text: withoutPrefix.slice(clientMatch[0].length), sender: clientMatch[1] }
      }
      return { ...c, comment_text: withoutPrefix, sender: 'Important.is' }
    })
  return NextResponse.json({ comments: clientComments })
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

  const belongs = await verifyTaskBelongsToFolder(taskId, portal[0].clickupFolderId)
  if (!belongs) return NextResponse.json({ error: 'Forbidden' }, { status: 403 })

  // All client comments are public by definition — prefix so they pass the filter on GET.
  // Agency team must manually add [PUBLIC] in ClickUp to expose their replies.
  const clientLabel = session.name ? `(${session.name})` : '(Klient)'
  const comment = await addComment(taskId, `[PUBLIC] ${clientLabel} ${text}`)
  return NextResponse.json({ comment })
}
