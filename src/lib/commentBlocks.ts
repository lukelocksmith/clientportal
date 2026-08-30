/**
 * Przekład komentarza ClickUpa na drzewo bloków do wyświetlenia w portalu.
 *
 * ClickUp oddaje komentarz DWA razy: jako `comment_text` (spłaszczony tekst)
 * i jako `comment` (lista wstawek w duchu Quill delty). Portal czytał
 * `comment_text` i tracił na tym wszystko poza literami: wzmianka o zadaniu
 * zostawała gołym identyfikatorem (`869enjjkr`, zgłoszone 2026-08-24), obrazek
 * napisem `image.png`, a listy, kod, cytaty i linki z etykietą przepadały.
 *
 * Kluczowa własność formatu, na której stoi cały ten plik: atrybuty CAŁEJ
 * LINII (lista, blok kodu, cytat, nagłówek) siedzą na wstawce `"\n"`, która tę
 * linię KOŃCZY, a nie na jej treści. Dlatego parser zbiera bieżącą linię do
 * bufora i dopiero na znaku końca linii wie, czym ta linia była.
 */
import { isInternalFile } from './attachments'

export type InlineNode =
  | { kind: 'text'; text: string; bold?: true; italic?: true; strike?: true; code?: true; link?: string }
  | { kind: 'mention'; label: string }
  /**
   * `name` dopisuje serwer i TYLKO dla zadania z portalu tego klienta
   * (patrz commentMentions.ts). Brak nazwy znaczy „nie wolno pokazać".
   */
  | { kind: 'taskMention'; taskId: string; name?: string }

export type BlockNode =
  | { kind: 'paragraph'; inline: InlineNode[] }
  | { kind: 'heading'; level: number; inline: InlineNode[] }
  | { kind: 'quote'; inline: InlineNode[] }
  | { kind: 'bullets'; items: InlineNode[][] }
  | { kind: 'ordered'; items: InlineNode[][] }
  | { kind: 'code'; language: string | null; lines: string[] }
  | { kind: 'image'; url: string; name: string; width?: number; height?: number }
  | { kind: 'file'; url: string; name: string }
  | { kind: 'video'; url: string; name: string }
  | { kind: 'table'; rows: InlineNode[][][] }

type RawBlock = {
  text?: unknown
  type?: unknown
  attributes?: Record<string, unknown> | null
  user?: { username?: unknown } | null
  task_mention?: { task_id?: unknown } | null
  image?: Record<string, unknown> | null
  attachment?: Record<string, unknown> | null
  frame?: Record<string, unknown> | null
  bookmark?: Record<string, unknown> | null
  link_mention?: Record<string, unknown> | null
  insert?: unknown
  'table-embed'?: Record<string, unknown> | null
}

/** Czym była linia, którą właśnie zamknął znak końca linii. */
type LineKind =
  | { type: 'paragraph' }
  | { type: 'heading'; level: number }
  | { type: 'quote' }
  | { type: 'bullet' }
  | { type: 'ordered' }
  | { type: 'code'; language: string | null }

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null
}

/**
 * Adres, który wolno wstawić do `href`. ClickUp przepuszcza w linku dowolny
 * ciąg, a komentarz idzie do przeglądarki klienta, więc `javascript:` i
 * `data:` odpadają tutaj, a nie w komponencie.
 */
function safeUrl(value: unknown): string | null {
  if (typeof value !== 'string' || value.trim() === '') return null
  const url = value.trim()
  return /^(https?:|mailto:)/i.test(url) ? url : null
}

/** Atrybuty biegu tekstu, których faktycznie używamy przy renderowaniu. */
function inlineMarks(attributes: Record<string, unknown> | null | undefined) {
  const marks: Omit<Extract<InlineNode, { kind: 'text' }>, 'kind' | 'text'> = {}
  if (!attributes) return marks
  if (attributes.bold === true) marks.bold = true
  if (attributes.italic === true) marks.italic = true
  if (attributes.strike === true) marks.strike = true
  if (attributes.code === true) marks.code = true
  const link = safeUrl(attributes.link)
  if (link) marks.link = link
  return marks
}

