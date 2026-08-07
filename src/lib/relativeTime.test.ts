import { describe, it } from 'vitest'
import assert from 'node:assert'
import { relativeTime, exactTime } from './relativeTime'

/**
 * Czas względny na liście powiadomień.
 *
 * Polska odmiana liczebników ma trzy formy i wyjątek na 12-14, więc to nie
 * jest miejsce na „pewnie zadziała". Błąd tutaj nie wywala niczego — po prostu
 * portal odzywa się do klienta niepoprawną polszczyzną przy każdym
 * powiadomieniu.
 *
 *   npx vitest run src/lib/relativeTime.test.ts
 */
const TERAZ = new Date('2026-08-07T12:00:00.000Z')

/** Chwila `ile` sekund przed TERAZ. */
const przed = (ile: number) => new Date(TERAZ.getTime() - ile * 1000).toISOString()

const SEKUNDA = 1
const MINUTA = 60
const GODZINA = 60 * MINUTA
const DZIEN = 24 * GODZINA

describe('relativeTime', () => {
  it('poniżej minuty to „przed chwilą", bez liczby', () => {
    assert.strictEqual(relativeTime(przed(5), TERAZ), 'przed chwilą')
    assert.strictEqual(relativeTime(przed(59), TERAZ), 'przed chwilą')
  })

  it('odmienia MINUTY przez wszystkie trzy formy', () => {
    assert.strictEqual(relativeTime(przed(1 * MINUTA), TERAZ), '1 minutę temu')
    assert.strictEqual(relativeTime(przed(2 * MINUTA), TERAZ), '2 minuty temu')
    assert.strictEqual(relativeTime(przed(5 * MINUTA), TERAZ), '5 minut temu')
    assert.strictEqual(relativeTime(przed(22 * MINUTA), TERAZ), '22 minuty temu')
  })

  it('WYJĄTEK 12-14 bierze formę mnogą, mimo końcówki 2-4', () => {
    // To jest ten przypadek, który „pewnie zadziała" zwykle psuje:
    // 12 wygląda jak 2, a odmienia się jak 5.
    assert.strictEqual(relativeTime(przed(12 * MINUTA), TERAZ), '12 minut temu')
    assert.strictEqual(relativeTime(przed(13 * MINUTA), TERAZ), '13 minut temu')
    assert.strictEqual(relativeTime(przed(14 * MINUTA), TERAZ), '14 minut temu')
  })

  it('odmienia GODZINY', () => {
    assert.strictEqual(relativeTime(przed(1 * GODZINA), TERAZ), '1 godzinę temu')
    assert.strictEqual(relativeTime(przed(3 * GODZINA), TERAZ), '3 godziny temu')
    assert.strictEqual(relativeTime(przed(8 * GODZINA), TERAZ), '8 godzin temu')
    assert.strictEqual(relativeTime(przed(23 * GODZINA), TERAZ), '23 godziny temu')
  })

  it('jeden dzień to „wczoraj", nie „1 dzień temu"', () => {
    assert.strictEqual(relativeTime(przed(1 * DZIEN), TERAZ), 'wczoraj')
    assert.strictEqual(relativeTime(przed(1 * DZIEN + 5 * GODZINA), TERAZ), 'wczoraj')
  })

  it('dni od 2 do 6 liczone wprost', () => {
    assert.strictEqual(relativeTime(przed(2 * DZIEN), TERAZ), '2 dni temu')
    assert.strictEqual(relativeTime(przed(6 * DZIEN), TERAZ), '6 dni temu')
  })

  it('powyżej tygodnia wraca ZWYKŁA data', () => {
    // Po tygodniu czas względny przestaje pomagać: „23 dni temu" wymaga tego
    // samego liczenia co data, tylko w drugą stronę.
    const wynik = relativeTime(przed(30 * DZIEN), TERAZ)
    assert.match(wynik, /lip/, 'miesiąc słownie')
    assert.ok(!wynik.includes('temu'))
  })

  it('data z innego roku niesie rok', () => {
    assert.match(relativeTime('2024-03-15T10:00:00.000Z', TERAZ), /2024/)
  })

  it('data z TEGO roku roku NIE niesie', () => {
    assert.ok(!relativeTime(przed(30 * DZIEN), TERAZ).includes('2026'))
  })

  it('chwila z PRZYSZŁOŚCI to „przed chwilą", nie „za 3 minuty"', () => {
    // Zegary serwera i przeglądarki potrafią się rozjechać o kilka sekund.
    // Powiadomienie o czymś, co się jeszcze nie stało, wygląda jak awaria.
    assert.strictEqual(relativeTime(przed(-180 * SEKUNDA), TERAZ), 'przed chwilą')
  })

  it('popsuta data daje pusty ciąg, nie „Invalid Date"', () => {
    assert.strictEqual(relativeTime('to nie jest data', TERAZ), '')
    assert.strictEqual(relativeTime('', TERAZ), '')
  })
})

describe('exactTime', () => {
  it('podaje date i godzine', () => {
    const wynik = exactTime('2026-08-07T09:30:00.000Z')
    assert.match(wynik, /07\.08\.2026/)
    assert.match(wynik, /\d{2}:\d{2}/)
  })

  it('popsuta data daje pusty ciąg', () => {
    assert.strictEqual(exactTime('cokolwiek'), '')
  })
})
