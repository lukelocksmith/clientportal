import { cookies } from 'next/headers'
import { createHmac, timingSafeEqual } from 'crypto'
import type { NextRequest } from 'next/server'
import { verifyToken as verifyTokenBearer } from './apiAuth'

const ADMIN_COOKIE = 'admin_session'
const SECRET = process.env.ADMIN_SECRET

function signedToken(): string {
  // Store HMAC of a fixed payload — never the raw secret
  return createHmac('sha256', SECRET!).update('admin-session').digest('hex')
}

function verifyToken(value: string): boolean {
  const expected = signedToken()
  if (value.length !== expected.length) return false
  return timingSafeEqual(Buffer.from(value), Buffer.from(expected))
}

export async function getAdminSession(): Promise<boolean> {
  if (!SECRET) return false
  const jar = await cookies()
  const value = jar.get(ADMIN_COOKIE)?.value
  if (!value) return false
  return verifyToken(value)
}

/**
 * Admin authorization for API routes: passes if the request carries a valid
 * `ADMIN_API_TOKEN` (Bearer or ?token=) OR a valid admin session cookie.
 * The token path is what makes portal/user management AI-first — manageable
 * from the terminal via curl without a browser login.
 */
export async function isAdminRequest(request: NextRequest): Promise<boolean> {
  if (verifyTokenBearer(request, 'ADMIN_API_TOKEN')) return true
  return getAdminSession()
}

export async function setAdminSession() {
  const jar = await cookies()
  jar.set(ADMIN_COOKIE, signedToken(), {
    httpOnly: true,
    secure: process.env.NODE_ENV === 'production',
    sameSite: 'lax',
    maxAge: 60 * 60 * 8,
    path: '/',  // must be '/' so cookie reaches /api/admin/* routes too
  })
}

export async function clearAdminSession() {
  const jar = await cookies()
  jar.delete(ADMIN_COOKIE)
}
