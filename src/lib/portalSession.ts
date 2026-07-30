import { eq } from 'drizzle-orm'
import { db } from './db'
import { portals } from './db/schema'
import { getSession } from './auth'
import { resolveBranding, type PortalBranding } from './branding'
import type { PortalFlags } from './portalTabs'
import type { Session } from './types'

type PortalRow = typeof portals.$inferSelect

/**
 * Jedna brama wejścia do portalu klienta: sesja, rekord portalu, flagi
 * zakładek i marka.
 *
 * Ten sam blok był skopiowany pięć razy (kanban, raporty, historia, dashboard,
 * trasa listy zadań), a to jest GRANICA BEZPIECZEŃSTWA MIĘDZY KLIENTAMI.
 * Pięć kopii to pięć miejsc, w których można ją kiedyś rozjechać, i wystarczy
 * jedna pomyłka, żeby klient zobaczył zadania innego klienta. Stąd jedno
 * miejsce.
 *
 * Zwraca wynik oznaczony, a nie null, bo wołający rozróżniają dwa przypadki:
 * brak sesji odsyła na logowanie, brak portalu na stronę główną. Zwracanie
 * samego null zlałoby te dwie ścieżki.
 *
 * `portalId` w wyniku pochodzi z bazy po slugu z SESJI, nigdy z parametrów
 * adresu. To jest cała istota tej granicy.
 */
export type PortalSessionResult =
  | {
      ok: true
      session: Session
      portal: PortalRow
      flags: PortalFlags
      branding: PortalBranding
    }
  | { ok: false; reason: 'no-session' | 'no-portal' }

export async function getPortalForSession(slug: string): Promise<PortalSessionResult> {
  const session = await getSession(slug)
  if (!session || session.portalSlug !== slug) {
    return { ok: false, reason: 'no-session' }
  }

  const [portal] = await db.select().from(portals).where(eq(portals.slug, slug)).limit(1)
  if (!portal) return { ok: false, reason: 'no-portal' }

  return {
    ok: true,
    session,
    portal,
    flags: {
      kanbanEnabled: portal.kanbanEnabled,
      reportsEnabled: portal.reportsEnabled,
      historyEnabled: portal.historyEnabled,
      dashboardEnabled: portal.dashboardEnabled,
    },
    branding: resolveBranding(portal),
  }
}
