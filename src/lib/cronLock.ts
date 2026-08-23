import { db } from './db'
import type { CronJob } from './cronRuns'

/**
 * Blokada przebiegu crona na poziomie Postgresa (pg_try_advisory_lock).
 *
 * PO CO. Crony wołane są z zewnątrz i potrafią przyjść dwa razy pod rząd
 * (dubel w harmonogramie, retry schedulera, ręczne odpalenie obok cyklicznego).
 * task-index i time-snapshot są idempotentne, ale dubel zjada limit 100 zapytań
 * na minutę wspólnego tokenu ClickUpa; panic-escalation przy dublu wysłałby
 * PODWÓJNY SMS budzący ludzi.
 *
 * JAK. Advisory lock jest przypisany do SESJI (połączenia), a pula połączeń
 * daje każdemu zapytaniu inne połączenie. Dlatego `client.reserve()` bierze
 * JEDNO dedykowane połączenie na cały przebieg: lock i unlock muszą pójść po
 * tym samym, inaczej unlock zwalnia cudzą blokadę albo niczyją.
 *
 * Trzy wyniki, bo wołający musi rozróżnić dwa przypadki „nie ma blokady":
 *   acquired     przebieg nasz, pracuj i wywołaj release w finally
 *   busy         inny przebieg trwa, WYJDŹ bez pracy (cron jest idempotentny)
 *   unavailable  Postgres odrzucił blokadę technicznie; chodź bez niej, jak
 *                dotychczas. Ochrona przed dublem nie może przewrócić crona.
 */
export type CronLock =
  | { kind: 'acquired'; release: () => Promise<void> }
  | { kind: 'busy' }
  | { kind: 'unavailable' }

const LOCK_PREFIX = 'cron-lock:'

export async function acquireCronLock(job: CronJob): Promise<CronLock> {
  let conn
  try {
    conn = await db.$client.reserve()
  } catch (e) {
    console.warn(`[cronLock] brak połączenia dla blokady ${job}, przebieg bez blokady:`, e)
    return { kind: 'unavailable' }
  }

  try {
    const rows = await conn`SELECT pg_try_advisory_lock(hashtext(${LOCK_PREFIX + job})) AS ok`
    if (!rows[0]?.ok) {
      conn.release()
      return { kind: 'busy' }
    }
  } catch (e) {
    conn.release()
    console.warn(`[cronLock] nie udało się założyć blokady ${job}, przebieg bez blokady:`, e)
    return { kind: 'unavailable' }
  }

  let released = false
  return {
    kind: 'acquired',
    release: async () => {
      if (released) return
      released = true
      try {
        await conn`SELECT pg_advisory_unlock(hashtext(${LOCK_PREFIX + job}))`
      } finally {
        // Połączenie wraca do puli ZAWSZE, nawet gdy unlock rzucił: wyciek
        // połączenia z puli zabiłby kolejne przebiegi skuteczniej niż dubel crona.
        conn.release()
      }
    },
  }
}
