import type { ClickUpComment } from './types'

/**
 * Model opt-in dla komentarzy. Klient widzi WYŁĄCZNIE komentarze, które
 * agencja jawnie oznaczyła prefiksem, plus własne komentarze dodane z portalu
 * (te dostają prefiks automatycznie przy zapisie).
 *
 * Ta reguła była wklejona w trasie komentarzy. Wyciągnięta tutaj, bo od
 * momentu dodania wyszukiwarki ma DRUGIEGO konsumenta: indekser Historii.
 * Dwie kopie tego filtra to kwestia czasu, kiedy jedna się rozjedzie, a
 * rozjazd tutaj oznacza wyciek wewnętrznej korespondencji agencji do
 * przeszukiwalnego indeksu klienta. Jedno źródło prawdy jest wymogiem
 * bezpieczeństwa, nie sprzątaniem.
 *
 * ZAPIS ma jeden, kanoniczny prefiks. ODCZYT jest tolerancyjny. To nie jest
 * niekonsekwencja, to dwie różne role: kontrolujemy, co wpisuje portal, ale nie
 * kontrolujemy, co człowiek wystuka w ClickUpie z telefonu. Przy dosłownym
 * `startsWith('[PUBLIC] ')` odpowiedź napisana jako `[public]` albo `[P]bez
 * spacji` nie docierała do klienta i NIC tego nie sygnalizowało: autor widział
 * swój komentarz w ClickUpie i zakładał, że odpowiedział. Ciche niedostarczenie
 * jest tu groźniejsze niż nieco luźniejsze dopasowanie.
 *
 * ZNACZNIK LICZY SIĘ W DOWOLNYM MIEJSCU treści, nie tylko na początku, bo przy
 * pisaniu odpowiedzi z telefonu pozycja kursora jest przypadkowa, a odpowiedź,
 * która nie dotarła, jest kosztowniejsza niż odpowiedź w brzydszej formie.
 */

/** Prefiks, którym PODPISUJEMY. Krótki, bo wpisuje się go ręcznie przy każdej odpowiedzi. */
export const PUBLIC_PREFIX = '[P] '

/**
 * Co UZNAJEMY za oznaczenie publiczne: `[P]` albo `[PUBLIC]`, dowolna wielkość
 * liter, spacje wewnątrz nawiasów, dowolne miejsce w treści.
 *
 * `[PUBLIC]` zostaje na zawsze, bo tak oznaczone komentarze już są w ClickUpie
 * i skrócenie prefiksu nie może ich klientowi zabrać.
 *
 * Zawartość nawiasu jest zamknięta na dokładnie `p` albo `public`, więc
 * `[Pilne]`, `[PL]` i `[Priorytet]` NIE przechodzą. To celowo wąskie: przy
 * dopasowaniu w dowolnym miejscu każde poszerzenie wzorca to nowa droga, którą
 * wewnętrzna notatka agencji wychodzi do klienta.
 */
const PUBLIC_MARKER_SOURCE = String.raw`\[\s*(?:p|public)\s*\]`
const PUBLIC_MARKER_RE = new RegExp(PUBLIC_MARKER_SOURCE, 'i')

/**
 * Ten sam znacznik razem z otaczającymi spacjami, do usunięcia z wyświetlanej
 * treści. Globalny, bo ktoś może wpisać go dwa razy.
 */
const PUBLIC_MARKER_STRIP_RE = new RegExp(String.raw`[ \t]*${PUBLIC_MARKER_SOURCE}[ \t]*`, 'gi')

/** Dopasowuje "(Imię) " na początku, czyli podpis klienta dodany przez portal. */
const CLIENT_NAME_RE = /^\(([^)]+)\)\s*/

export function isPublicComment(text: string | null | undefined): boolean {
  return typeof text === 'string' && PUBLIC_MARKER_RE.test(text)
}

/**
 * Usuwa znaczniki z treści pokazywanej klientowi.
 *
 * Spacje wokół znacznika zwijamy do jednej TYLKO wtedy, gdy znacznik stał
 * wewnątrz linii. Na początku i na końcu linii nie zostawiamy nic, bo
 * pojedyncza spacja na początku akapitu potrafi w markdownie zmienić
 * formatowanie, a wcięcia w treści klienta nie są nasze do przestawiania.
 */
function stripMarkers(text: string): string {
  return text
    .replace(PUBLIC_MARKER_STRIP_RE, (match, offset: number, full: string) => {
      const atLineStart = offset === 0 || full[offset - 1] === '\n'
      const atLineEnd = offset + match.length >= full.length || full[offset + match.length] === '\n'
      return atLineStart || atLineEnd ? '' : ' '
    })
    .trim()
}

/**
 * Zdejmuje znaczniki i rozpoznaje autora. Komentarz klienta ma na początku
 * "(Imię) ", komentarz agencji nie ma nic.
 */
export function stripPublicPrefix(text: string): { text: string; sender: string } {
  const cleaned = stripMarkers(text)
  const match = cleaned.match(CLIENT_NAME_RE)
  if (match) {
    return { text: cleaned.slice(match[0].length), sender: match[1] }
  }
  return { text: cleaned, sender: 'important.is' }
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
