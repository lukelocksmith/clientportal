import { describe, it, beforeEach, afterAll, vi } from 'vitest'
import assert from 'node:assert'
import { eq } from 'drizzle-orm'
import { db } from '@/lib/db'
import { loginThrottle } from '@/lib/db/schema'
import { isDbReachable } from './helpers'

/**
 * BLOKADA LOGOWANIA W BAZIE, na prawdziwym Postgresie.
 *
 * Do 31.08 licznik prób admina żył w pamięci procesu: znikał przy restarcie
 * kontenera i nie obowiązywałby przy dwóch instancjach aplikacji. Panel admina
 * bez działającego limitu to otwarty brute-force online na hash bcrypt.
 *
 * Testujemy na prawdziwej bazie, bo cała wartość tej zmiany leży w tym, że
 * licznik JEST W BAZIE — atrapa dowodziłaby tylko, że kod się wykonuje.
 *
 *   docker start cp-test-pg && npm run test:integration
 */
const dbUp = await isDbReachable()

const { checkLock, clearFailures, recordFailure, pruneThrottle, MAX_ATTEMPTS, LOCKOUT_MINUTES } =
  await import('@/lib/loginThrottle')

const KLUCZ = 'admin-login:test-1.2.3.4'

describe.skipIf(!dbUp)('blokada logowania na prawdziwej bazie', () => {
  beforeEach(async () => {
    await db.delete(loginThrottle).where(eq(loginThrottle.key, KLUCZ))
  })

  afterAll(async () => {
    await db.delete(loginThrottle).where(eq(loginThrottle.key, KLUCZ))
  })

  it('pierwsze wejście nie jest zablokowane', async () => {
    const stan = await checkLock(KLUCZ)
    assert.strictEqual(stan.locked, false)
    assert.strictEqual(stan.minutes, 0)
  })

  it(`blokuje dokładnie po ${MAX_ATTEMPTS} nieudanych próbach`, async () => {
    for (let i = 1; i < MAX_ATTEMPTS; i++) {
      await recordFailure(KLUCZ)
      const stan = await checkLock(KLUCZ)
      assert.strictEqual(stan.locked, false, `po ${i} próbach nie powinno jeszcze blokować`)
    }

    await recordFailure(KLUCZ)

    const stan = await checkLock(KLUCZ)
    assert.strictEqual(stan.locked, true)
    assert.ok(stan.minutes > 0 && stan.minutes <= LOCKOUT_MINUTES, `minut: ${stan.minutes}`)
  })

  it('licznik rośnie W SQL-u, więc równoległe próby nie gubią się wzajemnie', async () => {
    // Pięć jednoczesnych żądań to realny kształt ataku, nie egzotyka.
    await Promise.all(Array.from({ length: MAX_ATTEMPTS }, () => recordFailure(KLUCZ)))

    const [wiersz] = await db.select().from(loginThrottle).where(eq(loginThrottle.key, KLUCZ))
    assert.strictEqual(wiersz.attempts, MAX_ATTEMPTS, 'żadna próba nie została zgubiona')
    assert.ok(wiersz.lockedUntil, 'blokada nałożona')
  })

  it('udane logowanie zeruje licznik', async () => {
    await recordFailure(KLUCZ)
    await recordFailure(KLUCZ)

    await clearFailures(KLUCZ)

    const wiersze = await db.select().from(loginThrottle).where(eq(loginThrottle.key, KLUCZ))
    assert.strictEqual(wiersze.length, 0)
  })

  it('blokada przeżywa restart procesu, bo nie ma jej w pamięci', async () => {
    for (let i = 0; i < MAX_ATTEMPTS; i++) await recordFailure(KLUCZ)

    // Świeży import modułu = to samo, co nowy proces po deployu. Licznik
    // w pamięci zniknąłby w tym miejscu; ten siedzi w bazie.
    vi.resetModules()
    const swiezy = await import('@/lib/loginThrottle')
    const stan = await swiezy.checkLock(KLUCZ)

    assert.strictEqual(stan.locked, true, 'blokada obowiązuje także po restarcie')
  })

  it('sprzątanie usuwa wygasłe wiersze, a świeżych nie rusza', async () => {
    await recordFailure(KLUCZ)
    // Wiersz sprzed dwóch dni: kara i tak wygasła, zostaje śmieć.
    await db
      .update(loginThrottle)
      .set({ updatedAt: new Date(Date.now() - 48 * 3_600_000) })
      .where(eq(loginThrottle.key, KLUCZ))
    const swiezyKlucz = `${KLUCZ}-swiezy`
    await recordFailure(swiezyKlucz)

    await pruneThrottle()

    const stary = await db.select().from(loginThrottle).where(eq(loginThrottle.key, KLUCZ))
    const swiezy = await db.select().from(loginThrottle).where(eq(loginThrottle.key, swiezyKlucz))
    assert.strictEqual(stary.length, 0, 'stary usunięty')
    assert.strictEqual(swiezy.length, 1, 'świeży zostaje')
    await db.delete(loginThrottle).where(eq(loginThrottle.key, swiezyKlucz))
  })
})
