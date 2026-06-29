import { NextRequest, NextResponse } from 'next/server'
import { z } from 'zod'
import { getSession } from '@/lib/auth'
import { db } from '@/lib/db'
import { portals } from '@/lib/db/schema'
import { eq } from 'drizzle-orm'
import { updateTask, verifyTaskBelongsToFolder } from '@/lib/clickup'

const patchSchema = z.object({
  name: z.string().min(1).max(500).optional(),
  description: z.string().max(10000).optional(),
  status: z.string().max(100).optional(),
  priority: z.number().int().min(1).max(4).nullable().optional(),
  due_date: z.number().int().nullable().optional(),
}).strict()

export async function PATCH(
  request: NextRequest,
  { params }: { params: Promise<{ taskId: string }> }
) {
  const session = await getSession()
  if (!session) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const { taskId } = await params

  const parsed = patchSchema.safeParse(await request.json())
  if (!parsed.success) {
    return NextResponse.json({ error: 'Invalid fields', details: parsed.error.flatten() }, { status: 400 })
  }

  // Security: verify task belongs to this client's folder
  const portal = await db
    .select()
    .from(portals)
    .where(eq(portals.id, session.portalId))
    .limit(1)

  if (!portal[0]) return NextResponse.json({ error: 'Not found' }, { status: 404 })

  const belongs = await verifyTaskBelongsToFolder(taskId, portal[0].clickupFolderId)
  if (!belongs) return NextResponse.json({ error: 'Forbidden' }, { status: 403 })

  const task = await updateTask(taskId, parsed.data)
  return NextResponse.json({ task })
}
