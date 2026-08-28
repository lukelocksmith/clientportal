import type { TimeReport } from './timeReports'
import type { EstimateReport } from './estimateReport'

/**
 * Jedna lista zadań zamiast dwóch tabel na jednym ekranie.
 *
 * Do 28.08 zakładka Raporty pokazywała dwie osobne listy: „Pozostała
 * estymacja" (zadania otwarte) i „Raport czasu pracy" (zadania z czasem
 * w okresie). Te same zadania stały w obu, a klient musiał sam składać
 * z nich obraz. Uwaga Łukasza brzmiała wprost: „skoro i tak mamy listę
 * wszystkich zadań, to po co mieć dwie".
 *
 * Czego ta lista ma dowozić, wiadomo ze spotkań z klientem (WDF, 17 i 21.07):
 * Michał budżetuje miesięcznie, pilnuje, żeby faktura nie przebiła założeń,
 * i pyta o stosunek przepracowanego do estymaty. Stąd trzy liczby na górze:
 * ile poszło w tym okresie, ile jest jeszcze zaplanowane i jak wykorzystana
 * jest estymata zadań otwartych.
 *
 * ŹRÓDŁA SIĘ NIE POKRYWAJĄ i to jest sedno scalania:
 *   - raport czasu obejmuje WYBRANY OKRES, także zadania już zamknięte,
 *   - raport estymacji obejmuje ZADANIA OTWARTE, bez względu na okres.
 * Zadanie może więc być w jednym, w drugim albo w obu. Kluczem jest zadanie,
 * a brakujące pola zostają `null`, nie zerem: „nie ma estymacji" i „estymacja
 * zero" znaczą co innego.
 */

export interface MergedRow {
  taskId: string
  name: string
  status: string
  /** Czas zalogowany w WYBRANYM OKRESIE. Zero, gdy zadania w nim nie ruszano. */
  periodMs: number
  /** Estymacja z ClickUpa. `null` = nieustawiona albo zadanie nie jest otwarte. */
  estimateMs: number | null
  /** CAŁY przepracowany czas na zadaniu, nie tylko w tym okresie. */
  spentTotalMs: number | null
  /** `estimateMs - spentTotalMs`. Ujemne znaczy przekroczoną estymację i tak ma zostać. */
  remainingMs: number | null
  /** Czy zadanie wciąż czeka na pracę (jest w raporcie pozostałej estymacji). */
  open: boolean
  /** Pozycja doliczona (organizacja pracy), nie zadanie z ClickUpa. */
  isOverhead?: boolean
}

export interface MergedReport {
  rows: MergedRow[]
  /** Czas w okresie razem z narzutem — ta sama liczba, co na fakturze. */
  periodTotalMs: number
  /** Suma estymacji zadań otwartych. */
  estimateOpenMs: number
  /** Suma czasu już przepracowanego na zadaniach otwartych. */
  spentOpenMs: number
  /** Ile pracy zostało w zadaniach otwartych. Może być ujemne. */
  remainingMs: number
  /** Ile zadań otwartych nie ma estymacji. Bez tego liczby wyżej są niepełne. */
  tasksWithoutEstimate: number
  /**
   * `spentOpenMs / estimateOpenMs` w procentach, albo `null` gdy nie ma czego
   * dzielić. To jest liczba, o którą pytał klient: ile z zaplanowanego czasu
   * już zeszło.
   */
  usagePct: number | null
}

/** Zadania wymagające uwagi na górze: przekroczone, potem najbliższe wyczerpania. */
function porownaj(a: MergedRow, b: MergedRow): number {
  // Narzut zawsze na samym końcu: to nie jest zadanie.
  if (a.isOverhead !== b.isOverhead) return a.isOverhead ? 1 : -1
  // Otwarte przed zamkniętymi: praca przed nami jest ważniejsza niż historia.
  if (a.open !== b.open) return a.open ? -1 : 1
  if (a.open && b.open) {
    const ar = a.remainingMs
    const br = b.remainingMs
    // Zadania bez estymacji na koniec grupy otwartych: nie ma czego porównywać.
    if (ar === null && br === null) return b.periodMs - a.periodMs
    if (ar === null) return 1
    if (br === null) return -1
    return ar - br
  }
  return b.periodMs - a.periodMs
}

export function mergeReports(
  time: TimeReport | null,
  estimate: EstimateReport | null,
): MergedReport {
  const byId = new Map<string, MergedRow>()

  for (const row of estimate?.rows ?? []) {
    byId.set(row.taskId, {
      taskId: row.taskId,
      name: row.name,
      status: row.status,
      periodMs: 0,
      estimateMs: row.estimateMs,
      spentTotalMs: row.spentMs,
      remainingMs: row.remainingMs,
      open: true,
    })
  }

  for (const row of time?.rows ?? []) {
    const istniejacy = byId.get(row.taskId)
    if (istniejacy) {
      istniejacy.periodMs = row.durationMs
      // Nazwa i status z raportu czasu są ŚWIEŻSZE: idą wprost z ClickUpa
      // przy tym żądaniu, a raport estymacji czyta z cache'u zadań.
      istniejacy.name = row.taskName
      istniejacy.status = row.status
      continue
    }
    byId.set(row.taskId, {
      taskId: row.taskId,
      name: row.taskName,
      status: row.status,
      periodMs: row.durationMs,
      estimateMs: null,
      spentTotalMs: null,
      remainingMs: null,
      open: false,
      ...(row.isOverhead ? { isOverhead: true } : {}),
    })
  }

  const rows = [...byId.values()].sort(porownaj)

  const otwarte = rows.filter(r => r.open && r.estimateMs !== null)
  const estimateOpenMs = otwarte.reduce((s, r) => s + (r.estimateMs ?? 0), 0)
  const spentOpenMs = otwarte.reduce((s, r) => s + (r.spentTotalMs ?? 0), 0)

  return {
    rows,
    periodTotalMs: time?.totalMs ?? 0,
    estimateOpenMs,
    spentOpenMs,
    remainingMs: estimate?.totalRemainingMs ?? 0,
    tasksWithoutEstimate: estimate?.tasksWithoutEstimate ?? 0,
    // Dzielimy tylko wtedy, gdy jest przez co: bez estymacji procent byłby
    // nieskończonością albo zerem, a oba czytałyby się jak wynik pomiaru.
    usagePct: estimateOpenMs > 0 ? Math.round((spentOpenMs / estimateOpenMs) * 100) : null,
  }
}
