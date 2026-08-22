import { AWARIA_TAG } from './utils'

/**
 * Tagi ClickUp doklejane automatycznie do zadań z AI-chatu, per portal
 * (`portals.auto_tags`). Trzymane jako tekst po przecinku, tak samo jak
 * `contactMemberIds` — powód ten sam: jedna kolumna tekstowa zamiast osobnej
 * tabeli dla listy, która nie ma własnego porządku ani metadanych.
 *
 * Admin wybiera z realnych tagów przestrzeni ClickUp (checkboxy w
 * PortalConfigForm, źródło: getSpaceTags), więc ten moduł nie waliduje
 * istnienia tagu — tylko parsuje/serializuje to, co już przeszło przez wybór.
 */

export function parseAutoTags(raw: string | null): string[] {
  if (!raw) return []
  return raw
    .split(',')
    .map(t => t.trim())
    .filter(Boolean)
}

/** Pusta lista wraca jako `null`, nie `''` — spójnie z resztą pól opcjonalnych portalu. */
export function serializeAutoTags(tags: readonly string[]): string | null {
  const clean = [...new Set(tags.map(t => t.trim()).filter(Boolean))]
  return clean.length > 0 ? clean.join(',') : null
}

/**
 * Tagi dla zadania zakładanego przez AI-chat: skonfigurowane `autoTags`
 * portalu plus tag awarii, jeśli model go rozpoznał — bez duplikatów.
 *
 * Zwraca `undefined`, nie `[]`, gdy wynik jest pusty: `createTask` traktuje
 * `tags: undefined` jako „nie wysyłaj pola", a pusta tablica u ClickUpa
 * potrafi się zachować inaczej niż brak pola.
 */
export function buildAiChatTags(autoTagsRaw: string | null, awaria: boolean): string[] | undefined {
  const tags = new Set(parseAutoTags(autoTagsRaw))
  if (awaria) tags.add(AWARIA_TAG)
  return tags.size > 0 ? [...tags] : undefined
}
