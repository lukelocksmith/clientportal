import { asc, eq } from 'drizzle-orm'
import { db } from './db'
import { portalLinks } from './db/schema'
import { isSafeHttpUrl, sanitizeLinks, type ProjectLink } from './projectLinks'

/**
 * Zapytania do bazy dla linków projektu. Wydzielone z projectLinks.ts, bo tamten
 * plik jest importowany przez komponent kliencki, a import `db` wciągnąłby
 * sterownik postgres do paczki przeglądarki.
 */

export async function getProjectLinks(portalId: string): Promise<ProjectLink[]> {
  const rows = await db
    .select({ label: portalLinks.label, url: portalLinks.url })
    .from(portalLinks)
    .where(eq(portalLinks.portalId, portalId))
    .orderBy(asc(portalLinks.sortOrder))

  // Walidacja także przy ODCZYCIE, nie tylko przy zapisie: wiersz mógł powstać
  // przed dodaniem walidacji albo zostać wpisany ręcznie SQL-em, a to adres,
  // w który klika klient.
  return rows.filter(r => isSafeHttpUrl(r.url))
}

/**
 * Podmienia CAŁY zestaw linków projektu.
 *
 * Zamiana wszystkiego, nie dopisywanie: panel wysyła pełną listę po edycji,
 * więc różnicowanie po id byłoby złożonością bez zysku przy kilku wierszach,
 * a przy okazji wymagałoby obsługi usuwania osobno.
 */
export async function replaceProjectLinks(portalId: string, links: ProjectLink[]): Promise<number> {
  const clean = sanitizeLinks(links)
  await db.delete(portalLinks).where(eq(portalLinks.portalId, portalId))
  if (clean.length === 0) return 0

  await db.insert(portalLinks).values(
    clean.map((l, i) => ({ portalId, label: l.label, url: l.url, sortOrder: i }))
  )
  return clean.length
}
