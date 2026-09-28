import { AWARIA_TAG } from './utils'
import { PORTAL_VISIBILITY_TAG } from './portalVisibility'

/**
 * Tagi ClickUp doklejane automatycznie do zadań z AI-chatu, per portal
 * (`portals.auto_tags`). Trzymane jako tekst po przecinku, tak samo jak
 * `contactMemberIds` — powód ten sam: jedna kolumna tekstowa zamiast osobnej
 * tabeli dla listy, która nie ma własnego porządku ani metadanych.
 *
 * Admin wybiera z realnych tagów przestrzeni ClickUp (multiselect w
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
 * portalu, tag awarii, jeśli model go rozpoznał, oraz ZAWSZE tag `portal`
 * (lib/portalVisibility.ts) — bez duplikatów.
 *
 * Tag `portal` jest zawsze, bo to zgłoszenie klienta: po włączeniu filtra
 * widoczności bez niego zadanie zniknęłoby z tablicy osobie, która je
 * właśnie zgłosiła. Dlatego wynik nigdy nie jest pusty.
 */
export function buildAiChatTags(autoTagsRaw: string | null, awaria: boolean): string[] {
  const tags = new Set(parseAutoTags(autoTagsRaw))
  if (awaria) tags.add(AWARIA_TAG)
  tags.add(PORTAL_VISIBILITY_TAG)
  return [...tags]
}
