import { type ClassValue, clsx } from 'clsx'
import { twMerge } from 'tailwind-merge'

export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs))
}

/**
 * Data dla klienta. Rok POKAZUJEMY, gdy jest inny niż bieżący.
 *
 * Wcześniej rok nie pojawiał się nigdy, więc zadanie zgłoszone 6 listopada 2025
 * wyglądało w portalu jak „6 lis" i czytane w lipcu 2026 znaczyło coś zupełnie
 * innego, niż znaczyło. Przy terminach mijało to bez szkody, ale data
 * zgłoszenia jest z natury historyczna: to jest pole, w którym klient sprawdza,
 * jak dawno o coś prosił.
 *
 * `now` da się wstrzyknąć, bo inaczej test tej funkcji zależałby od zegara i
 * przestałby cokolwiek sprawdzać po 1 stycznia.
 */
export function formatDate(dateString: string | null | undefined, now: Date = new Date()): string {
  if (!dateString) return ''
  const date = new Date(Number(dateString))
  if (Number.isNaN(date.getTime())) return ''
  const sameYear = date.getFullYear() === now.getFullYear()
  return date.toLocaleDateString('pl-PL', {
    day: 'numeric',
    month: 'short',
    ...(sameYear ? {} : { year: 'numeric' }),
  })
}

/**
 * Nazwy poziomów zgłoszenia, słownictwem z planu opieki.
 *
 * Wcześniej stały tu nazwy z ClickUpa („Pilne", „Wysokie"), więc klient zgłaszał
 * w czacie „P1 istotna usterka", a na tablicy widział „Wysokie" i musiał sam się
 * domyślić, że to to samo. Czasy reakcji w umowie są przypisane do P1, P2 i P3,
 * nie do słowa „wysokie", więc na ekranie ma stać to, co w tabeli.
 *
 * `urgent` to awaria: nie ma jej w skali czatu, bo idzie przyciskiem Alarm.
 */
export function getPriorityLabel(priority: string | null | undefined): string {
  const map: Record<string, string> = {
    urgent: 'Awaria',
    high: 'P1 istotna usterka',
    normal: 'P2 usterka drobna',
    low: 'P3 zmiana planowana',
  }
  return priority ? (map[priority] ?? priority) : ''
}

/**
 * Krótka forma na kartę zadania, gdzie pełna nazwa nie ma się jak zmieścić.
 * Kolor niesie resztę znaczenia, a pełna nazwa jest w szufladzie i w Historii.
 */
export function getPriorityCode(priority: string | null | undefined): string {
  const map: Record<string, string> = {
    urgent: 'Awaria',
    high: 'P1',
    normal: 'P2',
    low: 'P3',
  }
  return priority ? (map[priority] ?? priority) : ''
}

export function getPriorityColor(priority: string | null | undefined): string {
  const map: Record<string, string> = {
    urgent: '#f50000',
    high: '#f8ae00',
    // Ciemniejszy błękit niż w ClickUpie (#6fddff). Odkąd P2 dostaje plakietkę
    // na każdej karcie, ten kolor jest też kolorem TEKSTU, a jasny cyjan na
    // białym tle był nieczytelny. Ten ton działa w obu motywach.
    normal: '#0891b2',
    low: '#d8d8d8',
  }
  return priority ? (map[priority] ?? '#d8d8d8') : '#d8d8d8'
}

/**
 * Statusy przestrzeni ClickUp "WAŻNI Klienci important.is" w kolejności
 * z ClickUpa (orderindex 0-6). To jest jednocześnie kolejność kolumn kanbana.
 *
 * Leży w JEDNYM pliku z getStatusColor celowo. Wcześniej lista kolumn była
 * w KanbanBoard.tsx, a kolory tutaj, i 2026-08-05 rozjechały się ze sobą
 * i z ClickUpem: "zrobione" przemianowano na "weryfikacja", doszedł
 * "przegląd", przez co 53 zadania po robocie pokazywały się klientowi
 * w kolumnie "backlog", a kolumna "zrobione" stała pusta.
 *
 * Przy każdej zmianie statusów w przestrzeni ClickUp aktualizuj obie rzeczy
 * poniżej naraz. Test w utils.test.ts pilnuje, żeby nie rozjechały się między
 * sobą, ale nie widzi ClickUpa — zgodność z przestrzenią sprawdzasz ręcznie.
 */
export const STATUS_COLUMNS = [
  'backlog',
  'do zrobienia',
  'w trakcie',
  'zablokowane',
  'przegląd',
  'weryfikacja',
  'zamknięte',
] as const

/**
 * Kolory odwzorowują 1:1 statusy przestrzeni ClickUp, żeby klient widział na
 * kanbanie to samo, co zespół widzi w ClickUpie.
 */
export const STATUS_COLORS: Record<string, string> = {
  backlog: '#87909e',
  'do zrobienia': '#e16b16',
  'w trakcie': '#F4BF44',
  zablokowane: '#d33d44',
  przegląd: '#ab4aba',
  weryfikacja: '#1090e0',
  zamknięte: '#008844',
  // Status wycofany z ClickUpa (przemianowany na "weryfikacja"), ale wciąż
  // zapisany przy starszych zadaniach w task_index. Historia i Dashboard
  // czytają z lustra, więc bez tego wpisu stare pozycje zrobiłyby się szare.
  zrobione: '#1090e0',
}

/**
 * Szary dla statusu, którego nie znamy. Celowo taki sam jak kolor backlogu:
 * nieznany status i tak ląduje w kanbanie w kolumnie "backlog", więc pigułka
 * w innym kolorze niż kolumna wyglądałaby na błąd renderowania.
 *
 * Skutek uboczny: po samym zwróconym kolorze NIE poznasz, czy status ma wpis
 * w STATUS_COLORS, czy przepadł na fallback. Sprawdzaj obecność klucza.
 */
const FALLBACK_STATUS_COLOR = '#87909e'

export function getStatusColor(status: string): string {
  return STATUS_COLORS[status] ?? FALLBACK_STATUS_COLOR
}

export function generateId(): string {
  return Math.random().toString(36).slice(2) + Date.now().toString(36)
}

/**
 * Format a duration in milliseconds (ClickUp time_estimate / time_spent) as
 * a compact human string, e.g. 23400000 -> "6h 30m", 2700000 -> "45m".
 * Returns '' for null/undefined/0 so callers can conditionally render.
 */
export function formatDuration(ms: number | null | undefined): string {
  if (!ms || ms <= 0) return ''
  const totalMinutes = Math.round(ms / 60000)
  if (totalMinutes === 0) return '' // below a minute — don't show "0m"
  const hours = Math.floor(totalMinutes / 60)
  const minutes = totalMinutes % 60
  if (hours === 0) return `${minutes}m`
  if (minutes === 0) return `${hours}h`
  return `${hours}h ${minutes}m`
}
