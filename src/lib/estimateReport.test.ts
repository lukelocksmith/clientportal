import { describe, it } from 'vitest'
import assert from 'node:assert/strict'
import { buildEstimateReport } from '@/lib/estimateReport'
import type { ClickUpTask } from '@/lib/types'

function task(opts: {
  id: string
  status: string
  time_estimate?: number | null
  time_spent?: number | null
  name?: string
}): ClickUpTask {
  return {
    id: opts.id,
    name: opts.name ?? opts.id,
    description: null,
    status: { status: opts.status, color: '', type: 'custom', orderindex: 0 },
    priority: null,
    assignees: [],
    date_created: '0',
    date_updated: '0',
    date_due: null,
    date_start: null,
    list: { id: 'l1', name: 'Lista' },
    folder: { id: 'f1', name: 'Folder' },
    parent: null,
    time_estimate: opts.time_estimate ?? null,
    time_spent: opts.time_spent ?? null,
    url: 'https://app.clickup.com/t/' + opts.id,
  }
}

describe('buildEstimateReport', () => {
  it('liczy pozostałą estymację tylko dla do zrobienia / w trakcie / zablokowane', () => {
    const tasks = [
      task({ id: '1', status: 'do zrobienia', time_estimate: 3 * 3_600_000, time_spent: 1 * 3_600_000 }),
      task({ id: '2', status: 'w trakcie', time_estimate: 2 * 3_600_000, time_spent: 0 }),
      task({ id: '3', status: 'zablokowane', time_estimate: 1 * 3_600_000, time_spent: 0 }),
      // Statusy spoza zakresu nie wliczają się w ogóle.
      task({ id: '4', status: 'backlog', time_estimate: 5 * 3_600_000, time_spent: 0 }),
      task({ id: '5', status: 'zamknięte', time_estimate: 5 * 3_600_000, time_spent: 0 }),
    ]

    const report = buildEstimateReport(tasks)

    assert.equal(report.rows.length, 3)
    assert.equal(report.totalRemainingMs, 2 * 3_600_000 + 2 * 3_600_000 + 1 * 3_600_000)
    assert.equal(report.tasksWithoutEstimate, 0)
  })

  it('pomija z sumy zadania bez ustawionej estymacji, ale liczy je osobno', () => {
    const tasks = [
      task({ id: '1', status: 'do zrobienia', time_estimate: null, time_spent: 3_600_000 }),
      task({ id: '2', status: 'w trakcie', time_estimate: 2 * 3_600_000, time_spent: 0 }),
    ]

    const report = buildEstimateReport(tasks)

    assert.equal(report.rows.length, 1)
    assert.equal(report.tasksWithoutEstimate, 1)
    assert.equal(report.totalRemainingMs, 2 * 3_600_000)
  })

  it('przekroczona estymacja wchodzi do sumy jako wartość ujemna, nie jako zero', () => {
    const tasks = [
      // Estymacja 3h, przepracowane 5h -> zostało -2h.
      task({ id: '1', status: 'w trakcie', time_estimate: 3 * 3_600_000, time_spent: 5 * 3_600_000 }),
      task({ id: '2', status: 'do zrobienia', time_estimate: 1 * 3_600_000, time_spent: 0 }),
    ]

    const report = buildEstimateReport(tasks)

    assert.equal(report.totalRemainingMs, -2 * 3_600_000 + 1 * 3_600_000)
    // Najbardziej przekroczone zadanie jest pierwsze.
    assert.equal(report.rows[0].taskId, '1')
    assert.equal(report.rows[0].remainingMs, -2 * 3_600_000)
  })

  it('nie liczy podzadań zagnieżdżonych w children — tylko zadania najwyższego poziomu', () => {
    const child = task({ id: '1a', status: 'do zrobienia', time_estimate: 3_600_000, time_spent: 0 })
    const parent = { ...task({ id: '1', status: 'do zrobienia', time_estimate: 3_600_000, time_spent: 0 }), children: [child] }

    const report = buildEstimateReport([parent])

    assert.equal(report.rows.length, 1)
    assert.equal(report.rows[0].taskId, '1')
  })
})
