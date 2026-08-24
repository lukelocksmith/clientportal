import type { BlockNode, InlineNode } from './commentBlocks'

/**
 * Wzmianki o zadaniach w komentarzach: z identyfikatora na nazwę i link.
 *
 * ClickUp wstawia do komentarza wzmiankę, w której jest TYLKO identyfikator
 * zadania. Portal pokazywał go klientowi jako `869enjjkr` (zgłoszone
 * 2026-08-24), bo renderował spłaszczony tekst.
 *
 * REGUŁA BEZPIECZEŃSTWA: nazwę pokazujemy wyłącznie dla zadania, które należy
 * do portalu TEGO klienta. Komentarz publiczny może wspominać zadanie z innej
 * listy albo z portalu innego klienta, a nazwa takiego zadania to wyciek, nie
 * brakujący kontekst. Rozstrzyga o tym serwer, więc do przeglądarki nie
 * wychodzi nawet nazwa, której nie wolno pokazać.
 *
 * Dlatego wersja z polem `Link do portalu` w ClickUpie nie wystarcza:
 * to pole trzymałoby adres portalu WŁAŚCICIELA zadania, więc podstawione w
 * komentarzu u innego klienta prowadziłoby go do cudzego portalu.
 */

/** Nazwa zadania w zakresie portalu, albo `null` gdy zadania tam nie ma. */
export type MentionNames = Map<string, string | null>

type MentionLookup = {
  /** Nazwy z naszego indeksu, zawężonego do zadań tego portalu. */
  indexed: (taskIds: string[]) => Promise<Map<string, string>>
  /** Sprawdzenie na żywo w ClickUpie: nazwa albo `null`, gdy poza zakresem. */
  live: (taskId: string) => Promise<{ name: string } | null>
}

function inlineOf(block: BlockNode): InlineNode[][] {
  switch (block.kind) {
    case 'paragraph':
    case 'heading':
    case 'quote':
      return [block.inline]
    case 'bullets':
    case 'ordered':
      return block.items
    case 'table':
      return block.rows.flat()
    default:
      return []
  }
}

/** Identyfikatory zadań wspomnianych w komentarzu, bez powtórzeń. */
export function collectTaskMentions(blocks: readonly BlockNode[]): string[] {
  const ids = new Set<string>()
  for (const block of blocks) {
    for (const inline of inlineOf(block)) {
      for (const node of inline) {
        if (node.kind === 'taskMention') ids.add(node.taskId)
      }
    }
  }
  return [...ids]
}

function withNames(inline: InlineNode[], names: MentionNames): InlineNode[] {
  return inline.map(node => {
    if (node.kind !== 'taskMention') return node
    const name = names.get(node.taskId)
    // `undefined` (nie pytaliśmy) i `null` (poza zakresem) traktujemy tak samo:
    // bez nazwy. Różnica między nimi nie jest informacją dla klienta.
    return name ? { kind: 'taskMention' as const, taskId: node.taskId, name } : node
  })
}

/** Wstawia nazwy do wzmianek. Zadania bez nazwy zostają bez zmian. */
export function applyTaskMentions(blocks: readonly BlockNode[], names: MentionNames): BlockNode[] {
  return blocks.map(block => {
    switch (block.kind) {
      case 'paragraph':
      case 'heading':
      case 'quote':
        return { ...block, inline: withNames(block.inline, names) }
      case 'bullets':
      case 'ordered':
        return { ...block, items: block.items.map(item => withNames(item, names)) }
      case 'table':
        return { ...block, rows: block.rows.map(row => row.map(cell => withNames(cell, names))) }
      default:
        return block
    }
  })
}

/**
 * Nazwy dla wspomnianych zadań: najpierw z indeksu (darmowo, jedno zapytanie),
 * a dopiero dla nieznalezionych pytamy ClickUpa. Zadanie utworzone po ostatnim
 * przebiegu indeksera jeszcze w nim nie jest, a wzmianki są rzadkie (jedna na
 * 369 komentarzy w pomiarze z 2026-08-24), więc ten dodatkowy strzał kosztuje
 * mniej niż pokazanie klientowi wzmianki bez nazwy przez godzinę.
 *
 * Awaria któregokolwiek źródła daje `null`, czyli wzmiankę bez nazwy. Komentarz
 * ma się wyrenderować także wtedy, gdy ClickUp nie odpowiada.
 */
export async function resolveTaskMentions(
  taskIds: readonly string[],
  lookup: MentionLookup
): Promise<MentionNames> {
  const names: MentionNames = new Map()
  if (taskIds.length === 0) return names

  const unique = [...new Set(taskIds)]
  let indexed = new Map<string, string>()
  try {
    indexed = await lookup.indexed(unique)
  } catch {
    indexed = new Map()
  }

  const missing: string[] = []
  for (const id of unique) {
    const name = indexed.get(id)
    if (name) names.set(id, name)
    else missing.push(id)
  }

  await Promise.all(
    missing.map(async id => {
      try {
        const task = await lookup.live(id)
        names.set(id, task?.name ?? null)
      } catch {
        names.set(id, null)
      }
    })
  )

  return names
}
