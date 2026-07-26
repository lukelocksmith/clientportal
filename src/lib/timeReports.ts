/**
 * Okresy raportowe i agregacja czasu dla zakładki Raporty.
 *
 * Czysty moduł, bez zależności od Next, bazy i sieci, żeby dał się sprawdzić
 * skryptem (patrz scripts/check-timeReports.ts).
 *
 * WAŻNE, granice okresów liczymy jawnie w strefie Europe/Warsaw przez TZDate,
 * a nie na ambientnym TZ procesu. Kontener produkcyjny chodzi na UTC i bez tego
 * poniedziałek przed godziną 2:00 wpadałby do poprzedniego tygodnia, a sumy
 * nie zgadzałyby się z ClickUp.
 */
import { TZDate } from '@date-fns/tz'
import {
  endOfISOWeek,
  endOfMonth,
  format,
  getISOWeek,
  getISOWeekYear,
  isSameMonth,
  setISOWeek,
  setISOWeekYear,
  startOfISOWeek,
  startOfMonth,
  subMonths,
  subWeeks,
} from 'date-fns'
import { pl } from 'date-fns/locale'
import type { ClickUpTimeEntry } from './types'

const TZ = 'Europe/Warsaw'

export type PeriodKind = 'tydzien' | 'miesiac'

export interface Period {
  kind: PeriodKind
  /** '2026-W29' dla tygodnia, '2026-07' dla miesiąca. Trafia do URL. */
  key: string
  /** '13-19 lipca 2026' albo 'czerwiec 2026'. */
  label: string
  startMs: number
  /** Ostatnia milisekunda okresu, czyli 23:59:59.999 ostatniego dnia. */
  endMs: number
}

function inWarsaw(now: Date): TZDate {
  return new TZDate(now.getTime(), TZ)
}

/** Numer tygodnia dopisany na końcu, bo klient rozlicza się tygodniami ISO. */
function formatWeekLabel(start: Date, end: Date, weekNumber: number): string {
  const range = isSameMonth(start, end)
    ? `${format(start, 'd')}-${format(end, 'd MMMM yyyy', { locale: pl })}`
    : `${format(start, 'd MMM', { locale: pl })} - ${format(end, 'd MMM yyyy', { locale: pl })}`
  return `${range} (tyg. ${weekNumber})`
}

function weekFrom(start: Date): Period {
  const end = endOfISOWeek(start)
  const weekNumber = getISOWeek(start)
  return {
    kind: 'tydzien',
    key: `${getISOWeekYear(start)}-W${String(weekNumber).padStart(2, '0')}`,
    label: formatWeekLabel(start, end, weekNumber),
    startMs: start.getTime(),
    endMs: end.getTime(),
  }
}

function monthFrom(start: Date): Period {
  return {
    kind: 'miesiac',
    key: format(start, 'yyyy-MM'),
    label: format(start, 'LLLL yyyy', { locale: pl }),
    startMs: start.getTime(),
    endMs: endOfMonth(start).getTime(),
  }
}

/** Początek bieżącego, jeszcze niezamkniętego okresu. */
function currentPeriodStart(kind: PeriodKind, now: Date): Date {
  const base = inWarsaw(now)
  return kind === 'tydzien' ? startOfISOWeek(base) : startOfMonth(base)
}

/**
 * Zamknięte okresy, najnowszy pierwszy. Bieżący okres nigdy się tu nie pojawia,
 * bo klient nie ma widzieć liczby rosnącej w trakcie oglądania.
 */
export function listPeriods(kind: PeriodKind, count = 12, now: Date = new Date()): Period[] {
  const out: Period[] = []
  if (kind === 'tydzien') {
    const lastClosed = subWeeks(currentPeriodStart('tydzien', now), 1)
    for (let i = 0; i < count; i++) out.push(weekFrom(subWeeks(lastClosed, i)))
  } else {
    const lastClosed = subMonths(currentPeriodStart('miesiac', now), 1)
    for (let i = 0; i < count; i++) out.push(monthFrom(subMonths(lastClosed, i)))
  }
  return out
}

/**
 * Zamienia klucz z URL na okres. Zwraca null dla klucza niepoprawnego,
 * nieistniejącego (np. 2027-W53) oraz dla okresu bieżącego i przyszłego.
 */
export function parsePeriodKey(kind: PeriodKind, key: string, now: Date = new Date()): Period | null {
  const base = inWarsaw(now)

  if (kind === 'tydzien') {
    const m = /^(\d{4})-W(\d{2})$/.exec(key)
    if (!m) return null
    const week = Number(m[2])
    if (week < 1 || week > 53) return null
    const start = startOfISOWeek(setISOWeek(setISOWeekYear(base, Number(m[1])), week))
    const period = weekFrom(start)
    // Rok bez 53. tygodnia przepełni się na W01 następnego roku. Porównanie
    // klucza wyłapuje taki przypadek zamiast cicho pokazać zły tydzień.
    if (period.key !== key) return null
    if (period.startMs >= currentPeriodStart('tydzien', now).getTime()) return null
    return period
  }

  const m = /^(\d{4})-(\d{2})$/.exec(key)
  if (!m) return null
  const month = Number(m[2])
  if (month < 1 || month > 12) return null
  const start = startOfMonth(new TZDate(Number(m[1]), month - 1, 1, TZ))
  const period = monthFrom(start)
  if (period.startMs >= currentPeriodStart('miesiac', now).getTime()) return null
  return period
}

