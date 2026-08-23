/**
 * Prosty limiter w pamięci procesu, dla punktów wejścia bez wiersza w bazie
 * (dziś: logowanie admina). Klienci mają licznik w `portal_users`, admin nie
 * ma gdzie trzymać stanu, a brak limitu na panelu admina to otwarty brute-force
 * online na hash bcrypt.
 *
 * In-memory znaczy per instancja Node. Przy jednym kontenerze portalu to
 * wystarcza; przy skalowaniu poziomym limiter trzeba by przenieść do Postgresa
 * albo Redis i ta decyzja jest tu świadomie odłożona.
 */

type Bucket = { count: number; resetAt: number }

const buckets = new Map<string, Bucket>()

/** Co ile wywołań przeglądać mapę pod kątem przeterminowanych kubełków. */
const SWEEP_EVERY = 100

let calls = 0

/**
 * Zużywa jedną próbę z puli klucza. Zwraca false, gdy pula wyczerpana.
 * Kubełek liczy od pierwszego użycia i resetuje się po oknie.
 */
export function consumeRateLimit(key: string, limit: number, windowMs: number): boolean {
  const now = Date.now()

  if (++calls % SWEEP_EVERY === 0) {
    for (const [k, b] of buckets) {
      if (b.resetAt <= now) buckets.delete(k)
    }
  }

  const bucket = buckets.get(key)
  if (!bucket || bucket.resetAt <= now) {
    buckets.set(key, { count: 1, resetAt: now + windowMs })
    return true
  }

  bucket.count += 1
  return bucket.count <= limit
}

/** Test-only: czyści cały stan limitera. */
export function resetRateLimitsForTests(): void {
  buckets.clear()
  calls = 0
}
