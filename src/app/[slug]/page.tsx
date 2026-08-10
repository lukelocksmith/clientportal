import { redirect } from 'next/navigation'
import { getCachedTasksForScope, getCachedRecentlyClosedTasksForScope } from '@/lib/clickupCache'
import { getPortalScope } from '@/lib/portalScopeStore'
import { getSnapshotMap, mergeTrackedTime } from '@/lib/timeSnapshots'
import { KanbanBoardClient } from '@/components/kanban/KanbanBoardClient'
import { firstEnabledTabPath, isTabEnabled } from '@/lib/portalTabs'
import { getPortalForSession } from '@/lib/portalSession'
import { portalSiteUrl } from '@/lib/portalSite'
import { signIdentityToken } from '@/lib/siteping/identityToken'

// Nie ma tu `export const revalidate`. Stało tam `60` i było MARTWE: strona
// czyta ciasteczko sesji, więc renderuje się dynamicznie, a buforowanie
// segmentu nie ma wtedy zastosowania. Wyglądało jak działający cache i
// dlatego nikt nie szukał przyczyny 1,3 sekundy na wejściu.
//
// Buforowane są teraz DANE, w lib/clickupCache.ts, z unieważnianiem po każdej
// zmianie widocznej dla klienta.

interface PortalPageProps {
  params: Promise<{ slug: string }>
}

export default async function PortalPage({ params }: PortalPageProps) {
  const { slug } = await params

  const result = await getPortalForSession(slug)
  if (!result.ok) redirect(result.reason === 'no-portal' ? '/' : `/${slug}/login`)
  const { session, portal, flags, branding } = result

  // Brama serwerowa, tak samo jak w raportach: ukrycie zakładki to kosmetyka,
  // adres musi być zamknięty też dla wpisanego z ręki. Kanban jest korzeniem
  // portalu, więc przy wyłączonym odsyłamy na pierwszą dostępną zakładkę.
  if (!isTabEnabled(flags, 'kanban')) {
    const fallback = firstEnabledTabPath(flags, slug)
    // Bez tego warunku wszystkie flagi wyłączone dałyby przekierowanie
    // `/${slug}` na `/${slug}`, czyli pętlę.
    if (fallback && fallback !== `/${slug}`) redirect(fallback)
    return (
      <div className="min-h-screen bg-background flex items-center justify-center p-6">
        <p className="text-sm text-muted-foreground text-center">
          Ten portal nie ma teraz włączonej żadnej zakładki.
          <br />
          Napisz do nas na hi@important.is, ustawimy dostęp.
        </p>
      </div>
    )
  }

  // Zakres portalu, czyli listy wybrane w panelu. Bez tego tablica pokazywala
  // CALY folder klienta, takze listy, ktorych do portalu nie wybralismy.
  const scope = await getPortalScope(portal.id)
  const rawTasks = await getCachedTasksForScope(portal.clickupFolderId, scope)
  // Za flaga: bez niej kanban dziala jak dzis, zero dodatkowego wywolania
  // ClickUpa dla portali, ktore tej funkcji nie maja wlaczonej.
  const recentlyClosed = portal.statusControlsEnabled
    ? await getCachedRecentlyClosedTasksForScope(portal.clickupFolderId, scope)
    : []
  const snapshots = await getSnapshotMap(portal.id)
  const tasks = mergeTrackedTime([...rawTasks, ...recentlyClosed], snapshots)

  /**
   * Token tożsamości do linku „Pokaż na stronie", żeby widget na stronie
   * klienta nie pytał go o imię i mail.
   *
   * Generowany TUTAJ, bo to jedyne miejsce w tej ścieżce, które zna sesję:
   * `portalSiteUrl` jest czystą funkcją bez dostępu do bazy, a `NewTaskButton`
   * jest komponentem klienckim, więc podpisywanie w nim oznaczałoby wysłanie
   * sekretu do przeglądarki.
   *
   * `null` przy braku sekretu albo dla podglądu admina jest w porządku: link
   * powstanie bez tokenu i widget zapyta, jak dotąd.
   */
  const identityToken = portal.sitepingEnabled
    ? await signIdentityToken({ name: session.name, email: session.email, slug })
    : null

  return (
    <KanbanBoardClient
      initialTasks={tasks}
      slug={slug}
      portalName={portal.name}
      flags={flags}
      branding={branding}
      siteUrl={portalSiteUrl(portal, identityToken)}
      userEmail={session.email}
      statusControlsEnabled={portal.statusControlsEnabled}
    />
  )
}