/**
 * Rodzaj linii z atrybutów wstawki, która ją zamyka.
 *
 * ClickUp zagnieżdża te atrybuty pod własną nazwą (`list: { list: 'bullet' }`,
 * `code-block: { 'code-block': 'css' }`), ale przy prostszych komentarzach
 * przychodzi też forma bez zagnieżdżenia, dlatego czytamy obie.
 */
function lineKind(attributes: Record<string, unknown> | null | undefined): LineKind {
  if (!attributes) return { type: 'paragraph' }

  const codeBlock = attributes['code-block']
  if (codeBlock) {
    const language = isRecord(codeBlock) && typeof codeBlock['code-block'] === 'string'
      ? codeBlock['code-block']
      : typeof codeBlock === 'string'
        ? codeBlock
        : null
    return { type: 'code', language }
  }

  const list = attributes.list
  if (list) {
    const value = isRecord(list) && typeof list.list === 'string' ? list.list : typeof list === 'string' ? list : ''
    return value === 'ordered' ? { type: 'ordered' } : { type: 'bullet' }
  }

  if (attributes.blockquote === true) return { type: 'quote' }

  const header = attributes.header
  if (typeof header === 'number' && header > 0) {
    // Poziomy głębsze niż trzy nie mają w szufladzie własnego rozmiaru, więc
    // spłaszczamy je, zamiast renderować nagłówek nieodróżnialny od tekstu.
    return { type: 'heading', level: Math.min(header, 3) }
  }

  return { type: 'paragraph' }
}

/**
 * Nazwa pliku wyciagnieta z adresu, gdy ClickUp nie poda tytulu: ostatni
 * segment sciezki, bez parametrow zapytania, z rozkodowanym `%20`.
 */
