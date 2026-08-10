/**
 * Adres, pod którym portal serwuje bundle widgetu SitePing stronom klientów.
 *
 * Wyciągnięte do osobnego modułu, bo tę samą wartość musi znać:
 *   - middleware (`src/proxy.ts`), żeby przepuścić plik bez sesji,
 *   - generator snippetu w panelu admina,
 *   - skrypt kopiujący bundle do `public/`.
 *
 * Trzy kopie tego łańcucha to kwestia czasu, kiedy jedna się rozjedzie, a
 * rozjazd między middleware a snippetem oznacza, że klient wkleja na stronę
 * adres, który portal odsyła na ekran logowania (zdarzyło się przy pierwszym
 * podejściu 2026-08-10: middleware brał `/siteping/widget.js` za portal
 * o slugu „siteping").
 */
export const SITEPING_WIDGET_PATH = '/siteping/widget.js'

/**
 * Czy to żądanie o bundle widgetu.
 *
 * Dokładne porównanie, nie prefiks `/siteping/`: wykluczenie z bramy sesji ma
 * obejmować jeden znany plik, a nie dowolną ścieżkę zaczynającą się tak samo.
 */
export function isSitepingWidgetPath(pathname: string): boolean {
  return pathname === SITEPING_WIDGET_PATH
}

/** Pełny adres do wklejenia w `<script src>` na stronie klienta. */
export function sitepingWidgetUrl(appUrl: string): string {
  return `${appUrl.replace(/\/+$/, '')}${SITEPING_WIDGET_PATH}`
}
