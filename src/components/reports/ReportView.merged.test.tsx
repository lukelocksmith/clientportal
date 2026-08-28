// @vitest-environment jsdom
/**
 * Scalony ekran „Czas i budżet”.
 *
 * Zastąpił dwie osobne sekcje (raport czasu i pozostała estymacja), więc ten
 * plik przejmuje też to, czego pilnował test skasowanego EstimateReportView:
 * przekroczona estymacja ma być widoczna jako liczba UJEMNA, a komunikat
 * o zadaniach bez estymacji ma się pojawiać dokładnie wtedy, gdy jest co
 * powiedzieć — inaczej liczby na górze wyglądają na pełne, a nie są.
 *
 *   npx vitest run src/components/reports/ReportView.merged.test.tsx
 */
import { describe, it, afterEach } from 'vitest'
import assert from 'node:assert'
import { render, screen, cleanup } from '@testing-library/react'
import { ReportView } from './ReportView'
import type { Period, TimeReport } from '@/lib/timeReports'
import type { EstimateReport } from '@/lib/estimateReport'

afterEach(cleanup)

const H = 3_600_000
const okres = { key: '2026-W34', label: 'Tydzień 34', startMs: 0, endMs: 1 } as Period

const wspolne = {
  slug: 'wdf',
  kind: 'tydzien' as const,
  periods: [okres],
  period: okres,
  olderKey: null,
  newerKey: null,
  branding: { brandColor: '#ff3434', brandForeground: '#fff', logoUrl: null } as never,
}

const czas = (rows: TimeReport['rows']): TimeReport => {
  const taskMs = rows.reduce((s, r) => s + r.durationMs, 0)
  return { period: okres, taskMs, overheadMs: 0, totalMs: taskMs, rows }
}

const estymacja = (rows: EstimateReport['rows'], bez = 0): EstimateReport => ({
  rows,
  totalRemainingMs: rows.reduce((s, r) => s + r.remainingMs, 0),
  tasksWithoutEstimate: bez,
})

describe('jedna lista zamiast dwoch tabel', () => {
  it('zadanie z czasem I estymacja pokazuje sie RAZ', () => {
    render(
      <ReportView
        {...wspolne}
        report={czas([{ taskId: 't1', taskName: 'Zmiana procesu zakupu szkła', status: 'zablokowane', durationMs: 2 * H }])}
        estimateReport={estymacja([
          { taskId: 't1', name: 'Zmiana procesu zakupu szkła', status: 'zablokowane', url: 'u', estimateMs: 16 * H, spentMs: 7 * H, remainingMs: 9 * H },
        ])}
      />
    )

    assert.strictEqual(screen.getAllByText('Zmiana procesu zakupu szkła').length, 1, 'nazwa zadania dwa razy = wrocily dwie listy')
  })

  it('przekroczona estymacja jest widoczna jako liczba UJEMNA', () => {
    render(
      <ReportView
        {...wspolne}
        report={czas([])}
        estimateReport={estymacja([
          { taskId: 't2', name: 'Rozpoznać metodę', status: 'zablokowane', url: 'u', estimateMs: 2 * H, spentMs: 3.25 * H, remainingMs: -1.25 * H },
        ])}
      />
    )

    assert.ok(screen.getByText(/-1h 15m/), 'przekroczenie musi byc widoczne ze znakiem minus')
  })

  it('mowi WPROST, ile zadan nie ma estymacji', () => {
    render(
      <ReportView
        {...wspolne}
        report={czas([])}
        estimateReport={estymacja([
          { taskId: 't3', name: 'Zadanie', status: 'w trakcie', url: 'u', estimateMs: 4 * H, spentMs: H, remainingMs: 3 * H },
        ], 20)}
      />
    )

    assert.ok(screen.getByText(/20 zadań bez estymacji/), 'bez tego liczby wygladaja na pelne, a nie sa')
  })

  it('zuzyta estymata to procent przepracowanego do zaplanowanego', () => {
    render(
      <ReportView
        {...wspolne}
        report={czas([])}
        estimateReport={estymacja([
          { taskId: 'a', name: 'A', status: 'w trakcie', url: 'u', estimateMs: 10 * H, spentMs: 5 * H, remainingMs: 5 * H },
        ])}
      />
    )

    assert.ok(screen.getByText('50%'), 'brak wskaznika zuzycia estymaty')
    assert.ok(screen.getByText(/5h z 10h/), 'brak liczb pod procentem')
  })

  it('WYLACZONA estymacja: ekran wyglada jak dawny raport czasu', () => {
    // Flaga estimateReportEnabled jest per projekt. Klient bez niej nie moze
    // zobaczyc pustych kolumn ani kafla bez tresci.
    render(
      <ReportView
        {...wspolne}
        report={czas([{ taskId: 't1', taskName: 'Zadanie', status: 'zamknięte', durationMs: 3 * H }])}
        estimateReport={null}
      />
    )

    // PORÓWNUJEMY DO `null` PRZEZ `=== null`, nie przekazujemy węzła do
    // asercji. `node:assert` przy niepowodzeniu formatuje otrzymaną wartość,
    // a formatowanie węzła jsdom zjada pamięć i ubija proces testowy: zamiast
    // czerwonego testu dostaje się „Worker exited unexpectedly" po 75 sekundach.
    assert.strictEqual(screen.queryByText('Estymacja') === null, true)
    assert.strictEqual(screen.queryByText('Zostało w planie') === null, true)
    assert.ok(screen.getAllByText('3h').length > 0, 'czas w okresie zostaje')
  })

  it('zadanie otwarte bez czasu w okresie ma w TABELI myslnik, nie zero', () => {
    // „0m" w kolumnie okresu czytaloby sie jak wynik pomiaru, a to jest brak
    // wpisu w tym okresie. Sprawdzamy komorke tabeli, nie caly ekran: „0m"
    // ma prawo stac w kaflu zuzycia estymaty, gdzie znaczy zmierzone zero.
    render(
      <ReportView
        {...wspolne}
        report={czas([])}
        estimateReport={estymacja([
          { taskId: 't4', name: 'Nowe zadanie', status: 'do zrobienia', url: 'u', estimateMs: 4 * H, spentMs: 0, remainingMs: 4 * H },
        ])}
      />
    )

    const wiersz = screen.getByText('Nowe zadanie').closest('tr')
    assert.ok(wiersz, 'brak wiersza zadania')
    const komorki = [...wiersz!.querySelectorAll('td')].map(td => td.textContent?.trim())
    assert.strictEqual(komorki[2], '—', `kolumna okresu ma miec myslnik, byla: ${komorki[2]}`)
    assert.strictEqual(komorki[3], '4h', 'estymacja zostaje')
  })
})
