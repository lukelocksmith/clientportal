import { SignJWT, jwtVerify } from 'jose'
import { cookies } from 'next/headers'
import { db } from './db'
import { sessions, portalUsers, portals } from './db/schema'
import { eq, and, gt } from 'drizzle-orm'
import type { Session } from './types'
import { createHash, randomBytes } from 'crypto'

const JWT_SECRET = new TextEncoder().encode(
  process.env.JWT_SECRET ?? 'dev-secret-change-in-production'
)
const COOKIE_NAME = 'portal_session'
const SESSION_DURATION = 7 * 24 * 60 * 60 * 1000 // 7 days

export function hashToken(token: string): string {
  return createHash('sha256').update(token).digest('hex')
}

export async function createSession(userId: string, ip?: string, userAgent?: string): Promise<string> {
  const token = randomBytes(32).toString('hex')
  const tokenHash = hashToken(token)
  const expiresAt = new Date(Date.now() + SESSION_DURATION)

  await db.insert(sessions).values({
    userId,
    tokenHash,
    expiresAt,
    ip,
    userAgent,
  })

  // Update last login
  await db.update(portalUsers)
    .set({ lastLoginAt: new Date() })
    .where(eq(portalUsers.id, userId))

  return token
}

export async function getSession(): Promise<Session | null> {
  try {
    const cookieStore = await cookies()
    const token = cookieStore.get(COOKIE_NAME)?.value
    if (!token) return null

    const tokenHash = hashToken(token)
    const now = new Date()

    const result = await db
      .select({
        userId: sessions.userId,
        expiresAt: sessions.expiresAt,
        email: portalUsers.email,
        name: portalUsers.name,
        isActive: portalUsers.isActive,
        portalId: portalUsers.portalId,
        portalSlug: portals.slug,
      })
      .from(sessions)
      .innerJoin(portalUsers, eq(sessions.userId, portalUsers.id))
      .innerJoin(portals, eq(portalUsers.portalId, portals.id))
      .where(and(eq(sessions.tokenHash, tokenHash), gt(sessions.expiresAt, now)))
      .limit(1)

    if (!result[0] || !result[0].isActive) return null

    return {
      userId: result[0].userId,
      portalId: result[0].portalId,
      portalSlug: result[0].portalSlug,
      email: result[0].email,
      name: result[0].name,
      expiresAt: result[0].expiresAt,
    }
  } catch {
    return null
  }
}

export async function setSessionCookie(token: string) {
  const cookieStore = await cookies()
  cookieStore.set(COOKIE_NAME, token, {
    httpOnly: true,
    secure: process.env.NODE_ENV === 'production',
    sameSite: 'lax',
    maxAge: SESSION_DURATION / 1000,
    path: '/',
  })
}

export async function deleteSessionCookie() {
  const cookieStore = await cookies()
  const token = cookieStore.get(COOKIE_NAME)?.value
  cookieStore.delete(COOKIE_NAME)

  if (token) {
    const tokenHash = hashToken(token)
    await db.delete(sessions).where(eq(sessions.tokenHash, tokenHash))
  }
}

export async function requireSession(slug: string): Promise<Session> {
  const session = await getSession()
  if (!session || session.portalSlug !== slug) {
    throw new Error('Unauthorized')
  }
  return session
}
