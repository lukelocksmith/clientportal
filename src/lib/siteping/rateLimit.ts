/**
 * Rate-limit w pamieci procesu dla /api/siteping/[slug].
 *
 * `@siteping/adapter-prisma` jawnie NIE robi rate-limitu (dokumentacja
 * pakietu: "apply at framework/reverse-proxy level") — to jest ten poziom.
 *
 * W PAMIECI, nie w bazie: portal.important.is chodzi jako jeden kontener na
 * Coolify, wiec limit per-instancja jest wystarczajacy i nie wymaga
 * dodatkowej tabeli. Reset przy kazdym redeployu jest akceptowalny —
 * to ochrona przed spamem, nie mechanizm bezpieczenstwa z gwarancja.
 */

interface Window {
  count: number
  resetAt: number
}

const windows = new Map<string, Window>()

export function checkRateLimit(
  key: string,
  options: { max?: number; windowMs?: number } = {}
): boolean {
  // Produkcyjne zabezpieczenie, nie testowa niedogodnosc — wylaczone TYLKO w
  // `next dev` (`NODE_ENV=development`), zeby reczne klikanie w widget na
  // localhost nie wpadalo w 429 po garstce prob. Celowo NIE `!== 'production'`:
  // Vitest ustawia `NODE_ENV=test`, a rateLimit.test.ts sprawdza realne
  // dzialanie limitu — szersze wylaczenie ubilo by te testy po cichu.
  if (process.env.NODE_ENV === 'development') return true

  const max = options.max ?? 10
  const windowMs = options.windowMs ?? 60_000
  const now = Date.now()

  const existing = windows.get(key)
  if (!existing || existing.resetAt <= now) {
    windows.set(key, { count: 1, resetAt: now + windowMs })
    return true
  }

  if (existing.count >= max) return false

  existing.count++
  return true
}

/** Test-only: czysci cały stan miedzy testami. */
export function resetRateLimits(): void {
  windows.clear()
}
