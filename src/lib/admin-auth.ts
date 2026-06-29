import { cookies } from 'next/headers'
import { createHmac, timingSafeEqual } from 'crypto'

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
