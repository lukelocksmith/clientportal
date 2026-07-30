/**
 * Jedno źródło prawdy o zakładkach portalu: etykiety, adresy, flagi i to,
 * czy strona w ogóle istnieje. Czysta logika, bez zależności od Next i bazy,
 * więc daje się sprawdzić skryptem (scripts/check-portalTabs.ts).
 *
 * Po co rozdział flagi od `implemented`: panel admina pozwala włączyć funkcję
 * zanim jej strona wyląduje w repo. Gdyby zakładka pojawiała się od samej
 * flagi, admin włączyłby klientowi link do 404. Zakładka wchodzi dopiero, gdy
 * flaga ORAZ `implemented` są prawdziwe. Wdrażając nową stronę przestawiamy
 * `implemented` na true i nic więcej nie trzeba ruszać.
 */

export type PortalFlags = {
  kanbanEnabled: boolean
  reportsEnabled: boolean
  historyEnabled: boolean
  dashboardEnabled: boolean
}

export type TabKey = 'kanban' | 'historia' | 'raporty' | 'dashboard'

export type PortalTab = {
  key: TabKey
  label: string
  /** Doklejane do `/${slug}`. Kanban jest korzeniem, więc ma pusty sufiks. */
  path: string
  flag: keyof PortalFlags
  /** Czy strona istnieje w repo. */
  implemented: boolean
}

/** Kolejność w headerze: bieżąca praca, przeszłość, rozliczenia, kontakt. */
export const PORTAL_TABS: readonly PortalTab[] = [
  { key: 'kanban', label: 'Kanban', path: '', flag: 'kanbanEnabled', implemented: true },
  { key: 'historia', label: 'Historia', path: '/historia', flag: 'historyEnabled', implemented: true },
  { key: 'raporty', label: 'Raporty', path: '/raporty', flag: 'reportsEnabled', implemented: true },
  { key: 'dashboard', label: 'Dashboard', path: '/dashboard', flag: 'dashboardEnabled', implemented: true },
]

/** Zakładki, które klient ma prawo zobaczyć: flaga włączona i strona istnieje. */
export function visibleTabs(flags: PortalFlags): PortalTab[] {
  return PORTAL_TABS.filter(tab => tab.implemented && flags[tab.flag])
}

/**
 * Czy dana zakładka jest dostępna. Używane przez bramy serwerowe w stronach,
 * żeby wpisanie adresu z ręki nie omijało flagi.
 */
export function isTabEnabled(flags: PortalFlags, key: TabKey): boolean {
  const tab = PORTAL_TABS.find(t => t.key === key)
  return tab ? tab.implemented && flags[tab.flag] : false
}

/**
 * Dokąd odesłać klienta, gdy trafił na wyłączoną zakładkę. Zwraca ścieżkę
 * pierwszej dostępnej zakładki albo null, gdy wszystko jest wyłączone.
 * Null jest stanem realnym (można wyłączyć wszystko w /admin) i wołający
 * musi go obsłużyć, zamiast wpadać w pętlę przekierowań.
 */
export function firstEnabledTabPath(flags: PortalFlags, slug: string): string | null {
  const tab = visibleTabs(flags)[0]
  return tab ? `/${slug}${tab.path}` : null
}
