import { NextRequest, NextResponse } from 'next/server'
import { z } from 'zod'
import { setAdminSession } from '@/lib/admin-auth'
import { safeEqual } from '@/lib/apiAuth'
import { checkLock, clearFailures, recordFailure } from '@/lib/loginThrottle'
import bcrypt from 'bcryptjs'

const ADMIN_EMAIL = process.env.ADMIN_EMAIL ?? 'admin@important.is'
const ADMIN_PASSWORD_HASH = process.env.ADMIN_PASSWORD_HASH

// Fallback: legacy ADMIN_SECRET for migration period
const ADMIN_SECRET = process.env.ADMIN_SECRET

/**
 * Limit prób logowania na adres IP, trzymany W BAZIE (lib/loginThrottle.ts).
 *
 * Do 31.08 licznik żył w pamięci procesu: znikał przy każdym restarcie
 * kontenera, więc deploy w środku ataku zerował go, a przy dwóch instancjach
 * aplikacji nie obowiązywałby w ogóle. Panel admina bez działającego limitu to
 * otwarty brute-force online na hash bcrypt.
 *
 * Pięć prób i piętnaście minut blokady, tyle samo co dla kont klientów
 * (loginAttempts.ts) — jedna reguła w całym portalu, łatwiejsza do
 * wytłumaczenia niż dwie różne.
 */

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
  const kluczBlokady = `admin-login:${ip}`

  // Padnięta baza NIE MOŻE zamknąć wejścia do panelu: wtedy blokada przestaje
  // działać, ale panel działa. Odwrotna decyzja znaczyłaby, że awaria bazy
  // odcina nas od narzędzia, którym się do niej dobieramy.
  const blokada = await checkLock(kluczBlokady).catch(e => {
    console.error('[admin/login] nie udało się sprawdzić blokady:', e)
    return { locked: false, minutes: 0 }
  })
  if (blokada.locked) {
    return NextResponse.json(
      { error: `Za dużo prób. Spróbuj ponownie za ${blokada.minutes} min.` },
      { status: 429 }
    )
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
    await recordFailure(kluczBlokady).catch(() => {})
    return NextResponse.json({ error: 'Nieprawidłowy email lub hasło' }, { status: 401 })
  }

  if (ADMIN_PASSWORD_HASH) {
    const valid = await bcrypt.compare(password, ADMIN_PASSWORD_HASH)
    if (!valid) {
      await recordFailure(kluczBlokady).catch(() => {})
      return NextResponse.json({ error: 'Nieprawidłowy email lub hasło' }, { status: 401 })
    }
  } else if (ADMIN_SECRET) {
    // No hash set yet — compare against plain secret, constant-time.
    if (!safeEqual(password, ADMIN_SECRET)) {
      await recordFailure(kluczBlokady).catch(() => {})
      return NextResponse.json({ error: 'Nieprawidłowy email lub hasło' }, { status: 401 })
    }
  }

  // Udane logowanie zeruje licznik: kolejna literówka nie ma prawa dziedziczyć
  // prób z poprzedniej sesji.
  await clearFailures(kluczBlokady).catch(() => {})
  await setAdminSession()
  return NextResponse.json({ ok: true })
}
