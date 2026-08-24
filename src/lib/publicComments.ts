import type { ClickUpComment } from './types'
import { parseCommentBlocks, blocksToText, type BlockNode, type InlineNode } from './commentBlocks'

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
 * Jak agencja przedstawia się KLIENTOWI.
 *
 * Klient widzi zespół, nigdy konkretną osobę. Nie chodzi o ukrywanie: kto
 * odpisał, wiadomo po naszej stronie (ClickUp, `audit_log`), a klient ma
 * relację z important.is, nie z pojedynczym człowiekiem, który akurat tego dnia
 * siedział przy zadaniu. Bez tego w dzwonku wychodziło „Łukasz Slusarski: test2",
 * a w wątku autor „Admin" (zgłoszone 24.08).
 *
 * STAŁA, nie literał: ten napis jest jednocześnie ETYKIETĄ i WARUNKIEM —
 * `TaskDrawer` i `taskComments` rozpoznają po nim komentarz agencji. Trzy kopie
 * tego samego napisu to kwestia czasu, kiedy jedna się rozjedzie i komentarz
 * agencji zacznie uchodzić za komentarz klienta.
 */
export const AGENCY_SENDER = 'Zespół important.is'

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
  return stripMarkersKeepEdges(text).trim()
}

/**
 * Ta sama operacja BEZ obcinania spacji na końcach.
 *
 * Przy blokach tekst jest pocięty na biegi, a granica biegu wypada w środku
 * zdania: `"Poprawione w "` plus wzmianka o zadaniu. `trim()` na takim biegu
 * zjadał spację i klient dostawał „Poprawione wDrobne poprawki".
 */
function stripMarkersKeepEdges(text: string): string {
  return text.replace(PUBLIC_MARKER_STRIP_RE, (match, offset: number, full: string) => {
    const atLineStart = offset === 0 || full[offset - 1] === '\n'
    const atLineEnd = offset + match.length >= full.length || full[offset + match.length] === '\n'
    return atLineStart || atLineEnd ? '' : ' '
  })
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
  return { text: cleaned, sender: AGENCY_SENDER }
}

