import { NextRequest, NextResponse } from 'next/server'
import { isAdminRequest } from '@/lib/admin-auth'
import { db } from '@/lib/db'
import { portals, portalUsers } from '@/lib/db/schema'
import { eq } from 'drizzle-orm'
import bcrypt from 'bcryptjs'
import { z } from 'zod'
import { unusablePasswordHash } from '@/lib/invites'
import { sendInviteEmail } from '@/lib/inviteEmail'

const createSchema = z.object({
  // Provide either portalId (uuid) or slug — slug is friendlier for AI/curl use.
  portalId: z.string().uuid().optional(),
  slug: z.string().min(1).max(50).optional(),
  email: z.string().email().toLowerCase(),
  name: z.string().min(1).max(100),
  /**
   * Opcjonalne. BRAK hasła to teraz ścieżka domyślna: użytkownik dostaje
   * mailem jednorazowy link i ustawia hasło sam, więc my go nigdy nie znamy.
   * Podanie hasła zostaje dla przypadków awaryjnych (klient bez dostępu do
   * maila, konto techniczne) i wtedy zaproszenie nie jest wysyłane.
   */
  password: z.string().min(8).max(100).optional(),
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

  // Bez hasła konto powstaje z hashem, do którego nie istnieje żadne hasło.
  // Konto jest widoczne w panelu od razu, a formularz logowania jest dla niego
  // otwarty, więc puste albo przewidywalne hasło byłoby dziurą.
  const passwordHash = password ? await bcrypt.hash(password, 12) : await unusablePasswordHash()
  const [user] = await db
    .insert(portalUsers)
    .values({ portalId: portal[0].id, email, name, passwordHash })
    .returning()

  // Hasło podane z ręki oznacza świadome pominięcie zaproszenia.
  if (password) {
    return NextResponse.json(
      { user: { id: user.id, email: user.email, name: user.name }, invite: null },
      { status: 201 }
    )
  }

  const invite = await sendInviteEmail({
    userId: user.id,
    userEmail: email,
    userName: name,
    portal: portal[0],
  })

  return NextResponse.json(
    {
      user: { id: user.id, email: user.email, name: user.name },
      invite,
    },
    { status: 201 }
  )
}
