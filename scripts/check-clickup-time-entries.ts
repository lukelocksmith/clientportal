/**
 * Weryfikacja na żywo, wymaga .env.local z CLICKUP_API_TOKEN i CLICKUP_TEAM_ID.
 *   npx tsx scripts/check-clickup-time-entries.ts
 *
 * Punkt odniesienia: folder Onyx, tydzień 13-19 lipca 2026, suma 3h 52m.
 * Wartość może się zmienić, jeśli ktoś dopisze czas wstecz w tym tygodniu.
 *
 * Dwie rzeczy wymuszone przez środowisko:
 * 1. Całość w main(), bo projekt nie jest ESM i tsx kompiluje do CJS,
 *    gdzie top-level await nie przechodzi.
 * 2. clickup.ts ładowany dynamicznie, PO dotenv. Statyczne importy są
 *    hoistowane nad wywołanie dotenv.config(), a clickup.ts czyta
 *    CLICKUP_API_TOKEN w ciele modułu, więc dostałby undefined i ClickUp
 *    zwróciłby 401 "Oauth token not found".
 */
import dotenv from 'dotenv'
dotenv.config({ path: '.env.local' })

import assert from 'node:assert/strict'
import { buildReport, parsePeriodKey } from '../src/lib/timeReports'
import { formatDuration } from '../src/lib/utils'

const ONYX_FOLDER = '90129337912'

async function main() {
  const { getTimeEntries, getWorkspaceMemberIds } = await import('../src/lib/clickup')

  const members = await getWorkspaceMemberIds()
  assert.ok(members.length >= 5, `spodziewane co najmniej 5 osób w workspace, jest ${members.length}`)

  const period = parsePeriodKey('tydzien', '2026-W29', new Date('2026-07-26T12:00:00+02:00'))
  assert.ok(period, 'okres 2026-W29 ma być zamknięty i poprawny')

  const entries = await getTimeEntries(ONYX_FOLDER, period.startMs, period.endMs)
  const report = buildReport(period, entries)

  console.log(`okres:        ${report.period.label}`)
  console.log(`czas zadań:   ${formatDuration(report.taskMs)}`)
  console.log(`organizacja:  ${formatDuration(report.overheadMs)}`)
  console.log(`razem:        ${formatDuration(report.totalMs)}`)
  for (const row of report.rows) {
    const tag = row.isOverhead ? '[10%]' : `[${row.status}]`
    console.log(`  ${formatDuration(row.durationMs).padStart(8)}  ${tag}  ${row.taskName.slice(0, 60)}`)
  }

  assert.ok(report.rows.length > 0, 'spodziewane wpisy czasu w tym tygodniu')
  // 3h 52m to 232 min, narzut 10% obcięty w dół daje 23 min, razem 255 min.
  assert.equal(formatDuration(report.taskMs), '3h 52m')
  assert.equal(formatDuration(report.overheadMs), '23m')
  assert.equal(formatDuration(report.totalMs), '4h 15m')

  // Izolacja klienta: każdy wpis ma pochodzić z folderu, o który pytaliśmy.
  for (const entry of entries) {
    if (!entry.task_location?.folder_id) continue
    assert.equal(entry.task_location.folder_id, ONYX_FOLDER, 'wpis z obcego folderu')
  }

  console.log('check-clickup-time-entries: OK')
}

main().catch(error => {
  console.error(error)
  process.exit(1)
})
