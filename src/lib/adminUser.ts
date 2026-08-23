import { and, eq } from 'drizzle-orm'
import { db } from './db'
import { portalUsers, portals } from './db/schema'

const ADMIN_EMAIL = (process.env.ADMIN_EMAIL ?? 'admin@important.is').toLowerCase()

/**
 * Admin ma być kontem w KAŻDYM projekcie, nie tylko mieć bypass. Bypass daje
 * dostęp, ale konto daje spójność: admin widnieje na liście userów projektu,
 * ma sesję z prawdziwym `portal_users.id`, więc wpisy zależne od użytkownika
 * (np. ai_usage.user_id, klucz obcy na uuid) mają na co wskazać.
 *
 * Idempotentne: najpierw szukamy, potem wstawiamy. `onConflictDoNothing` nie
 * przejdzie, bo `portal_users` nie ma unikalnego indeksu na (portal_id, email).
 * Ten indeks warto kiedyś dodać, ale to migracja wymagająca sprawdzenia
 * duplikatów na produkcji, więc nie wchodzi tą samą zmianą.
 *
 * `exec` pozwala puścić insert wewnątrz transakcji wołającego (drizzle `tx`),
 * żeby konto admina powstało RAZEM z portalem albo wcale. Domyślnie globalny
 * `db`; uwaga, że wtedy wywołanie w trakcie otwartej transakcji zobaczy portal
 * dopiero po jej commit i FK może się wysypać.
 *
 * Zwraca id konta albo null, gdy `ADMIN_PASSWORD_HASH` nie jest ustawiony.
 * Bez hasha nie da się utworzyć konta, którym można się zalogować, a konto
 * z pustym hasłem byłoby dziurą.
 */
export async function ensureAdminUser(
  portalId: string,
  exec: Pick<typeof db, 'select' | 'insert' | 'update' | 'delete'> = db
): Promise<string | null> {
  const hash = process.env.ADMIN_PASSWORD_HASH
  if (!hash) return null

  const existing = await exec
    .select({ id: portalUsers.id })
    .from(portalUsers)
    .where(and(eq(portalUsers.portalId, portalId), eq(portalUsers.email, ADMIN_EMAIL)))
    .limit(1)

  if (existing[0]) return existing[0].id

  const [created] = await exec
    .insert(portalUsers)
    .values({
      portalId,
      email: ADMIN_EMAIL,
      name: 'Admin',
      passwordHash: hash,
      isActive: true,
    })
    .returning({ id: portalUsers.id })

  return created?.id ?? null
}

/**
 * Dosypuje konto admina do wszystkich istniejących projektów. Wołane po
 * utworzeniu portalu nie ma sensu (tam wystarczy ensureAdminUser), służy do
 * nadrobienia projektów sprzed tej zmiany. Zwraca liczbę dodanych kont.
 */
export async function ensureAdminInAllPortals(): Promise<{ portals: number; added: number }> {
  const all = await db.select({ id: portals.id }).from(portals)
  let added = 0
  for (const portal of all) {
    const before = await db
      .select({ id: portalUsers.id })
      .from(portalUsers)
      .where(and(eq(portalUsers.portalId, portal.id), eq(portalUsers.email, ADMIN_EMAIL)))
      .limit(1)
    if (before[0]) continue
    const id = await ensureAdminUser(portal.id)
    if (id) added++
  }
  return { portals: all.length, added }
}
