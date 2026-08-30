/**
 * Które załączniki widzi klient.
 *
 * ZASADA (30.08, prośba Łukasza): plik, którego nazwa zaczyna się od
 * PODKREŚLENIA, jest wewnętrzny i portal go nie pokazuje. Zespół wrzuca do
 * zadania rzeczy, które nie są dla klienta (zrzuty z panelu, notatki, wersje
 * robocze) i do tej pory jedynym sposobem na ukrycie ich było nie wrzucanie
 * ich do ClickUpa w ogóle.
 *
 * Podkreślenie, a nie osobne pole czy tag: nazwę pliku widać i da się ją
 * zmienić w ClickUpie w dwie sekundy, bez wchodzenia gdziekolwiek indziej.
 *
 * FILTRUJEMY PO STRONIE SERWERA, nie w widoku. Ukrycie w komponencie zostawia
 * plik w odpowiedzi API, czyli dla kogoś, kto zajrzy w narzędzia
 * deweloperskie, nie ukrywa niczego.
 */

/**
 * Sama nazwa pliku, bez ścieżki i bez parametrów adresu. ClickUp podaje
 * `title` (czysta nazwa), ale bloki komentarzy potrafią mieć tylko URL.
 */
export function fileNameOf(nameOrUrl: string | null | undefined): string {
  if (typeof nameOrUrl !== 'string') return ''
  const bezZapytania = nameOrUrl.split('?')[0].split('#')[0]
  const ostatni = bezZapytania.split('/').pop() ?? ''
  return decodeURIComponent(ostatni).trim()
}

/**
 * Czy plik jest wewnętrzny.
 *
 * Białe znaki na początku obcinamy: nazwa " _notatka.png" jest tą samą
 * intencją co "_notatka.png", a różnicy nikt nie zobaczy gołym okiem.
 */
export function isInternalFile(nameOrUrl: string | null | undefined): boolean {
  return fileNameOf(nameOrUrl).startsWith('_')
}

/** Załączniki zadania bez plików wewnętrznych. */
export function visibleAttachments<T extends { title?: string | null; name?: string | null; url?: string | null }>(
  attachments: readonly T[] | null | undefined
): T[] {
  if (!Array.isArray(attachments)) return []
  return attachments.filter(a => !isInternalFile(a.title ?? a.name ?? a.url))
}
