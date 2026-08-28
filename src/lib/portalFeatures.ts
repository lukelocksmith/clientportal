/**
 * Funkcje portalu włączane per projekt, które NIE są zakładkami.
 *
 * Po co osobna lista obok `PORTAL_TABS`: tamta odpowiada na pytanie „co widać
 * w menu", a te flagi zmieniają zachowanie WEWNĄTRZ istniejących zakładek
 * (widget w raportach, dropdown w szufladzie, widget na stronie klienta).
 * Wrzucenie ich do listy zakładek dałoby w panelu ptaszki, które udają
 * zakładki, a nimi nie są.
 *
 * DLACZEGO TO POWSTAŁO (25.08): `estimateReportEnabled` i
 * `statusControlsEnabled` dały się przestawić WYŁĄCZNIE curlem po API. Łukasz
 * pytał „gdzie jest estymacja", a odpowiedź brzmiała „jest, tylko wyłączona
 * flagą, której nie ma w panelu". Funkcja niewidoczna w panelu jest z punktu
 * widzenia człowieka funkcją, której nie ma.
 *
 * Nowa flaga per projekt DOPISUJE SIĘ TUTAJ i pojawia się w panelu sama.
 */

export type PortalFeatureKey =
  | 'estimateReportEnabled'
  | 'statusControlsEnabled'
  | 'sitepingEnabled'
  | 'monitoringEnabled'

export type PortalFeatureFlags = Record<PortalFeatureKey, boolean>

export const PORTAL_FEATURES: ReadonlyArray<{
  key: PortalFeatureKey
  label: string
  /** Co się zmieni klientowi. Widoczne jako podpowiedź pod ptaszkiem. */
  hint: string
}> = [
  {
    key: 'estimateReportEnabled',
    label: 'Pozostała estymacja',
    hint: 'Widget na Raportach: ile jeszcze zostało z estymat zadań otwartych.',
  },
  {
    key: 'statusControlsEnabled',
    label: 'Zmiana statusu i zamknięte',
    hint: 'Klient może zmienić status w szufladzie i widzi kolumnę „zamknięte".',
  },
  {
    key: 'sitepingEnabled',
    label: 'Widget na stronie klienta',
    hint: 'Zgłoszenia z widgetu SitePing. Wymaga też ustawionych domen.',
  },
  {
    key: 'monitoringEnabled',
    label: 'Stan strony',
    hint: 'Kafle na Dashboardzie: dostępność, wynik testów i szybkość ładowania. Wymaga ustawionych domen. Uwaga: klient zobaczy też nasze przerwy.',
  },
]

/** Czy klucz jest jedną ze znanych flag funkcji. Brama dla wartości z zewnątrz. */
export function isPortalFeatureKey(key: unknown): key is PortalFeatureKey {
  return PORTAL_FEATURES.some(f => f.key === key)
}
