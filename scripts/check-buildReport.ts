/**
 * Weryfikacja agregacji wpisów czasu. Uruchomienie:
 *   npx tsx scripts/check-buildReport.ts
 */
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { buildReport, listPeriods } from '../src/lib/timeReports'
import type { ClickUpTimeEntry } from '../src/lib/types'

const entries: ClickUpTimeEntry[] = JSON.parse(
  readFileSync(join(import.meta.dirname, 'fixtures/onyx-time-entries-2026-W29.json'), 'utf8')
)

const period = listPeriods('tydzien', 1, new Date('2026-07-26T12:00:00+02:00'))[0]
const report = buildReport(period, entries)

// Suma liczona ze wszystkich dodatnich wpisów przypiętych do zadania:
// 7500000 + 3540000 + 2880000 + 60000 + 30000 = 14010000 ms
assert.equal(report.totalMs, 14010000)

// Wiersze: trzy zadania powyżej minuty, malejąco. Zadanie z 30 sekundami
// wypada z listy, bo formatDuration zwróciłoby dla niego pusty string.
assert.equal(report.rows.length, 3)
assert.deepEqual(
  report.rows.map(r => [r.taskId, r.durationMs]),
  [
    ['869dyb6yg', 7500000],
    ['869dxx111', 3600000], // 3540000 + 60000, dwa wpisy tego samego zadania
    ['869dxx222', 2880000],
  ]
)
assert.equal(report.rows[0].taskName, '[onyx] Warianty z baselinker - Wielowariantowość')
assert.equal(report.rows[0].status, 'w trakcie')

// Uruchomiony stoper i wpis bez zadania nie wchodzą nigdzie.
assert.ok(!report.rows.some(r => r.taskId === '869dxx444'), 'uruchomiony stoper odrzucony')
assert.ok(!report.rows.some(r => r.taskName.includes('poniżej minuty')), 'wiersz poniżej minuty odrzucony')

// Okres jest przepisany do wyniku bez zmian.
assert.equal(report.period.key, '2026-W29')

// Pusta lista wpisów to poprawny stan, nie błąd.
const empty = buildReport(period, [])
assert.equal(empty.totalMs, 0)
assert.equal(empty.rows.length, 0)

console.log('check-buildReport: OK')