/** Komentarze widoczne dla klienta, z zdjętym prefiksem i rozpoznanym autorem. */
export function filterPublicComments(comments: ClickUpComment[]): ClickUpComment[] {
  return comments
    .filter(c => isPublicComment(c.comment_text))
    .map(c => {
      const { sender } = stripPublicPrefix(c.comment_text!)
      const blocks = publicCommentBlocks(c)
      /**
       * WYLICZAMY, co wychodzi, zamiast usuwać, co nie ma wyjść.
       *
       * Wcześniej szło `{ ...c }`, czyli cały obiekt od ClickUpa, i razem z nim
       * do przeglądarki klienta jechały: prywatny adres e-mail autora z
       * zespołu, jego zdjęcie profilowe, surowe bloki ze znacznikiem `[P]` i z
       * oznaczeniami osób. Nic z tego nie było renderowane, więc na ekranie nie
       * było tego widać, a w narzędziach deweloperskich owszem.
       *
       * Lista wprost znaczy, że nowe pole od ClickUpa dotrze do klienta dopiero
       * wtedy, gdy ktoś je tutaj świadomie dopisze.
       *
       * `comment_text` liczymy Z BLOKÓW, nie z pola ClickUpa: tamto zawiera
       * oznaczenia osób i identyfikatory zadań zamiast nazw, czyli frazy,
       * których klient nigdzie nie widzi, a które wracały mu w wynikach
       * szukania w Historii.
       */
      return {
        id: c.id,
        date: c.date,
        sender,
        comment_text: blocksToText(blocks),
        blocks,
      }
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

/**
 * Komentarz świeżo dodany z portalu, gotowy do wyświetlenia od razu, bez
 * ponownego odpytania ClickUpa.
 *
 * POST /task/{id}/comment w ClickUpie zwraca OKROJONY obiekt: tylko `id`,
 * `hist_id` i `date`, BEZ `comment_text`, `user`, `resolved` — inaczej niż
 * odczyt listy komentarzy (GET). Oddanie tej odpowiedzi wprost do przeglądarki
 * kończyło się `undefined.split()` w renderowaniu markdownu, bo szuflada
 * dostawała komentarz bez treści (zgłoszone 2026-08-10).
 *
 * Nie musimy ufać ClickUpowi w tej sprawie: sami napisaliśmy tę treść przed
 * chwilą. Z odpowiedzi ClickUpa bierzemy tylko `id` (do edycji/usunięcia)
 * i `date`, gdy jest. Kształt wynikowy jest taki sam, jak po przejściu przez
 * `filterPublicComments`, żeby świeży komentarz renderował się identycznie
 * jak wczytane z listy.
 */
export function buildOwnComment(
  created: { id: string; date?: string | null },
  text: string,
  senderName: string | null
): ClickUpComment {
  return {
    id: created.id,
    comment_text: text.trim(),
    date: created.date ?? String(Date.now()),
    sender: senderName ?? 'Klient',
    isOwn: true,
    // Ten sam kształt co po `filterPublicComments`, żeby świeży komentarz
    // renderował się identycznie jak wczytany z listy.
    blocks: parseCommentBlocks([{ text: text.trim() }]),
  }
}

/**
 * Treść komentarza jako drzewo bloków, ze zdjętym znacznikiem i podpisem.
 *
 * Portal renderował `comment_text`, czyli spłaszczony tekst od ClickUpa, i
 * tracił na tym całe formatowanie: wzmianka o zadaniu zostawała gołym
 * identyfikatorem, obrazek napisem `image.png` (zgłoszone 2026-08-24).
 * Bloki mają to samo formatowanie co komentarz w ClickUpie, ale NIE mają
 * zdjętego znacznika `[P]` ani podpisu `(Imię)` — te siedzą w treści jako
 * zwykły tekst, więc trzeba je usunąć tutaj, w jednym miejscu z regułą
 * odczytu, a nie w komponencie.
 *
 * Komentarz bez pola `comment` (starszy zapis, własny komentarz zbudowany
 * lokalnie) wraca z tekstu, żeby szuflada miała zawsze co renderować.
 */
export function publicCommentBlocks(comment: ClickUpComment): BlockNode[] {
  const raw = (comment as { comment?: unknown }).comment
  const blocks = Array.isArray(raw) && raw.length > 0
    ? parseCommentBlocks(raw)
    : parseCommentBlocks([{ text: comment.comment_text ?? '' }])

  const cleaned = dropTeamMentions(blocks.map(stripBlockMarkers))
  return dropClientName(dropEmptyEdges(cleaned))
}

/**
 * Wzmianki o OSOBACH wypadają z treści, którą widzi klient.
 *
 * `@Paulina Andrzejewska` w komentarzu nie jest informacją dla klienta, tylko
 * powiadomieniem wewnątrz zespołu: ktoś oznaczył kogoś, żeby ClickUp mu
 * zadzwonił. Klient dostawał z tego samo nazwisko wiszące nad odpowiedzią
 * (zgłoszone 2026-08-24).
 *
 * Wzmianka o ZADANIU zostaje: to kontekst, którego klient szuka, a nie
 * zawiadomienie kogoś z zespołu.
 *
 * Linia, z której po usunięciu wzmianki nic nie zostało, znika CAŁA, także w
 * środku treści. Puste akapity w środku zostawiamy jako odstęp autora, ale ten
 * konkretny nie jest odstępem, tylko dziurą po naszym cięciu.
 */
function dropTeamMentions(blocks: BlockNode[]): BlockNode[] {
  const result: BlockNode[] = []
  for (const block of blocks) {
    switch (block.kind) {
      case 'paragraph':
      case 'heading':
      case 'quote': {
        const inline = withoutMentions(block.inline)
        if (block.inline.length > 0 && inline.length === 0) continue
        result.push({ ...block, inline })
        break
      }
      case 'bullets':
      case 'ordered': {
        const items = block.items
          .map(item => ({ przed: item.length, po: withoutMentions(item) }))
          .filter(({ przed, po }) => !(przed > 0 && po.length === 0))
          .map(({ po }) => po)
        if (items.length === 0) continue
        result.push({ ...block, items })
        break
      }
      case 'table':
        result.push({ ...block, rows: block.rows.map(row => row.map(withoutMentions)) })
        break
      default:
        result.push(block)
    }
  }
  return result
}

/**
 * Usuwa wzmianki i zszywa tekst wokół nich.
 *
 * Bez zszywania „Proszę @Paulina o sprawdzenie" zostawiało podwójną spację, a
 * wzmianka na początku linii zostawiała spację na wcięciu, co w treści klienta
 * wygląda jak literówka po naszej stronie.
 */
function withoutMentions(inline: InlineNode[]): InlineNode[] {
  const out: InlineNode[] = []
  let usunieto = false

  for (const node of inline) {
    if (node.kind === 'mention') {
      usunieto = true
      continue
    }
    if (usunieto && node.kind === 'text') {
      const poprzedni = out[out.length - 1]
      const konczySieSpacja = poprzedni?.kind === 'text' ? /\s$/.test(poprzedni.text) : out.length === 0
      const text = konczySieSpacja ? node.text.replace(/^\s+/, '') : node.text
      usunieto = false
      if (text !== '') out.push({ ...node, text })
      continue
    }
    usunieto = false
    out.push(node)
  }

  // Wzmianka na końcu linii zostawia po sobie spację przed niczym.
  const ostatni = out[out.length - 1]
  if (ostatni?.kind === 'text') {
    const text = ostatni.text.replace(/\s+$/, '')
    if (text === '') out.pop()
    else out[out.length - 1] = { ...ostatni, text }
  }
  return out
}

/** Zdejmuje znacznik z każdego biegu tekstu w bloku. */
function stripBlockMarkers(block: BlockNode): BlockNode {
  switch (block.kind) {
    case 'paragraph':
    case 'heading':
    case 'quote':
      return { ...block, inline: stripInline(block.inline) }
    case 'bullets':
    case 'ordered':
      return { ...block, items: block.items.map(stripInline) }
    case 'table':
      return { ...block, rows: block.rows.map(row => row.map(stripInline)) }
    default:
      return block
  }
}

function stripInline(inline: InlineNode[]): InlineNode[] {
  return inline
    .map(node => (node.kind === 'text' ? { ...node, text: stripMarkersKeepEdges(node.text) } : node))
    .filter(node => node.kind !== 'text' || node.text !== '')
}

/**
 * Puste akapity na KRAWĘDZIACH, powstałe po zdjęciu znacznika stojącego w
 * osobnej linii. W środku treści puste akapity zostają, bo tam są odstępem
 * autora, nie śmieciem po znaczniku.
 */
function dropEmptyEdges(blocks: BlockNode[]): BlockNode[] {
  const isEmpty = (block: BlockNode) => block.kind === 'paragraph' && block.inline.length === 0
  let start = 0
  let end = blocks.length
  while (start < end && isEmpty(blocks[start])) start++
  while (end > start && isEmpty(blocks[end - 1])) end--
  return blocks.slice(start, end)
}

/**
 * Podpis `(Imię)`, którym portal oznacza komentarz klienta przy zapisie. Autor
 * jest już w nagłówku komentarza, więc w treści byłby drugi raz. Liczy się
 * TYLKO na samym początku pierwszego bloku, żeby nawias w środku zdania został
 * nawiasem.
 */
function dropClientName(blocks: BlockNode[]): BlockNode[] {
  const first = blocks[0]
  if (!first || first.kind !== 'paragraph') return blocks
  const head = first.inline[0]
  if (!head || head.kind !== 'text') return blocks
  const match = head.text.match(CLIENT_NAME_RE)
  if (!match) return blocks

  const text = head.text.slice(match[0].length)
  const inline = text === '' ? first.inline.slice(1) : [{ ...head, text }, ...first.inline.slice(1)]
  return [{ ...first, inline }, ...blocks.slice(1)]
}
