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

export function getStatusColor(status: string): string {
  const map: Record<string, string> = {
    backlog: '#87909e',
    'do zrobienia': '#e16b16',
    'w trakcie': '#F4BF44',
    zablokowane: '#d33d44',
    zrobione: '#1090e0',
    zamknięte: '#008844',
  }
  return map[status] ?? '#87909e'
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
