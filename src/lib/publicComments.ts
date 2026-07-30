import type { ClickUpComment } from './types'

/**
 * Model opt-in dla komentarzy. Klient widzi WYŁĄCZNIE komentarze, które
 * agencja jawnie oznaczyła prefiksem `[PUBLIC] `, plus własne komentarze
 * dodane z portalu (te dostają prefiks automatycznie przy zapisie).
 *
 * Ta reguła była wklejona w trasie komentarzy. Wyciągnięta tutaj, bo od
 * momentu dodania wyszukiwarki ma DRUGIEGO konsumenta: indekser Historii.
 * Dwie kopie tego filtra to kwestia czasu, kiedy jedna się rozjedzie, a
 * rozjazd tutaj oznacza wyciek wewnętrznej korespondencji agencji do
 * przeszukiwalnego indeksu klienta. Jedno źródło prawdy jest wymogiem
 * bezpieczeństwa, nie sprzątaniem.
 */
export const PUBLIC_PREFIX = '[PUBLIC] '

/** Dopasowuje "(Imię) " na początku, czyli podpis klienta dodany przez portal. */
const CLIENT_NAME_RE = /^\(([^)]+)\) /

export function isPublicComment(text: string | null | undefined): boolean {
  return typeof text === 'string' && text.startsWith(PUBLIC_PREFIX)
}

/**
 * Zdejmuje prefiks i rozpoznaje autora. Komentarz klienta ma po prefiksie
 * "(Imię) ", komentarz agencji nie ma nic.
 */
export function stripPublicPrefix(text: string): { text: string; sender: string } {
  const withoutPrefix = text.slice(PUBLIC_PREFIX.length)
  const match = withoutPrefix.match(CLIENT_NAME_RE)
  if (match) {
    return { text: withoutPrefix.slice(match[0].length), sender: match[1] }
  }
  return { text: withoutPrefix, sender: 'Important.is' }
}

/** Komentarze widoczne dla klienta, z zdjętym prefiksem i rozpoznanym autorem. */
export function filterPublicComments(comments: ClickUpComment[]): ClickUpComment[] {
  return comments
    .filter(c => isPublicComment(c.comment_text))
    .map(c => {
      const { text, sender } = stripPublicPrefix(c.comment_text!)
      return { ...c, comment_text: text, sender }
    })
}

/**
 * Same treści komentarzy publicznych, do wrzucenia w indeks wyszukiwania.
 * Osobna funkcja, żeby wywołanie w indekserze czytało się jak deklaracja
 * intencji: do indeksu wchodzi tylko to, co przeszło filtr.
 */
export function publicCommentTexts(comments: ClickUpComment[]): string[] {
  return filterPublicComments(comments)
    .map(c => c.comment_text ?? '')
    .filter(t => t.trim().length > 0)
}
