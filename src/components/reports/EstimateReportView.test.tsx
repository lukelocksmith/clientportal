// @vitest-environment jsdom
import { describe, it, afterEach } from 'vitest'
import assert from 'node:assert'
import { render, screen, cleanup } from '@testing-library/react'
import { EstimateReportView } from './EstimateReportView'
import type { EstimateReport, EstimateRow } from '@/lib/estimateReport'

/**
 * Widok raportu "pozostała estymacja" na zakładce Raporty.
 *
 * Testy pilnują dwóch rzeczy, które łatwo popsuć przy zmianie: że przekroczona
 * estymacja pokazuje się jako liczba UJEMNA (nie znika, nie ucina się do zera),
 * i że komunikat o zadaniach bez estymacji pojawia się dokładnie wtedy, gdy
 * jest co pokazać — patrz uzasadnienie w lib/estimateReport.ts.
 *
 *   npx vitest run src/components/reports/EstimateReportView.test.tsx
 */
afterEach(cleanup)

function row(overrides: Partial<EstimateRow> & { taskId: string }): EstimateRow {
  return {
    name: overrides.taskId,
    status: 'do zrobienia',
    url: `https://app.clickup.com/t/${overrides.taskId}`,
    estimateMs: 3_600_000,
    spentMs: 0,
    remainingMs: 3_600_000,
    ...overrides,
  }
}

function report(overrides: Partial<EstimateReport> = {}): EstimateReport {
  return {
    totalRemainingMs: 0,
    rows: [],
    tasksWithoutEstimate: 0,
    ...overrides,
  }
}

describe('suma łączna', () => {
  it('dodatnia suma pokazuje się bez znaku minus', () => {
    render(<EstimateReportView report={report({ totalRemainingMs: 2 * 3_600_000 })} />)

    assert.ok(screen.getByText('2h'))
  })

  it('przekroczona estymacja pokazuje sumę UJEMNĄ, nie zero', () => {
    render(<EstimateReportView report={report({ totalRemainingMs: -2 * 3_600_000 })} />)

    // Zero wyglądałoby jak "wszystko zmieściło się w budżecie" — dokładne
    // przeciwieństwo tego, co się stało.
    assert.ok(screen.getByText('-2h'))
    assert.strictEqual(screen.queryByText('2h'), null)
  })

  it('suma dokładnie zerowa pokazuje "0m", nie pusty ciąg', () => {
    render(<EstimateReportView report={report({ totalRemainingMs: 0 })} />)

    assert.ok(screen.getByText('0m'))
  })
})

describe('zadania bez estymacji', () => {
  it('komunikat NIE pojawia się, gdy wszystkie zadania mają estymację', () => {
    render(<EstimateReportView report={report({ tasksWithoutEstimate: 0 })} />)

    assert.strictEqual(screen.queryByText(/ustawionej estymacji/), null)
  })

  it('liczba pojedyncza: "1 zadanie nie ma"', () => {
    render(<EstimateReportView report={report({ tasksWithoutEstimate: 1 })} />)

    assert.ok(screen.getByText(/1\s+zadanie nie ma/))
  })

  it('liczba mnoga (2-4): "zadania nie mają" — inny czasownik, nie tylko końcówka', () => {
    render(<EstimateReportView report={report({ tasksWithoutEstimate: 3 })} />)

    assert.ok(screen.getByText(/3\s+zadania nie mają/))
  })

  it('liczba mnoga (5+): wraca "zadań nie ma"', () => {
    render(<EstimateReportView report={report({ tasksWithoutEstimate: 18 })} />)

    assert.ok(screen.getByText(/18\s+zadań nie ma/))
  })
})

describe('tabela zadań', () => {
  it('brak zadań z estymacją pokazuje komunikat zamiast pustej tabeli', () => {
    render(<EstimateReportView report={report({ rows: [] })} />)

    assert.ok(screen.getByText(/Brak otwartych zadań z estymacją/))
  })

  it('wiersz z przekroczoną estymacją pokazuje "Zostało" na minusie', () => {
    render(
      <EstimateReportView
        report={report({
          rows: [row({ taskId: 'x', name: 'Zadanie przekroczone', estimateMs: 3_600_000, spentMs: 5 * 3_600_000, remainingMs: -4 * 3_600_000 })],
        })}
      />
    )

    assert.ok(screen.getByText('Zadanie przekroczone'))
    assert.ok(screen.getByText('-4h'))
  })

  it('link zadania prowadzi do jego adresu w ClickUpie', () => {
    render(
      <EstimateReportView
        report={report({ rows: [row({ taskId: 'abc', name: 'Ogarnij X', url: 'https://app.clickup.com/t/abc' })] })}
      />
    )

    const link = screen.getByRole('link', { name: 'Ogarnij X' })
    assert.strictEqual(link.getAttribute('href'), 'https://app.clickup.com/t/abc')
  })

  it('estymacja i przepracowane bez wartości formatują się jako "0m", nie znikają', () => {
    render(
      <EstimateReportView
        report={report({
          // Suma łączna dostaje inną wartość, żeby nie mieszać się z zerami wiersza.
          totalRemainingMs: 5 * 3_600_000,
          rows: [row({ taskId: 'y', estimateMs: 0, spentMs: 0, remainingMs: 0 })],
        })}
      />
    )

    // Kolumny "Estymacja", "Przepracowane" i "Zostało" tego jednego wiersza.
    assert.strictEqual(screen.getAllByText('0m').length, 3)
  })
})
