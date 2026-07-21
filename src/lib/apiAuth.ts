import { timingSafeEqual } from 'crypto'
import type { NextRequest } from 'next/server'

/** Constant-time string compare that tolerates length mismatch. */
function safeEqual(a: string, b: string): boolean {
  const ba = Buffer.from(a)
  const bb = Buffer.from(b)
  if (ba.length !== bb.length) return false
  return timingSafeEqual(ba, bb)
}

/**
 * Verify a machine-to-machine token against an env secret. Accepts either an
 * `Authorization: Bearer <token>` header or a `?token=` query param (the latter
 * is convenient for simple cron schedulers). Returns false if the env secret is
 * unset, so an unconfigured endpoint fails closed.
 */
export function verifyToken(request: NextRequest, envVar: string): boolean {
  const expected = process.env[envVar]
  if (!expected) return false

  const auth = request.headers.get('authorization')
  const bearer = auth?.toLowerCase().startsWith('bearer ')
    ? auth.slice(7).trim()
    : null
  const queryToken = request.nextUrl.searchParams.get('token')
  const provided = bearer ?? queryToken
  if (!provided) return false

  return safeEqual(provided, expected)
}
