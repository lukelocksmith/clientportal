import { eq } from 'drizzle-orm'
import { db } from './db'
import { portalLists } from './db/schema'
import type { PortalScope } from './portalScope'

/**
 * Odczyt zakresu portalu z bazy. Osobno od reguł w portalScope.ts, żeby te
 * dały się testować i żeby żaden komponent kliencki nie wciągnął przez nie
 * sterownika postgresa (to już raz położyło całą aplikację).
 */
export async function getPortalScope(portalId: string): Promise<PortalScope> {
  const rows = await db
    .select({ listId: portalLists.clickupListId })
    .from(portalLists)
    .where(eq(portalLists.portalId, portalId))
    .orderBy(portalLists.sortOrder)

  return rows.map(r => r.listId)
}
