import { NextRequest, NextResponse } from 'next/server'
import { requirePortalApi, requireTaskInPortal } from '@/lib/apiSession'
import { addTaskAttachment } from '@/lib/clickup'

export const runtime = 'nodejs'

const MAX_BYTES = 10 * 1024 * 1024 // 10 MB per file
const MAX_FILES = 5

// POST /api/clickup/tasks/{taskId}/attachments?slug=onyx
// Uploads client-supplied files (screenshots) as ClickUp attachments on a task.
export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ taskId: string }> }
) {
  const gate = await requirePortalApi(request.nextUrl.searchParams.get('slug'))
  if (!gate.ok) return gate.response

  const { taskId } = await params

  // IDOR: the task must live in this portal's folder before we touch it.
  const scope = await requireTaskInPortal(taskId, gate.portal)
  if (!scope.ok) return scope.response

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
