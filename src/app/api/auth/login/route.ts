import { NextRequest, NextResponse } from 'next/server'
import { db } from '@/lib/db'
import { portalUsers, portals } from '@/lib/db/schema'
import { eq, and } from 'drizzle-orm'
import bcrypt from 'bcryptjs'
import { createSession, setSessionCookie } from '@/lib/auth'
import { ensureAdminUser } from '@/lib/adminUser'
// Blokada po nieudanych probach jest WSPOLNA z logowaniem ze strony glownej
// (lib/loginAttempts.ts). Dwie kopie znaczylyby, ze jedno wejscie zostaje
// kiedys bez limitu, a napastnik wybiera to slabsze.
import { verifyUserPassword } from '@/lib/loginAttempts'

const ADMIN_EMAIL = process.env.ADMIN_EMAIL ?? 'admin@important.is'
const ADMIN_PASSWORD_HASH = process.env.ADMIN_PASSWORD_HASH

export async function POST(request: NextRequest) {
  try {
    const { email, password, slug } = await request.json()

    if (!email || !password || !slug) {
      return NextResponse.json({ error: 'Missing fields' }, { status: 400 })
    }

    // Get portal by slug
    const portal = await db
      .select()
      .from(portals)
      .where(and(eq(portals.slug, slug), eq(portals.isActive, true)))
      .limit(1)

    if (!portal[0]) {
      return NextResponse.json({ error: 'Invalid credentials' }, { status: 401 })
    }

    const normalizedEmail = email.toLowerCase()

    // Admin bypass: admin@important.is can log in to any portal
    if (ADMIN_PASSWORD_HASH && normalizedEmail === ADMIN_EMAIL.toLowerCase()) {
      const adminValid = await bcrypt.compare(password, ADMIN_PASSWORD_HASH)
      if (adminValid) {
        // Konto admina w tym projekcie: znajdź albo utwórz. Ta sama funkcja
        // wołana jest przy tworzeniu portalu, więc zwykle konto już istnieje.
        const adminUserId = await ensureAdminUser(portal[0].id)
        if (!adminUserId) {
          return NextResponse.json({ error: 'Invalid credentials' }, { status: 401 })
        }

        const ip = request.headers.get('x-forwarded-for') ?? undefined
        const ua = request.headers.get('user-agent') ?? undefined
        const token = await createSession(adminUserId, ip, ua)
        await setSessionCookie(token)
        return NextResponse.json({ ok: true, slug })
      }
    }

    // Regular user login
    const user = await db
      .select()
      .from(portalUsers)
      .where(and(
        eq(portalUsers.email, normalizedEmail),
        eq(portalUsers.portalId, portal[0].id),
        eq(portalUsers.isActive, true)
      ))
      .limit(1)

    if (!user[0]) {
      return NextResponse.json({ error: 'Invalid credentials' }, { status: 401 })
    }

    const wynik = await verifyUserPassword(user[0], password)
    if (wynik === 'locked') {
      return NextResponse.json(
        { error: 'Konto zablokowane. Spróbuj za kilkanaście minut.' },
        { status: 429 }
      )
    }
    if (wynik === 'bad') {
      return NextResponse.json({ error: 'Invalid credentials' }, { status: 401 })
    }

    // Create session
    const ip = request.headers.get('x-forwarded-for') ?? undefined
    const ua = request.headers.get('user-agent') ?? undefined
    const token = await createSession(user[0].id, ip, ua)
    await setSessionCookie(token)

    return NextResponse.json({ ok: true, slug })
  } catch (error) {
    console.error('Login error:', error)
    return NextResponse.json({ error: 'Server error' }, { status: 500 })
  }
}