/**
 * Sąsiedni okres. delta -1 to starszy, +1 to nowszy. Zwraca null, gdy wynik
 * wyszedłby na okres bieżący lub przyszły, co wyłącza strzałkę w prawo.
 */
export function shiftPeriod(period: Period, delta: number, now: Date = new Date()): Period | null {
  const start = new TZDate(period.startMs, TZ)
  const shifted = period.kind === 'tydzien' ? subWeeks(start, -delta) : subMonths(start, -delta)
  const next =
    period.kind === 'tydzien' ? weekFrom(startOfISOWeek(shifted)) : monthFrom(startOfMonth(shifted))
  if (next.startMs >= currentPeriodStart(period.kind, now).getTime()) return null
  return next
}

export interface ReportRow {
  taskId: string
  taskName: string
  status: string
  durationMs: number
  /** Pozycja doliczona (organizacja pracy), nie prawdziwe zadanie z ClickUp. */
  isOverhead?: boolean
}

export interface TimeReport {
  period: Period
  /** Czas zalogowany na zadaniach, bez narzutu. */
  taskMs: number
  /** Narzut za organizację pracy, 10% czasu zadań. */
  overheadMs: number
  /** taskMs + overheadMs. To jest kwota, którą klient widzi na fakturze. */
  totalMs: number
  /** Zadania malejąco, a na końcu pozycja narzutu, jeśli sięga minuty. */
  rows: ReportRow[]
}

/** Wiersze krótsze niż minuta wypadają, bo formatDuration zwraca dla nich pusty string. */
const MIN_ROW_MS = 60_000

/**
 * Narzut za organizację pracy doliczany do każdego rozliczenia.
 * Nazwa i stawka odwzorowują generator raportów w CRM (Notion, baza
 * "płatnosći important"), żeby portal pokazywał to samo, co klient dostaje
 * mailem i na fakturze.
 */
const OVERHEAD_RATE = 0.1
const OVERHEAD_LABEL =
  'Organizacja pracy i komunikacja wewnątrz zespołu projektowego, planowanie i nadzór nad zadaniami, raportowanie postępów, wystawianie zadań i weryfikacja wykonania'

/**
 * Status pokazywany przy pozycji narzutu. Musi być jednym ze statusów
 * przestrzeni ClickUp, żeby wiersz wyglądał jak każdy inny i dostał kolor
 * z getStatusColor. Praca organizacyjna za zamknięty okres jest wykonana,
 * więc "zrobione".
 */
const OVERHEAD_STATUS = 'zrobione'

/**
 * Narzut obcinany W DÓŁ do pełnych minut, nie zaokrąglany.
 * Tak liczy generator w Notion: 1237 min daje 123 min (123,7), a 485 min
 * daje 48 min (48,5). Zwykłe zaokrąglanie dałoby 49 i rozjechałoby portal
 * z fakturą o minutę na części projektów.
 */
function overheadFor(taskMs: number): number {
  return Math.floor((taskMs * OVERHEAD_RATE) / 60_000) * 60_000
}

/**
 * Sumuje wpisy czasu po zadaniu i dokleja narzut za organizację pracy.
 *
 * Odrzuca dwa rodzaje śmieci, oba widziane w prawdziwych danych: uruchomione
 * stopery (ujemny duration) oraz stopery odpalone poza zadaniem
 * (task_location.folder_id === null).
 *
 * taskMs liczy się ze wszystkich poprawnych wpisów, także krótszych niż
 * minuta, żeby zgadzało się z ClickUp. Z listy wierszy takie zadania wypadają,
 * bo formatDuration pokazałby dla nich pustą komórkę.
 */
export function buildReport(period: Period, entries: ClickUpTimeEntry[]): TimeReport {
  const byTask = new Map<string, ReportRow>()
  let taskMs = 0

  for (const entry of entries) {
    const ms = Number(entry.duration)
    if (!Number.isFinite(ms) || ms <= 0) continue
    if (!entry.task || !entry.task_location?.folder_id) continue

    taskMs += ms
    const existing = byTask.get(entry.task.id)
    if (existing) {
      existing.durationMs += ms
    } else {
      byTask.set(entry.task.id, {
        taskId: entry.task.id,
        taskName: entry.task.name,
        status: entry.task.status.status,
        durationMs: ms,
      })
    }
  }

  const rows = [...byTask.values()]
    .filter(row => row.durationMs >= MIN_ROW_MS)
    .sort((a, b) => b.durationMs - a.durationMs)

  const overheadMs = overheadFor(taskMs)

  // Narzut zawsze na końcu, poza sortowaniem po czasie, bo to nie zadanie.
  if (overheadMs >= MIN_ROW_MS) {
    rows.push({
      taskId: 'overhead',
      taskName: OVERHEAD_LABEL,
      status: OVERHEAD_STATUS,
      durationMs: overheadMs,
      isOverhead: true,
    })
  }

  return { period, taskMs, overheadMs, totalMs: taskMs + overheadMs, rows }
}
