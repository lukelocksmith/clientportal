import { NextRequest, NextResponse } from 'next/server'
import { getAdminSession } from '@/lib/admin-auth'
import { db } from '@/lib/db'
import { portals, portalLists } from '@/lib/db/schema'
import { eq } from 'drizzle-orm'
import { z } from 'zod'

export async function GET() {
  if (!await getAdminSession()) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const list = await db
    .select({ id: portals.id, slug: portals.slug, name: portals.name, isActive: portals.isActive })
    .from(portals)
    .orderBy(portals.name)

  return NextResponse.json({ portals: list })
}

const CreatePortalSchema = z.object({
  name: z.string().min(1).max(100),
  slug: z.string().min(1).max(50).regex(/^[a-z0-9-]+$/, 'Tylko małe litery, cyfry i myślniki'),
  clickupFolderUrl: z.string().url().optional(),
  clickupFolderId: z.string().min(1),
  clickupSpaceId: z.string().optional().default('90100136256'),
  lists: z.array(z.object({
    clickupListId: z.string().min(1),
    displayName: z.string().min(1),
    isDefault: z.boolean().default(false),
  })).min(1, 'Podaj przynajmniej jedną listę'),
})

export async function POST(request: NextRequest) {
  if (!await getAdminSession()) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const body = await request.json()

  // Auto-extract folder ID from ClickUp URL if provided
  if (body.clickupFolderUrl && !body.clickupFolderId) {
    const match = body.clickupFolderUrl.match(/\/f\/(\d+)/)
    if (match) body.clickupFolderId = match[1]
  }

  const parsed = CreatePortalSchema.safeParse(body)
  if (!parsed.success) {
    return NextResponse.json({ error: parsed.error.flatten() }, { status: 400 })
  }

  const { name, slug, clickupFolderId, clickupSpaceId, lists } = parsed.data

  const [portal] = await db
    .insert(portals)
    .values({ name, slug, clickupFolderId, clickupSpaceId: clickupSpaceId ?? '90100136256' })
    .onConflictDoNothing()
    .returning()

  if (!portal) {
    return NextResponse.json({ error: 'Portal z tym slugiem już istnieje' }, { status: 409 })
  }

  for (let i = 0; i < lists.length; i++) {
    await db.insert(portalLists).values({
      portalId: portal.id,
      clickupListId: lists[i].clickupListId,
      displayName: lists[i].displayName,
      isDefault: i === 0 ? true : lists[i].isDefault,
      sortOrder: i,
    })
  }

  return NextResponse.json({ portal }, { status: 201 })
}
