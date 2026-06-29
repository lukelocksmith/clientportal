import { NextRequest, NextResponse } from 'next/server'
import { db } from '@/lib/db'
import { portalUsers, portals } from '@/lib/db/schema'
import { eq, and } from 'drizzle-orm'
import bcrypt from 'bcryptjs'
import { createSession, setSessionCookie } from '@/lib/auth'

const MAX_ATTEMPTS = 5
const LOCKOUT_MINUTES = 15

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

    // Get user
    const user = await db
      .select()
      .from(portalUsers)
      .where(and(
        eq(portalUsers.email, email.toLowerCase()),
        eq(portalUsers.portalId, portal[0].id),
        eq(portalUsers.isActive, true)
      ))
      .limit(1)

    if (!user[0]) {
      return NextResponse.json({ error: 'Invalid credentials' }, { status: 401 })
    }

    // Check lockout
    if (user[0].lockedUntil && user[0].lockedUntil > new Date()) {
      return NextResponse.json(
        { error: 'Konto zablokowane. Spróbuj za kilkanaście minut.' },
        { status: 429 }
      )
    }

    // Verify password
    const valid = await bcrypt.compare(password, user[0].passwordHash)
    if (!valid) {
      const newAttempts = (user[0].failedAttempts ?? 0) + 1
      const lockedUntil = newAttempts >= MAX_ATTEMPTS
        ? new Date(Date.now() + LOCKOUT_MINUTES * 60 * 1000)
        : null

      await db
        .update(portalUsers)
        .set({ failedAttempts: newAttempts, lockedUntil })
        .where(eq(portalUsers.id, user[0].id))

      return NextResponse.json({ error: 'Invalid credentials' }, { status: 401 })
    }

    // Reset failed attempts
    await db
      .update(portalUsers)
      .set({ failedAttempts: 0, lockedUntil: null })
      .where(eq(portalUsers.id, user[0].id))

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
