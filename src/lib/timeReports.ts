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

function formatWeekLabel(start: Date, end: Date): string {
  if (isSameMonth(start, end)) {
    return `${format(start, 'd')}-${format(end, 'd MMMM yyyy', { locale: pl })}`
  }
  return `${format(start, 'd MMM', { locale: pl })} - ${format(end, 'd MMM yyyy', { locale: pl })}`
}

function weekFrom(start: Date): Period {
  const end = endOfISOWeek(start)
  return {
    kind: 'tydzien',
    key: `${getISOWeekYear(start)}-W${String(getISOWeek(start)).padStart(2, '0')}`,
    label: formatWeekLabel(start, end),
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
