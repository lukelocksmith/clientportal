import { NextRequest, NextResponse } from 'next/server'
import { z } from 'zod'
import { setAdminSession } from '@/lib/admin-auth'
import { safeEqual } from '@/lib/apiAuth'
import { consumeRateLimit } from '@/lib/memoryRateLimit'
import bcrypt from 'bcryptjs'

const ADMIN_EMAIL = process.env.ADMIN_EMAIL ?? 'admin@important.is'
const ADMIN_PASSWORD_HASH = process.env.ADMIN_PASSWORD_HASH

// Fallback: legacy ADMIN_SECRET for migration period
const ADMIN_SECRET = process.env.ADMIN_SECRET

/**
 * Limit prób logowania na adres IP. Panel admina nie ma wiersza w bazie, więc
 * licznik żyje w pamięci procesu (patrz memoryRateLimit.ts). Dziesięć prób na
 * kwadrans zatrzymuje brute-force online na hash bcrypt, a nie przeszkadza
 * człowiekowi, który literówkuje hasło.
 */
const LOGIN_LIMIT = 10
const LOGIN_WINDOW_MS = 15 * 60 * 1000

/**
 * Hash stałej treści do porównań, gdy podany email nie jest adminem. Bez tego
 * odrzucenie złego emaila przed bcrypt.compare tworzyło oracle czasowy: brak
 * porównania = natychmiastowa odpowiedź = potwierdzenie, że takiego konta nie ma.
 * Liczony leniwie przy pierwszym użyciu, żeby cold start nie płacił za bcrypt.
 */
let dummyHash: string | null = null
function getDummyHash(): string {
  dummyHash ??= bcrypt.hashSync('admin-login-no-such-account', 12)
  return dummyHash
}

const loginSchema = z.object({
  email: z.string().optional(),
  password: z.string().optional(),
  secret: z.string().optional(),
})

export async function POST(request: NextRequest) {
  const ip = request.headers.get('x-forwarded-for')?.split(',')[0]?.trim() || 'unknown'
  if (!consumeRateLimit(`admin-login:${ip}`, LOGIN_LIMIT, LOGIN_WINDOW_MS)) {
    return NextResponse.json({ error: 'Za dużo prób. Spróbuj ponownie później.' }, { status: 429 })
  }

  const parsed = loginSchema.safeParse(await request.json().catch(() => null))
  if (!parsed.success) {
    return NextResponse.json({ error: 'Email i hasło są wymagane' }, { status: 401 })
  }
  const { email, password, secret } = parsed.data

  // Legacy secret-based login — porównanie constant-time, jak każdy sekret.
  if (secret && ADMIN_SECRET && safeEqual(secret, ADMIN_SECRET)) {
    await setAdminSession()
    return NextResponse.json({ ok: true })
  }

  // Email + password login. Brak pól to błąd żądania (400), nie uwierzytelnienia.
  if (!email || !password) {
    return NextResponse.json({ error: 'Email i hasło są wymagane' }, { status: 400 })
  }

  if (!ADMIN_PASSWORD_HASH && !ADMIN_SECRET) {
    return NextResponse.json({ error: 'Admin not configured' }, { status: 500 })
  }

  if (email !== ADMIN_EMAIL) {
    // Ten sam koszt czasowy co dla poprawnego emaila, żeby odpowiedź nie
    // zdradzała istnienia (albo nieistnienia) konta admina.
    await bcrypt.compare(password, getDummyHash())
    return NextResponse.json({ error: 'Nieprawidłowy email lub hasło' }, { status: 401 })
  }

  if (ADMIN_PASSWORD_HASH) {
    const valid = await bcrypt.compare(password, ADMIN_PASSWORD_HASH)
    if (!valid) return NextResponse.json({ error: 'Nieprawidłowy email lub hasło' }, { status: 401 })
  } else if (ADMIN_SECRET) {
    // No hash set yet — compare against plain secret, constant-time.
    if (!safeEqual(password, ADMIN_SECRET)) {
      return NextResponse.json({ error: 'Nieprawidłowy email lub hasło' }, { status: 401 })
    }
  }

  await setAdminSession()
  return NextResponse.json({ ok: true })
}
