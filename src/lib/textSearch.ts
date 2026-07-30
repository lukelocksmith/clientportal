import removeAccents from 'remove-accents'

/**
 * Normalizacja tekstu pod wyszukiwanie. Trzymamy ją w Node, nie w Postgresie,
 * dzięki czemu baza nie potrzebuje rozszerzenia `unaccent` (a więc i praw
 * superusera na produkcyjnym Postgresie w Coolify).
 *
 * Dlaczego nie standardowy trik `normalize('NFD').replace(/\p{Diacritic}/gu,'')`:
 * on rozkłada ą, ć, ę, ń, ó, ś, ź, ż na literę plus znak łączący i usuwa znak,
 * ale `ł` (U+0142) NIE jest rozkładalne przez NFD i przechodzi nietknięte.
 * Efekt byłby taki, że klient wpisze "lacze" i nie znajdzie "łącze", przy
 * jednoczesnym poprawnym działaniu dla "sciezka" i "ścieżka", czyli błąd
 * wyglądający na losowy. `remove-accents` ma jawną mapę dla ł.
 *
 * KLUCZOWE: tę samą funkcję trzeba stosować po OBU stronach, przy budowaniu
 * indeksu i przy frazie od klienta. Złożenie tylko jednej strony jest gorsze
 * niż nieskładanie żadnej, bo daje trafienia zależne od tego, czy klient
 * napisał z ogonkami czy bez.
 */
export function fold(input: string): string {
  return removeAccents(input).toLowerCase().replace(/\s+/g, ' ').trim()
}

/** Fragmenty składane w jedno pole wyszukiwania. */
export type SearchTextParts = {
  name: string
  /** `text_content` z ClickUpa, czyli opis bez znaczników markdown. */
  description?: string | null
  /** WYŁĄCZNIE komentarze przepuszczone przez filtr [PUBLIC]. */
  publicComments?: string[]
  /** Nazwy plików załączników, bez treści (OCR-u nie robimy). */
  attachmentNames?: string[]
}

/**
 * Buduje znormalizowaną zawartość kolumny `search_text`. Separator to znak
 * nowej linii, żeby fraza nie mogła przypadkiem trafić w miejsce zlepienia
 * dwóch niezależnych fragmentów (np. koniec opisu i początek komentarza).
 */
export function buildSearchText(parts: SearchTextParts): string {
  const chunks = [
    parts.name,
    parts.description ?? '',
    ...(parts.publicComments ?? []),
    ...(parts.attachmentNames ?? []),
  ]
  return chunks
    .map(c => fold(c ?? ''))
    .filter(c => c.length > 0)
    .join('\n')
}

/**
 * Przygotowuje frazę od klienta do porównania z `search_text`.
 * Zwraca null, gdy po złożeniu nie zostało nic sensownego, żeby wołający
 * wiedział, że ma pominąć warunek wyszukiwania, a nie szukać pustego ciągu
 * (który dopasowałby wszystko).
 */
export function normalizeQuery(raw: string | null | undefined): string | null {
  if (!raw) return null
  const folded = fold(raw)
  return folded.length > 0 ? folded : null
}

/**
 * Escape znaków specjalnych LIKE. Bez tego fraza "100%" dopasowałaby
 * wszystko, a "_" dopasowałby dowolny znak. Backslash jest domyślnym
 * znakiem ucieczki w Postgresie.
 */
export function escapeLikePattern(value: string): string {
  return value.replace(/[\\%_]/g, ch => `\\${ch}`)
}

/**
 * Czy `search_text` zawiera frazę. Odpowiednik warunku SQL, używany przez
 * skrypty kontrolne i jako referencja dla zapytania w bazie.
 */
export function matchesQuery(searchText: string, rawQuery: string): boolean {
  const q = normalizeQuery(rawQuery)
  if (!q) return true
  return searchText.includes(q)
}
