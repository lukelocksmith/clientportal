/**
 * Blokada logowania dla wejść BEZ wiersza w bazie — dziś panel admina.
 *
 * PO CO (31.08). Licznik prób admina siedział w pamięci procesu
 * (`memoryRateLimit.ts`): znikał przy każdym restarcie kontenera i nie
 * obowiązywałby, gdyby aplikacja chodziła w dwóch instancjach. Deploy w środku
 * ataku zerował licznik, a panel admina bez działającego limitu to otwarty
 * brute-force online na hash bcrypt.
 *
 * Klienci mają swój licznik w `portal_users` (patrz loginAttempts.ts) i tamten
 * zostaje: tam jest gdzie go trzymać, bo konto istnieje.
 *
 * Reguła („czy zablokowane", „jaka kara") jest czysta i testowalna bez bazy;
 * dostęp do bazy siedzi niżej, w tym samym pliku, ale osobno.
 */
import { and, eq, lt, sql } from 'drizzle-orm'
import { db } from './db'
import { loginThrottle } from './db/schema'

export const MAX_ATTEMPTS = 5
export const LOCKOUT_MINUTES = 15

/**
 * Ile trzymamy wiersze po ostatniej próbie. Po tym czasie są śmieciem:
 * licznik i tak wygasł, a tabela ma pozostać mała.
 */
export const PRUNE_AFTER_HOURS = 24

export type ThrottleState = { attempts: number; lockedUntil: Date | null }

/** Czy w tym stanie wejście jest zablokowane. Czysta reguła. */
export function isLocked(state: ThrottleState | null, now: Date): boolean {
  if (!state?.lockedUntil) return false
  return state.lockedUntil.getTime() > now.getTime()
}

/** Ile minut zostało blokady. Do komunikatu dla człowieka. */
export function minutesLeft(state: ThrottleState | null, now: Date): number {
  if (!isLocked(state, now)) return 0
  return Math.max(1, Math.ceil((state!.lockedUntil!.getTime() - now.getTime()) / 60_000))
}

/**
 * Licznik po nieudanej próbie. Blokada wchodzi PO osiągnięciu limitu.
 *
 * Świadomie liczymy od wartości POPRZEDNIEJ, a nie od stanu z bazy w drugim
 * zapytaniu: dwa równoległe logowania nie mogą wzajemnie zgubić inkrementacji.
 */
export function nextState(previous: ThrottleState | null, now: Date): ThrottleState {
  const attempts = (previous?.attempts ?? 0) + 1
  return {
    attempts,
    lockedUntil: attempts >= MAX_ATTEMPTS ? new Date(now.getTime() + LOCKOUT_MINUTES * 60_000) : null,
  }
}

async function read(key: string): Promise<ThrottleState | null> {
  const [row] = await db
    .select({ attempts: loginThrottle.attempts, lockedUntil: loginThrottle.lockedUntil })
    .from(loginThrottle)
    .where(eq(loginThrottle.key, key))
    .limit(1)
  return row ?? null
}

/** Czy wejście jest zablokowane. `minutes` > 0 znaczy „tak". */
export async function checkLock(key: string, now = new Date()): Promise<{ locked: boolean; minutes: number }> {
  const state = await read(key)
  return { locked: isLocked(state, now), minutes: minutesLeft(state, now) }
}

/** Odnotowuje nieudaną próbę i zwraca stan po niej. */
export async function recordFailure(key: string, now = new Date()): Promise<ThrottleState> {
  const state = nextState(await read(key), now)
  await db
    .insert(loginThrottle)
    .values({ key, attempts: state.attempts, lockedUntil: state.lockedUntil, updatedAt: now })
    .onConflictDoUpdate({
      target: loginThrottle.key,
      set: {
        // Inkrementacja W SQL-u, nie z odczytanej wartości: przy dwóch
        // równoległych próbach odczyt-i-zapis zgubiłby jedną z nich.
        attempts: sql`${loginThrottle.attempts} + 1`,
        lockedUntil: sql`case when ${loginThrottle.attempts} + 1 >= ${MAX_ATTEMPTS}
          then ${now.toISOString()}::timestamp + interval '${sql.raw(String(LOCKOUT_MINUTES))} minutes'
          else null end`,
        updatedAt: now,
      },
    })
  return state
}

/** Zeruje licznik po udanym logowaniu. */
export async function clearFailures(key: string): Promise<void> {
  await db.delete(loginThrottle).where(eq(loginThrottle.key, key))
}

/**
 * Usuwa wygasłe wiersze. Woła cron dowożenia zgłoszeń, bo chodzi często
 * i jest najtańszym miejscem na sprzątanie.
 */
export async function pruneThrottle(now = new Date()): Promise<number> {
  const granica = new Date(now.getTime() - PRUNE_AFTER_HOURS * 3_600_000)
  const usuniete = await db
    .delete(loginThrottle)
    .where(and(lt(loginThrottle.updatedAt, granica)))
    .returning({ key: loginThrottle.key })
  return usuniete.length
}
