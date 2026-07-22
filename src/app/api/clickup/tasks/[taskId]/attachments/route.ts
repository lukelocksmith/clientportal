import { NextRequest, NextResponse } from 'next/server'
import { getSession } from '@/lib/auth'
import { db } from '@/lib/db'
import { portals } from '@/lib/db/schema'
import { eq } from 'drizzle-orm'
import { addTaskAttachment, verifyTaskBelongsToFolder } from '@/lib/clickup'

export const runtime = 'nodejs'

const MAX_BYTES = 10 * 1024 * 1024 // 10 MB per file
const MAX_FILES = 5

// POST /api/clickup/tasks/{taskId}/attachments?slug=onyx
// Uploads client-supplied files (screenshots) as ClickUp attachments on a task.
export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ taskId: string }> }
) {
  const slug = request.nextUrl.searchParams.get('slug') ?? undefined
  const session = await getSession(slug)
  if (!session || session.portalSlug !== slug) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  const { taskId } = await params

  const portal = await db.select().from(portals).where(eq(portals.slug, slug!)).limit(1)
  if (!portal[0]) return NextResponse.json({ error: 'Not found' }, { status: 404 })

  // IDOR: the task must live in this portal's folder before we touch it.
  const belongs = await verifyTaskBelongsToFolder(taskId, portal[0].clickupFolderId)
  if (!belongs) return NextResponse.json({ error: 'Forbidden' }, { status: 403 })

  const form = await request.formData()
  const files = form.getAll('files').filter((f): f is File => f instanceof File).slice(0, MAX_FILES)

  const results: Array<{ name: string; ok: boolean; url?: string; error?: string }> = []
  for (const file of files) {
    if (file.size > MAX_BYTES) {
      results.push({ name: file.name, ok: false, error: 'Plik za duży (max 10 MB)' })
      continue
    }
    try {
      const buf = await file.arrayBuffer()
      const att = await addTaskAttachment(taskId, new Blob([buf], { type: file.type }), file.name || 'screenshot.png')
      results.push({ name: file.name, ok: true, url: att.url })
    } catch (e) {
      results.push({ name: file.name, ok: false, error: String(e) })
    }
  }

  return NextResponse.json({ attachments: results })
}