function fileNameFromUrl(url: string): string {
  const path = url.split(/[?#]/)[0]
  const last = path.split('/').pop() ?? ''
  try {
    return decodeURIComponent(last)
  } catch {
    return last
  }
}

const IMAGE_EXTENSIONS = new Set(['png', 'jpg', 'jpeg', 'gif', 'webp', 'svg', 'avif', 'bmp', 'heic'])

/** Czy zalacznik jest obrazkiem, ktory mozna pokazac w tresci. */
function looksLikeImage(meta: Record<string, unknown>, name: string): boolean {
  const mime = typeof meta.mimetype === 'string' ? meta.mimetype : ''
  if (mime.startsWith('image/')) return true
  const extension = typeof meta.extension === 'string' ? meta.extension : name.split('.').pop() ?? ''
  return IMAGE_EXTENSIONS.has(extension.toLowerCase())
}

function numberOrUndefined(value: unknown): number | undefined {
  return typeof value === 'number' && Number.isFinite(value) ? value : undefined
}

/**
 * Serwisy `frame`, ktore umiemy odtworzyc u siebie. Wszystko inne (YouTube,
 * Loom, Figma) zostaje linkiem: osadzanie obcej ramki w portalu klienta to
 * osobna decyzja, nie efekt uboczny naprawy komentarzy.
 */
const PLAYABLE_FRAME_SERVICES = new Set(['clickup_video', 'clickup'])

/** Sam tekst linii, do bloku kodu: w kodzie formatowanie jest bez znaczenia. */
function plainText(inline: InlineNode[]): string {
  return inline
    .map(node => (node.kind === 'text' ? node.text : node.kind === 'mention' ? `@${node.label}` : node.taskId))
    .join('')
}

/**
 * Tabela z komentarza. Wiersze i kolumny przychodzą jako listy identyfikatorów
 * (służą tylko do policzenia wymiarów), a treść siedzi w `cells` pod kluczami
 * `"wiersz:kolumna"`, numerowanymi od jedynki. Pusta tabela nie jest błędem,
 * ale nie ma czego pokazać, więc zwracamy null.
 */
function parseTable(raw: unknown): Extract<BlockNode, { kind: 'table' }> | null {
  if (!isRecord(raw)) return null
  const rowIds = Array.isArray(raw.rows) ? raw.rows : []
  const columnIds = Array.isArray(raw.columns) ? raw.columns : []
  const cells = isRecord(raw.cells) ? raw.cells : {}
  if (rowIds.length === 0 || columnIds.length === 0 || Object.keys(cells).length === 0) return null

  const rows: InlineNode[][][] = []
  for (let r = 1; r <= rowIds.length; r++) {
    const row: InlineNode[][] = []
    for (let c = 1; c <= columnIds.length; c++) {
      const cell = cells[`${r}:${c}`]
      const content = isRecord(cell) ? cell.content : null
      // Komórka to osobna delta, więc parsujemy ją tym samym parserem i
      // spłaszczamy do jednej linii: komórka z akapitami to rzadkość, a
      // tabela w tabeli nie jest nam do niczego potrzebna.
      const parsed = parseCommentBlocks(content)
      const inline = parsed.flatMap(block =>
        block.kind === 'paragraph' || block.kind === 'quote' || block.kind === 'heading' ? block.inline : []
      )
      row.push(inline)
    }
    rows.push(row)
  }
  return { kind: 'table', rows }
}

export function parseCommentBlocks(raw: unknown): BlockNode[] {
  if (!Array.isArray(raw)) return []

  const blocks: BlockNode[] = []
  let line: InlineNode[] = []

  const endLine = (kind: LineKind) => {
    const inline = line
    line = []
    const last = blocks[blocks.length - 1]

    if (kind.type === 'code') {
      const text = plainText(inline)
      if (last?.kind === 'code' && last.language === kind.language) last.lines.push(text)
      else blocks.push({ kind: 'code', language: kind.language, lines: [text] })
      return
    }
    if (kind.type === 'bullet' || kind.type === 'ordered') {
      const target = kind.type === 'bullet' ? 'bullets' : 'ordered'
      if (last?.kind === target) last.items.push(inline)
      else if (target === 'bullets') blocks.push({ kind: 'bullets', items: [inline] })
      else blocks.push({ kind: 'ordered', items: [inline] })
      return
    }
    if (kind.type === 'quote') {
      blocks.push({ kind: 'quote', inline })
      return
    }
    if (kind.type === 'heading') {
      blocks.push({ kind: 'heading', level: kind.level, inline })
      return
    }
    blocks.push({ kind: 'paragraph', inline })
  }

  /** Domyka niedokonczona linie przed blokiem, ktory nie jest tekstem. */
  const flushLine = () => {
    if (line.length > 0) endLine({ type: 'paragraph' })
  }

  for (const item of raw) {
    if (!isRecord(item)) continue
    const block = item as RawBlock
    const type = typeof block.type === 'string' ? block.type : 'text'

    if (type === 'task_mention') {
      const taskId = block.task_mention && typeof block.task_mention.task_id === 'string'
        ? block.task_mention.task_id
        : null
      if (taskId) {
        line.push({ kind: 'taskMention', taskId })
      } else if (typeof block.text === 'string' && block.text) {
        line.push({ kind: 'text', text: block.text })
      }
      continue
    }

    if (type === 'tag' || type === 'followers_tag') {
      line.push({ kind: 'mention', label: mentionLabel(block) })
      continue
    }

    // Obrazki, pliki i wideo są blokami, więc zamykają zaczętą linię.
    // Bez tego zdanie „Zobacz:" i obrazek trafiłyby do jednego akapitu.
    if (type === 'image') {
      const meta = isRecord(block.image) ? block.image : {}
      const url = safeUrl(meta.url)
      if (!url) continue
      const name = typeof meta.title === 'string' && meta.title
        ? meta.title
        : typeof meta.name === 'string' && meta.name
          ? meta.name
          : fileNameFromUrl(url)
      // Plik wewnętrzny (nazwa od podkreślenia) wypada z komentarza tak samo
      // jak z załączników zadania — patrz lib/attachments.ts.
      if (isInternalFile(name)) continue
      flushLine()
      blocks.push({
        kind: 'image',
        url,
        name,
        ...(numberOrUndefined(meta.width) !== undefined ? { width: numberOrUndefined(meta.width) } : {}),
        ...(numberOrUndefined(meta.height) !== undefined ? { height: numberOrUndefined(meta.height) } : {}),
      })
      continue
    }

    if (type === 'attachment') {
      const meta = isRecord(block.attachment) ? block.attachment : {}
      const url = safeUrl(meta.url)
      if (!url) continue
      const name = typeof meta.title === 'string' && meta.title ? meta.title : fileNameFromUrl(url)
      if (isInternalFile(name)) continue
      flushLine()
      blocks.push(looksLikeImage(meta, name) ? { kind: 'image', url, name } : { kind: 'file', url, name })
      continue
    }

    if (type === 'frame') {
      const meta = isRecord(block.frame) ? block.frame : {}
      const url = safeUrl(meta.url) ?? safeUrl(meta.src)
      if (!url) continue
      const service = typeof meta.service === 'string' ? meta.service : ''
      if (PLAYABLE_FRAME_SERVICES.has(service)) {
        flushLine()
        blocks.push({ kind: 'video', url, name: fileNameFromUrl(url) })
      } else {
        line.push({ kind: 'text', text: url, link: url })
      }
      continue
    }

    if (type === 'table-embed') {
      const table = parseTable(block['table-embed'])
      if (!table) continue
      flushLine()
      blocks.push(table)
      continue
    }

    if (type === 'bookmark' || type === 'link_mention') {
      const meta = isRecord(block.bookmark) ? block.bookmark : isRecord(block.link_mention) ? block.link_mention : {}
      const url = safeUrl(meta.url) ?? safeUrl(meta.id)
      if (!url) continue
      const label = typeof block.text === 'string' && block.text.trim() ? block.text : url
      line.push({ kind: 'text', text: label, link: url })
      continue
    }

    // Komórki tabeli mają własną deltę, w której tekst siedzi pod `insert`.
    // Poza tabelą `insert` nie występuje, więc jeden odczyt obsługuje oba.
    const text = typeof block.text === 'string'
      ? block.text
      : typeof block.insert === 'string'
        ? block.insert
        : ''
    if (!text) continue

    // Znaki końca linii mogą siedzieć w środku biegu tekstu, nie tylko na
    // osobnej wstawce, więc dzielimy zawsze.
    const marks = inlineMarks(block.attributes)
    const kind = lineKind(block.attributes)
    const parts = text.split('\n')
    parts.forEach((part, index) => {
      if (index > 0) endLine(kind)
      if (part) line.push({ kind: 'text', text: part, ...marks })
    })
  }

  // Ostatnia linia bez zamykającego `\n` (ClickUp zwykle je stawia, ale nie
  // zawsze) nadal jest akapitem.
  if (line.length > 0) endLine({ type: 'paragraph' })

  return blocks
}

/** Nazwa osoby bez małpy: małpa jest ozdobą ClickUpa, nie częścią imienia. */
function mentionLabel(block: RawBlock): string {
  const fromUser = block.user && typeof block.user.username === 'string' ? block.user.username : null
  if (fromUser) return fromUser
  const text = typeof block.text === 'string' ? block.text : ''
  return text.replace(/^@/, '')
}

/**
 * Płaski tekst z gotowych bloków. Jedno źródło prawdy dla `comment_text`
 * pokazywanego klientowi i dla indeksu wyszukiwania Historii.
 *
 * Nie bierzemy `comment_text` od ClickUpa, bo ono zawiera to, co z widoku
 * usuwamy: wzmianki o osobach i identyfikatory zadań zamiast nazw. Tekst
 * niezgodny z tym, co widać na ekranie, wracał potem w wynikach wyszukiwania
 * jako fraza, której klient nigdzie nie widział.
 *
 * Wzmianka o zadaniu BEZ nazwy nie wchodzi do tekstu wcale: nazwy nie wolno
 * pokazać, a identyfikator w wynikach szukania jest szumem.
 */
export function blocksToText(blocks: readonly BlockNode[]): string {
  const inline = (nodes: InlineNode[]): string =>
    nodes
      .map(node => {
        if (node.kind === 'text') return node.text
        if (node.kind === 'taskMention') return node.name ?? ''
        return ''
      })
      .join('')

  return blocks
    .map(block => {
      switch (block.kind) {
        case 'paragraph':
        case 'heading':
        case 'quote':
          return inline(block.inline)
        case 'bullets':
        case 'ordered':
          return block.items.map(inline).join('\n')
        case 'code':
          return block.lines.join('\n')
        case 'table':
          return block.rows.map(row => row.map(inline).join(' ')).join('\n')
        case 'image':
        case 'file':
        case 'video':
          return block.name
      }
    })
    .join('\n')
    .replace(/\n{3,}/g, '\n\n')
    .trim()
}
