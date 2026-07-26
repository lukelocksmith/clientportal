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

// Czas zadań ze wszystkich dodatnich wpisów przypiętych do zadania:
// 7500000 + 3540000 + 2880000 + 60000 + 30000 = 14010000 ms = 233,5 min
assert.equal(report.taskMs, 14010000)

// Narzut: 10% z 233,5 min to 23,35 min, obcięte w dół do 23 min.
assert.equal(report.overheadMs, 23 * 60_000)
assert.equal(report.totalMs, 14010000 + 23 * 60_000)

// Wiersze: trzy zadania powyżej minuty malejąco, a na końcu narzut.
// Zadanie z 30 sekundami wypada z listy, bo formatDuration zwróciłoby
// dla niego pusty string.
assert.equal(report.rows.length, 4)
assert.deepEqual(
  report.rows.map(r => [r.taskId, r.durationMs]),
  [
    ['869dyb6yg', 7500000],
    ['869dxx111', 3600000], // 3540000 + 60000, dwa wpisy tego samego zadania
    ['869dxx222', 2880000],
    ['overhead', 23 * 60_000],
  ]
)

// Narzut jest zawsze ostatni, poza sortowaniem po czasie, i oznaczony.
const last = report.rows[report.rows.length - 1]
assert.equal(last.isOverhead, true)
assert.equal(last.status, '')
assert.ok(last.taskName.startsWith('Organizacja pracy i komunikacja'))
assert.ok(!report.rows.slice(0, -1).some(r => r.isOverhead))
assert.equal(report.rows[0].taskName, '[onyx] Warianty z baselinker - Wielowariantowość')
assert.equal(report.rows[0].status, 'w trakcie')

// Uruchomiony stoper i wpis bez zadania nie wchodzą nigdzie.
assert.ok(!report.rows.some(r => r.taskId === '869dxx444'), 'uruchomiony stoper odrzucony')
assert.ok(!report.rows.some(r => r.taskName.includes('poniżej minuty')), 'wiersz poniżej minuty odrzucony')

// Okres jest przepisany do wyniku bez zmian.
assert.equal(report.period.key, '2026-W29')

// Pusta lista wpisów to poprawny stan, nie błąd. Bez czasu nie ma narzutu.
const empty = buildReport(period, [])
assert.equal(empty.taskMs, 0)
assert.equal(empty.overheadMs, 0)
assert.equal(empty.totalMs, 0)
assert.equal(empty.rows.length, 0)

// Narzut poniżej minuty nie dostaje własnego wiersza, ale nadal wchodzi
// do sumy jako zero, więc suma równa się czasowi zadań.
const tiny = buildReport(period, [
  {
    id: 't1',
    duration: String(5 * 60_000), // 5 min, narzut 0,5 min
    start: '0',
    end: '0',
    task: { id: 'x', name: 'Male zadanie', status: { status: 'zrobione' } },
    task_location: { list_id: 'l', folder_id: 'f', space_id: 's' },
  },
])
assert.equal(tiny.overheadMs, 0)
assert.equal(tiny.totalMs, 5 * 60_000)
assert.equal(tiny.rows.length, 1)
assert.ok(!tiny.rows.some(r => r.isOverhead))

/**
 * Zgodność z generatorem raportów w CRM (Notion, baza "płatnosći important").
 * Wartości odczytane z prawdziwych raportów za czerwiec 2026. Jeśli ten blok
 * przestanie przechodzić, to znaczy że portal rozjechał się z fakturami.
 */
const notionCzerwiec2026: Array<[string, number, number]> = [
  // [projekt, czas zadań w minutach, narzut w minutach z raportu Notion]
  ['Instytut TUS', 990, 99],
  ['Onyx', 1237, 123],
  ['WDF', 8258, 825],
  ['Elko Kazanow', 485, 48],
  ['IGTSF', 97, 9],
]
for (const [projekt, taskMin, overheadMin] of notionCzerwiec2026) {
  const r = buildReport(period, [
    {
      id: 'e',
      duration: String(taskMin * 60_000),
      start: '0',
      end: '0',
      task: { id: 'agg', name: 'Suma zadan', status: { status: 'w trakcie' } },
      task_location: { list_id: 'l', folder_id: 'f', space_id: 's' },
    },
  ])
  assert.equal(
    r.overheadMs / 60_000,
    overheadMin,
    `${projekt}: narzut ma byc ${overheadMin} min, jest ${r.overheadMs / 60_000}`
  )
  assert.equal(r.totalMs / 60_000, taskMin + overheadMin, `${projekt}: suma`)
}

console.log('check-buildReport: OK')
