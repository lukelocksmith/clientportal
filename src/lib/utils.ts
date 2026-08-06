import { type ClassValue, clsx } from 'clsx'
import { twMerge } from 'tailwind-merge'
import type { ClickUpTag } from '@/lib/types'

export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs))
}

/**
 * Tag, którym w ClickUpie oznaczamy zgłoszenie awaryjne.
 *
 * Awaria nie ma własnej wartości w polu priority (patrz `PriorityLevel.clickup`
 * w taskPrompt.ts), bo idzie osobnym kanałem: czerwonym przyciskiem Alarm,
 * który powiadamia zespół i uruchamia zegar. Bez tagu tablica nie odróżniłaby
 * zgłoszenia awaryjnego od zwykłego pilnego zadania, więc to tag, nie
 * priorytet, zapala plakietkę Alarm.
 *
 * Stała siedzi tutaj, a nie przy prompcie, żeby komponenty klienckie mogły jej
 * użyć bez wciągania całego tekstu promptu do paczki przeglądarki.
 */
export const AWARIA_TAG = 'awaria'

/**
 * Czy zadanie jest zgłoszeniem awaryjnym.
 *
 * Porównanie bez względu na wielkość liter i białe znaki, bo tag nadaje też
 * człowiek ręcznie w ClickUpie, a „Awaria" i „awaria " to ta sama intencja.
 */
export function isAwaria(tags: ClickUpTag[] | undefined | null): boolean {
  return (tags ?? []).some(t => t.name?.trim().toLowerCase() === AWARIA_TAG)
}

/**
 * Komentarze od najstarszego do najnowszego, czyli tak, jak czyta się rozmowę.
 *
 * ClickUp oddaje je ODWROTNIE, od najnowszego. Portal długo przepuszczał tę
 * kolejność bez zmian, a jednocześnie świeżo wysłany komentarz dopinał na
 * koniec listy, więc własna wypowiedź klienta lądowała pod najstarszą, w wątku
 * czytanym od końca. Dwa błędy, które częściowo się maskowały.
 *
 * Sortujemy po dacie, nie odwracamy tablicy: `reverse()` zakłada, że ClickUp
 * zawsze odda idealnie posortowaną listę, a to założenie o cudzym API, którego
 * nie kontrolujemy. Sortowanie stabilne, więc komentarze z identycznym
 * znacznikiem czasu zachowują kolejność ze źródła.
 */
export function sortOldestFirst<T extends { date: string }>(comments: T[]): T[] {
  return [...comments].sort((a, b) => Number(a.date) - Number(b.date))
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
 * Nazwy priorytetów, po polsku, ale to nazwy Z CLICKUPA, nie z umowy.
 *
 * Portal odwzorowuje ClickUp i nie wprowadza własnego słownictwa dla cudzych
 * danych. Kody P0-P3 należą do umowy i do klasyfikacji, którą robi asystentka
 * w czacie; na tablicy, w szufladzie i w Historii stoi to, co widzi zespół
 * w ClickUpie. Odwzorowanie skali umownej: P1 = urgent, P2 = high,
 * P3 = normal. `low` nie ma poziomu umownego, a awaria nie ma tu nic, bo
 * rozpoznaje się ją po tagu (patrz `isAwaria`), nie po priorytecie.
 *
 * Świadomy koszt: czat mówi „P1 istotna usterka", tablica pokazuje „Pilny",
 * więc klient musi sam skojarzyć jedno z drugim. Łukasz wybrał to 2026-08-06,
 * mając ten koszt na ekranie, bo mirror jest ważniejszy.
 */
export function getPriorityLabel(priority: string | null | undefined): string {
  const map: Record<string, string> = {
    urgent: 'Pilny',
    high: 'Wysoki',
    normal: 'Normalny',
    low: 'Niski',
  }
  return priority ? (map[priority] ?? priority) : ''
}

/**
 * Krótka forma na kartę zadania. Przy nazwach z ClickUpa jest identyczna jak
 * pełna, bo „Pilny" i tak się mieści. Funkcja zostaje osobno, żeby karta i
 * szuflada dały się rozjechać wtedy, gdy będzie po co, a nie przez przypadek.
 */
export function getPriorityCode(priority: string | null | undefined): string {
  return getPriorityLabel(priority)
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
