import { describe, it, expect } from 'vitest'
import { reportingHealth, CRON_LIMITS_MINUTES, QUEUE_LIMIT_MINUTES } from './healthReporting'

const teraz = new Date('2026-08-31T12:00:00Z')
const minutTemu = (n: number) => new Date(teraz.getTime() - n * 60_000)

const zdrowe = {
  lastRuns: {
    'pending-reports': minutTemu(2),
    'panic-escalation': minutTemu(4),
    'task-index': minutTemu(300),
  },
  pending: 0,
  oldestPendingMinutes: null,
  now: teraz,
}

describe('werdykt o drodze zgłoszeń', () => {
  it('wszystko chodzi — słowo OK dla czujnika', () => {
    const w = reportingHealth(zdrowe)
    expect(w.ok).toBe(true)
    expect(w.line.startsWith('OK')).toBe(true)
  })

  it('milczący cron dowożenia to problem, choć nikt nie zgłosił błędu', () => {
    // To jest przypadek, dla którego ten moduł istnieje: cron, który przestał
    // być wołany, nie wysyła żadnego alarmu, bo się nie wykonuje.
    const w = reportingHealth({
      ...zdrowe,
      lastRuns: { ...zdrowe.lastRuns, 'pending-reports': minutTemu(CRON_LIMITS_MINUTES['pending-reports'] + 1) },
    })
    expect(w.ok).toBe(false)
    expect(w.line).toMatch(/pending-reports/)
  })

  it('cron eskalacji ma węższą granicę niż indeks Historii', () => {
    expect(CRON_LIMITS_MINUTES['panic-escalation']).toBeLessThan(CRON_LIMITS_MINUTES['task-index'])
  })

  it('cron, który nigdy nie chodził, nie udaje zdrowego', () => {
    const w = reportingHealth({ ...zdrowe, lastRuns: { ...zdrowe.lastRuns, 'panic-escalation': null } })
    expect(w.ok).toBe(false)
    expect(w.line).toMatch(/ani jednego przebiegu/)
  })

  it('brak klucza w wejściu traktujemy jak brak przebiegu, nie jak zdrowie', () => {
    const w = reportingHealth({ ...zdrowe, lastRuns: {} })
    expect(w.problems).toHaveLength(3)
  })

  it('zgłoszenie stojące w kolejce dłużej niż limit to awaria', () => {
    const w = reportingHealth({ ...zdrowe, pending: 2, oldestPendingMinutes: QUEUE_LIMIT_MINUTES + 5 })
    expect(w.ok).toBe(false)
    expect(w.line).toMatch(/kolejka zgłoszeń/)
  })

  it('świeże zgłoszenie w kolejce to jeszcze nie awaria', () => {
    const w = reportingHealth({ ...zdrowe, pending: 1, oldestPendingMinutes: 1 })
    expect(w.ok).toBe(true)
  })
})
