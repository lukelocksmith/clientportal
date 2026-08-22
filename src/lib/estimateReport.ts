import type { ClickUpTask } from './types'

/**
 * Statusy liczone do "pozostałej estymacji". To jest praca jeszcze przed
 * nami: zablokowane wliczamy celowo, bo blokada nie znaczy, że estymacja
 * przestała obowiązywać, tylko że czeka na coś zewnętrznego.
 */
export const ESTIMATE_STATUSES = ['do zrobienia', 'w trakcie', 'zablokowane'] as const

export interface EstimateRow {
  taskId: string
  name: string
  status: string
  url: string
  estimateMs: number
  spentMs: number
  /** estimateMs - spentMs. Celowo może wyjść ujemne — patrz komentarz buildEstimateReport. */
  remainingMs: number
}

export interface EstimateReport {
  totalRemainingMs: number
  rows: EstimateRow[]
  tasksWithoutEstimate: number
}

/**
 * Suma "ile jeszcze zostało" dla otwartych zadań portalu.
 *
 * Świadomie NIE spłaszczamy podzadań (`task.children`): kanban też liczy tylko
 * zadania najwyższego poziomu jako karty w kolumnach, więc ta suma ma pokrywać
 * się z tym, co klient widzi na tablicy, a nie liczyć nic dodatkowego w tle.
 *
 * Zadanie bez ustawionej estymacji jest pomijane z sumy (zliczane osobno w
 * `tasksWithoutEstimate`), bo wliczenie go jako 0 zaniżałoby realne
 * obciążenie zamiast pokazać, że dane są niepełne.
 *
 * Zadanie z estymacją przekroczoną (przepracowano więcej niż estymacja)
 * wchodzi do sumy z WARTOŚCIĄ UJEMNĄ, celowo — to sygnał, że estymacja była
 * za mała, i ma być widoczny, nie ukryty przez obcięcie do zera.
 */
export function buildEstimateReport(tasks: readonly ClickUpTask[]): EstimateReport {
  const statuses: readonly string[] = ESTIMATE_STATUSES
  const rows: EstimateRow[] = []
  let tasksWithoutEstimate = 0

  for (const task of tasks) {
    if (!statuses.includes(task.status.status)) continue
    if (task.time_estimate == null) {
      tasksWithoutEstimate++
      continue
    }
    const spentMs = task.time_spent ?? 0
    rows.push({
      taskId: task.id,
      name: task.name,
      status: task.status.status,
      url: task.url,
      estimateMs: task.time_estimate,
      spentMs,
      remainingMs: task.time_estimate - spentMs,
    })
  }

  // Najbardziej przekroczone estymacje na górze — to one wymagają uwagi.
  rows.sort((a, b) => a.remainingMs - b.remainingMs)

  const totalRemainingMs = rows.reduce((sum, row) => sum + row.remainingMs, 0)

  return { totalRemainingMs, rows, tasksWithoutEstimate }
}
