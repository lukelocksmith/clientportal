/**
 * Weryfikacja logiki okresów raportowych. Uruchomienie:
 *   npx tsx scripts/check-timeReports.ts
 * Kończy się kodem 1 przy pierwszej nieudanej asercji.
 *
 * Wartości oczekiwane policzone niezależnie dla strefy Europe/Warsaw.
 */
import assert from 'node:assert/strict'
import { listPeriods, parsePeriodKey, shiftPeriod } from '../src/lib/timeReports'

const H = 3_600_000

// Punkt odniesienia: niedziela 26 lipca 2026. Bieżący tydzień to 20-26 lipca,
// więc ostatni zamknięty to 13-19 lipca.
const ref = new Date('2026-07-26T12:00:00+02:00')

{
  const weeks = listPeriods('tydzien', 12, ref)
  assert.equal(weeks.length, 12)
  assert.equal(weeks[0].key, '2026-W29')
  assert.equal(weeks[0].startMs, 1783893600000)
  assert.equal(weeks[0].endMs, 1784498399999)
  assert.equal(weeks[0].label, '13-19 lipca 2026 (tyg. 29)')
  assert.equal(weeks[1].key, '2026-W28')
  // Bieżący tydzień nie pojawia się na liście.
  assert.ok(!weeks.some(w => w.key === '2026-W30'))
}

{
  const months = listPeriods('miesiac', 12, ref)
  assert.equal(months[0].key, '2026-06')
  assert.equal(months[0].startMs, 1780264800000)
  assert.equal(months[0].endMs, 1782856799999)
  assert.equal(months[0].label, 'czerwiec 2026')
  assert.ok(!months.some(m => m.key === '2026-07'))
}

{
  // Przełom roku: 2026 ma 53 tygodnie ISO, więc ostatni zamknięty tydzień
  // na 4 stycznia 2027 to 2026-W53, nie 2027-W01.
  const weeks = listPeriods('tydzien', 3, new Date('2027-01-04T09:00:00+01:00'))
  assert.equal(weeks[0].key, '2026-W53')
  assert.equal(weeks[0].startMs, 1798412400000)
  assert.equal(weeks[0].endMs, 1799017199999)
}

{
  // Zmiana czasu na letni w nocy 28/29 marca 2026: ten tydzień ma 167 godzin.
  // Implementacja licząca granice w UTC da równe 168 i tu polegnie.
  const weeks = listPeriods('tydzien', 1, new Date('2026-04-01T09:00:00+02:00'))
  assert.equal(weeks[0].key, '2026-W13')
  assert.equal(weeks[0].startMs, 1774220400000)
  assert.equal(weeks[0].endMs, 1774821599999)
  const hours = (weeks[0].endMs - weeks[0].startMs + 1) / H
  assert.equal(hours, 167, `tydzień DST ma mieć 167h, jest ${hours}`)
}

{
  // Powrót z czasu letniego 25 października 2026: tydzień 26.10-1.11 ma 168h,
  // a tydzień 19-25.10 ma 169h.
  const weeks = listPeriods('tydzien', 2, new Date('2026-11-02T09:00:00+01:00'))
  assert.equal(weeks[0].key, '2026-W44')
  assert.equal(weeks[0].startMs, 1792969200000)
  assert.equal((weeks[1].endMs - weeks[1].startMs + 1) / H, 169)
}

{
  // Etykieta tygodnia przechodzącego między miesiącami.
  const weeks = listPeriods('tydzien', 1, new Date('2026-07-08T09:00:00+02:00'))
  assert.equal(weeks[0].label, '29 cze - 5 lip 2026 (tyg. 27)')
}

{
  // parsePeriodKey przyjmuje zamknięty okres i odrzuca wszystko inne.
  assert.equal(parsePeriodKey('tydzien', '2026-W29', ref)?.startMs, 1783893600000)
  assert.equal(parsePeriodKey('tydzien', '2026-W30', ref), null, 'bieżący tydzień odrzucony')
  assert.equal(parsePeriodKey('tydzien', '2026-W40', ref), null, 'przyszły tydzień odrzucony')
  assert.equal(parsePeriodKey('tydzien', '2027-W53', ref), null, '2027 nie ma 53 tygodni')
  assert.equal(parsePeriodKey('tydzien', 'bzdura', ref), null)
  assert.equal(parsePeriodKey('tydzien', '2026-W00', ref), null)
  assert.equal(parsePeriodKey('miesiac', '2026-06', ref)?.key, '2026-06')
  assert.equal(parsePeriodKey('miesiac', '2026-07', ref), null, 'bieżący miesiąc odrzucony')
  assert.equal(parsePeriodKey('miesiac', '2026-13', ref), null)
}

{
  // shiftPeriod: -1 to starszy okres, +1 to nowszy. Nowszy niż ostatni
  // zamknięty nie istnieje, więc strzałka w prawo ma się wyłączyć.
  const last = listPeriods('tydzien', 1, ref)[0]
  assert.equal(shiftPeriod(last, -1, ref)?.key, '2026-W28')
  assert.equal(shiftPeriod(last, 1, ref), null)
  const older = parsePeriodKey('tydzien', '2026-W20', ref)!
  assert.equal(shiftPeriod(older, 1, ref)?.key, '2026-W21')
  const lastMonth = listPeriods('miesiac', 1, ref)[0]
  assert.equal(shiftPeriod(lastMonth, -1, ref)?.key, '2026-05')
  assert.equal(shiftPeriod(lastMonth, 1, ref), null)
}

console.log('check-timeReports: OK')
