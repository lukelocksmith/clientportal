import { NextResponse } from 'next/server'
import { getAdminSession } from '@/lib/admin-auth'
import { db } from '@/lib/db'
import { portals } from '@/lib/db/schema'
import { eq } from 'drizzle-orm'

export async function GET() {
  if (!await getAdminSession()) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const list = await db
    .select({ id: portals.id, slug: portals.slug, name: portals.name, isActive: portals.isActive })
    .from(portals)
    .where(eq(portals.isActive, true))
    .orderBy(portals.name)

  return NextResponse.json({ portals: list })
}
