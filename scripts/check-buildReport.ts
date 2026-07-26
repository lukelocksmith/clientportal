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

// Czas każdego zadania zaokrąglony do pełnych minut, taskMs to suma tych
// zaokrąglonych wartości: 125 + 60 + 48 + 1 = 234 min.
// Zadanie z dokładnie 30 sekundami idzie w górę do minuty, bo Math.round(0.5)
// daje 1, tak samo jak w formatDuration. Dopiero poniżej 30 sekund zadanie
// zaokrągla się do zera i wypada zupełnie, także z sumy.
assert.equal(report.taskMs, 234 * 60_000)

// Narzut: 10% z 234 min to 23,4 min, obcięte w dół do 23 min.
assert.equal(report.overheadMs, 23 * 60_000)
assert.equal(report.totalMs, (234 + 23) * 60_000)

// Wiersze: cztery zadania malejąco, a na końcu narzut.
assert.equal(report.rows.length, 5)
assert.deepEqual(
  report.rows.map(r => [r.taskId, r.durationMs / 60_000]),
  [
    ['869dyb6yg', 125],
    ['869dxx111', 60], // 59 min + 1 min, dwa wpisy tego samego zadania
    ['869dxx222', 48],
    ['869dxx333', 1], // 30 sekund w górę do minuty
    ['overhead', 23],
  ]
)

/**
 * Najważniejsza asercja tego pliku: suma tego, co klient widzi w kolumnie
 * Czas, musi równać się liczbie pokazanej jako Łącznie. Bez kwantyzacji do
 * pełnych minut u źródła rozjeżdżało się to na prawdziwych danych.
 */
const naEkranie = report.rows.reduce((sum, r) => sum + r.durationMs, 0)
assert.equal(naEkranie, report.totalMs, 'wiersze na ekranie muszą sumować się do Łącznie')

// Narzut jest zawsze ostatni, poza sortowaniem po czasie, i oznaczony.
const last = report.rows[report.rows.length - 1]
assert.equal(last.isOverhead, true)
// Status musi być prawdziwym statusem przestrzeni ClickUp, żeby wiersz
// wyglądał jak każdy inny i dostał kolor z getStatusColor.
assert.equal(last.status, 'zrobione')
assert.ok(last.taskName.startsWith('Organizacja pracy i komunikacja'))
assert.ok(!report.rows.slice(0, -1).some(r => r.isOverhead))
assert.equal(report.rows[0].taskName, '[onyx] Warianty z baselinker - Wielowariantowość')
assert.equal(report.rows[0].status, 'w trakcie')

// Uruchomiony stoper i wpis bez zadania nie wchodzą nigdzie.
assert.ok(!report.rows.some(r => r.taskId === '869dxx444'), 'uruchomiony stoper odrzucony')
assert.equal(report.rows.length, 5, 'wpis bez zadania nie tworzy wiersza')

// Zadanie krótsze niż 30 sekund wypada zupełnie, także z sumy.
const podSekunde = buildReport(period, [
  {
    id: 'k1',
    duration: String(10 * 60_000),
    start: '0',
    end: '0',
    task: { id: 'duze', name: 'Duze zadanie', status: { status: 'zrobione' } },
    task_location: { list_id: 'l', folder_id: 'f', space_id: 's' },
  },
  {
    id: 'k2',
    duration: '12000', // 12 sekund
    start: '0',
    end: '0',
    task: { id: 'male', name: 'Dwanascie sekund', status: { status: 'zrobione' } },
    task_location: { list_id: 'l', folder_id: 'f', space_id: 's' },
  },
])
assert.equal(podSekunde.taskMs, 10 * 60_000, 'zadanie 12-sekundowe nie wchodzi do sumy')
assert.ok(!podSekunde.rows.some(r => r.taskId === 'male'))
assert.equal(
  podSekunde.rows.reduce((s, r) => s + r.durationMs, 0),
  podSekunde.totalMs,
  'ekran nadal sumuje się do Łącznie'
)

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
