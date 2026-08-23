/**
 * Identyfikator przestrzeni ClickUp "WAŻNI Klienci important.is".
 *
 * Dotąd ta wartość żyła w trzech miejscach naraz: jako default kolumny w
 * schemacie bazy, w trasie folderów admina i dwukrotnie w AdminPanelu.
 * Stała zamiast literałów: zmiana przestrzeni wymaga dotknięcia JEDNEGO
 * miejsca (plus migracji istniejących wierszy), a nie szukania po plikach.
 *
 * Uwaga na default w schemacie (`clickupSpaceId`): nowy portal utworzony bez
 * podania wartości po cichu wskazywałby tę przestrzeń. To świadomy kompromis,
 * bo wszystkie dzisiejsze portale tu siedzą; przy dodaniu kolejnej przestrzeni
 * default trzeba usunąć i podawać wartość jawnie.
 */
export const DEFAULT_CLICKUP_SPACE_ID = '90100136256'

/** Wartość obowiązująca w danym środowisku: zmienna środowiskowa albo fallback. */
export function DEFAULT_SPACE_ID(): string {
  return process.env.CLICKUP_SPACE_ID ?? DEFAULT_CLICKUP_SPACE_ID
}
