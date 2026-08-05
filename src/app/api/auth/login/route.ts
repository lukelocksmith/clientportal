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
// Historia wejsc. Zapis NIE moze przewrocic logowania, dlatego logEvent
// nigdy nie rzuca wyjatkiem (lib/portalEvents.ts).
import {
  logEvent,
  requestOrigin,
  EVENT_LOGIN,
  EVENT_LOGIN_FAILED,
} from '@/lib/portalEvents'

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

        const skad = requestOrigin(request.headers)
        const token = await createSession(adminUserId, skad.ip ?? undefined, skad.userAgent ?? undefined)
        await setSessionCookie(token)

        // Obejscie admina zapisujemy jawnie. Wejscie z naszej strony wygladalo
        // w historii projektu identycznie jak wejscie klienta, a to dwie rozne
        // rzeczy przy pytaniu "kto tu byl".
        await logEvent({
          portalId: portal[0].id,
          actor: { userId: adminUserId, email: ADMIN_EMAIL, name: 'important.is (obejscie admina)' },
          action: EVENT_LOGIN,
          meta: { ...skad, wejscie: 'obejscie admina' },
        })

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
    const skad = requestOrigin(request.headers)
    const kto = { userId: user[0].id, email: user[0].email, name: user[0].name }

    if (wynik !== 'ok') {
      await logEvent({
        portalId: portal[0].id,
        actor: kto,
        action: EVENT_LOGIN_FAILED,
        meta: { ...skad, wejscie: 'projekt', powod: wynik === 'locked' ? 'konto zablokowane' : 'zle haslo' },
      })
    }

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
    const token = await createSession(user[0].id, skad.ip ?? undefined, skad.userAgent ?? undefined)
    await setSessionCookie(token)

    await logEvent({
      portalId: portal[0].id,
      actor: kto,
      action: EVENT_LOGIN,
      meta: { ...skad, wejscie: 'projekt' },
    })

    return NextResponse.json({ ok: true, slug })
  } catch (error) {
    console.error('Login error:', error)
    return NextResponse.json({ error: 'Server error' }, { status: 500 })
  }
}
