import { NextRequest, NextResponse } from 'next/server'
import { isAdminRequest } from '@/lib/admin-auth'
import { db } from '@/lib/db'
import { portals, portalUsers } from '@/lib/db/schema'
import { eq } from 'drizzle-orm'
import bcrypt from 'bcryptjs'
import { z } from 'zod'

const createSchema = z.object({
  // Provide either portalId (uuid) or slug — slug is friendlier for AI/curl use.
  portalId: z.string().uuid().optional(),
  slug: z.string().min(1).max(50).optional(),
  email: z.string().email().toLowerCase(),
  name: z.string().min(1).max(100),
  password: z.string().min(8).max(100),
}).strict().refine(d => d.portalId || d.slug, {
  message: 'Podaj portalId albo slug',
})

export async function GET(request: NextRequest) {
  if (!await isAdminRequest(request)) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const users = await db
    .select({
      id: portalUsers.id,
      email: portalUsers.email,
      name: portalUsers.name,
      isActive: portalUsers.isActive,
      createdAt: portalUsers.createdAt,
      lastLoginAt: portalUsers.lastLoginAt,
      portalId: portalUsers.portalId,
      portalName: portals.name,
      portalSlug: portals.slug,
    })
    .from(portalUsers)
    .leftJoin(portals, eq(portalUsers.portalId, portals.id))
    .orderBy(portals.name, portalUsers.email)

  return NextResponse.json({ users })
}

export async function POST(request: NextRequest) {
  if (!await isAdminRequest(request)) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const parsed = createSchema.safeParse(await request.json())
  if (!parsed.success) return NextResponse.json({ error: parsed.error.flatten() }, { status: 400 })

  const { portalId, slug, email, name, password } = parsed.data

  const portal = portalId
    ? await db.select().from(portals).where(eq(portals.id, portalId)).limit(1)
    : await db.select().from(portals).where(eq(portals.slug, slug!)).limit(1)
  if (!portal[0]) return NextResponse.json({ error: 'Portal not found' }, { status: 404 })

  const existing = await db.select({ id: portalUsers.id })
    .from(portalUsers)
    .where(eq(portalUsers.email, email))
    .limit(1)
  if (existing[0]) return NextResponse.json({ error: 'Email already exists' }, { status: 409 })

  const passwordHash = await bcrypt.hash(password, 12)
  const [user] = await db.insert(portalUsers).values({ portalId: portal[0].id, email, name, passwordHash }).returning()

  return NextResponse.json({ user: { id: user.id, email: user.email, name: user.name } }, { status: 201 })
}
