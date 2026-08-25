// @vitest-environment jsdom
import { describe, it, afterEach } from 'vitest'
import assert from 'node:assert'
import { render, screen, cleanup } from '@testing-library/react'
import { ReportView } from './ReportView'
import type { Period, TimeReport } from '@/lib/timeReports'

/**
 * Kwota przy „Łącznie" w raporcie czasu pracy.
 *
 * Najwazniejszy test tego pliku to ten o BRAKU STAWKI. Raport lezy obok
 * faktury, wiec kwota zgadnieta albo pokazana jako zero bylaby gorsza niz jej
 * brak — a projekt bez stawki w CRM to sytuacja normalna, nie awaria.
 *
 *   npx vitest run src/components/reports/ReportView.money.test.tsx
 */
afterEach(cleanup)

const H = 60 * 60 * 1000

const okres: Period = {
  key: '2026-W34',
  label: 'Tydzień 34',
  startMs: 0,
  endMs: 1,
} as Period

function raport(totalMs: number): TimeReport {
  return {
    period: okres,
    taskMs: totalMs,
    overheadMs: 0,
    totalMs,
    rows: [{ taskId: 't1', taskName: 'Zadanie', status: 'zamknięte', durationMs: totalMs }],
  }
}

const wspolne = {
  slug: 'wdf',
  kind: 'tydzien' as const,
  periods: [okres],
  period: okres,
  olderKey: null,
  newerKey: null,
  branding: { brandColor: '#ff3434', brandForeground: '#fff', logoUrl: null } as never,
}

describe('kwota przy Lacznie', () => {
  it('pokazuje kwote netto i stawke, gdy stawka jest znana', () => {
    // 10h 14m po 140 zl/h = 1432,67 zl. Ten sam przypadek co w money.test.ts,
    // ale tu sprawdzamy, ze faktycznie DOCIERA na ekran.
    render(<ReportView {...wspolne} report={raport(10 * H + 14 * 60 * 1000)} hourlyRateNet={14000} />)

    assert.ok(screen.getByText(/1\s*432,67\s*zł/), 'brak kwoty netto')
    assert.ok(screen.getByText(/netto/), 'kwota bez podpisu netto da sie przeczytac jako brutto')
    assert.ok(screen.getByText(/140\s*zł\/h/), 'brak stawki godzinowej')
  })

  it('BEZ STAWKI nie pokazuje zadnej kwoty, tylko godziny', () => {
    render(<ReportView {...wspolne} report={raport(10 * H)} hourlyRateNet={null} />)

    assert.strictEqual(screen.queryByText(/zł/) === null, true, 'kwota bez znanej stawki')
    // Godziny maja zostac — brak stawki nie moze zabrac raportu. `getAllBy`,
    // bo „10h" jest i w sumie, i w wierszu tabeli.
    assert.ok(screen.getAllByText(/10h/).length > 0, 'zniknely godziny')
  })

  it('brak przekazanej stawki w ogole (stary wywolujacy) tez milczy', () => {
    render(<ReportView {...wspolne} report={raport(H)} />)

    assert.strictEqual(screen.queryByText(/zł/) === null, true)
  })

  it('zerowy czas daje 0,00 zl, a nie brak kwoty', () => {
    // Okres bez zalogowanego czasu to poprawna odpowiedz „nic sie nie naliczylo",
    // a nie brak danych.
    render(<ReportView {...wspolne} report={raport(0)} hourlyRateNet={14000} />)

    assert.ok(screen.getByText(/0,00\s*zł/))
  })

  it('nieudany raport (null) nie wywala sie przy liczeniu kwoty', () => {
    render(<ReportView {...wspolne} report={null} hourlyRateNet={14000} />)

    assert.ok(screen.getByText(/Nie udało się pobrać/))
  })
})
