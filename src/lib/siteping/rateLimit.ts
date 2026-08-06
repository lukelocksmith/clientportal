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
