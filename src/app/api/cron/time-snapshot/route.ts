import { NextRequest, NextResponse } from 'next/server'
import { db } from '@/lib/db'
import { portals } from '@/lib/db/schema'
import { eq } from 'drizzle-orm'
import { getAllTasksForFolder } from '@/lib/clickup'
import { writeSnapshots } from '@/lib/timeSnapshots'
import { verifyToken } from '@/lib/apiAuth'

export const dynamic = 'force-dynamic'

/**
 * Freezes the current ClickUp tracked time (time_spent) for every active
 * portal into task_time_snapshots. Meant to be hit by a scheduler on Friday
 * morning. Auth: `Authorization: Bearer <CRON_SECRET>` or `?token=<CRON_SECRET>`.
 *
 * Optional `?slug=<slug>` limits the run to a single portal (used to seed a
 * portal's snapshot immediately after provisioning).
 */
async function handle(request: NextRequest) {
  if (!verifyToken(request, 'CRON_SECRET')) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  const onlySlug = request.nextUrl.searchParams.get('slug')

  const rows = await db
    .select({ id: portals.id, slug: portals.slug, folderId: portals.clickupFolderId })
    .from(portals)
    .where(eq(portals.isActive, true))

  const targets = onlySlug ? rows.filter(r => r.slug === onlySlug) : rows

  const results: Array<{ slug: string; tasks: number; ok: boolean; error?: string }> = []
  for (const portal of targets) {
    try {
      const tasks = await getAllTasksForFolder(portal.folderId)
      const count = await writeSnapshots(portal.id, tasks)
      results.push({ slug: portal.slug, tasks: count, ok: true })
    } catch (e) {
      results.push({ slug: portal.slug, tasks: 0, ok: false, error: String(e) })
    }
  }

  return NextResponse.json({ ranAt: new Date().toISOString(), portals: results })
}

export async function POST(request: NextRequest) {
  return handle(request)
}

export async function GET(request: NextRequest) {
  return handle(request)
}
