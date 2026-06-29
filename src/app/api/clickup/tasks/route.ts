import { NextRequest, NextResponse } from 'next/server'
import { getSession } from '@/lib/auth'
import { db } from '@/lib/db'
import { portals, portalLists } from '@/lib/db/schema'
import { eq, and } from 'drizzle-orm'
import { getAllTasksForFolder, createTask } from '@/lib/clickup'

// GET /api/clickup/tasks?slug=wdf
export async function GET(request: NextRequest) {
  const slug = request.nextUrl.searchParams.get('slug')
  if (!slug) return NextResponse.json({ error: 'Missing slug' }, { status: 400 })

  const session = await getSession()
  if (!session || session.portalSlug !== slug) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  const portal = await db
    .select()
    .from(portals)
    .where(eq(portals.slug, slug))
    .limit(1)

  if (!portal[0]) return NextResponse.json({ error: 'Not found' }, { status: 404 })

  const tasks = await getAllTasksForFolder(portal[0].clickupFolderId)

  return NextResponse.json({ tasks }, {
    headers: { 'Cache-Control': 'private, max-age=30' }
  })
}

// POST /api/clickup/tasks — create task
export async function POST(request: NextRequest) {
  const session = await getSession()
  if (!session) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const body = await request.json()
  const { slug, name, description, priority, due_date } = body

  if (!slug || !name) {
    return NextResponse.json({ error: 'Missing required fields' }, { status: 400 })
  }

  if (session.portalSlug !== slug) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

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

  const task = await createTask(list[0].clickupListId, {
    name,
    description,
    priority: priority ?? null,
    due_date: due_date ?? null,
  })

  return NextResponse.json({ task })
}
