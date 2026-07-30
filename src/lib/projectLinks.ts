/**
 * Reguły linków projektu. CZYSTY moduł: bez importu bazy, bez Next.
 *
 * Ten podział nie jest kosmetyczny. Formularz w panelu jest komponentem
 * KLIENCKIM i potrzebuje `isSafeHttpUrl` do podświetlania błędnego wiersza.
 * Gdy walidacja leżała w pliku, który u góry importuje `db`, bundler wciągnął
 * sterownik postgres do paczki przeglądarki, ta nie ma modułu `fs`, i CAŁA
 * aplikacja zwracała 500. `tsc` tego nie widzi, bo typy są poprawne; granicę
 * klient/serwer łapie tylko bundler.
 *
 * Zapytania do bazy są w projectLinksStore.ts i importują ten plik.
 */
export const MAX_LINKS_PER_PORTAL = 12
export const MAX_LABEL_LENGTH = 40

export type ProjectLink = { label: string; url: string }

/**
 * Dopuszczamy WYŁĄCZNIE http i https. Nie ma tu powodu na `data:` (to nie
 * obrazek), a `javascript:` w atrybucie href WYKONUJE się po kliknięciu, więc
 * byłoby to realne wykonanie kodu w przeglądarce klienta, nie teoretyczne.
 */
export function isSafeHttpUrl(value: string | null | undefined): boolean {
  if (!value) return false
  try {
    const parsed = new URL(value.trim())
    return parsed.protocol === 'https:' || parsed.protocol === 'http:'
  } catch {
    return false
  }
}

/** Odrzuca puste i niepoprawne wiersze, przycina do limitu. */
export function sanitizeLinks(input: ProjectLink[]): ProjectLink[] {
  return input
    .map(l => ({ label: (l.label ?? '').trim().slice(0, MAX_LABEL_LENGTH), url: (l.url ?? '').trim() }))
    // Wiersz bez etykiety ALBO bez poprawnego adresu jest pomijany po cichu:
    // panel pozwala dodać pusty wiersz i to normalne, że część zostanie pusta.
    .filter(l => l.label.length > 0 && isSafeHttpUrl(l.url))
    .slice(0, MAX_LINKS_PER_PORTAL)
}
