import { describe, it } from 'vitest'
import assert from 'node:assert'
import { kwotaNettoGrosze, formatujZl, formatujStawke, stawkaNaGrosze } from '@/lib/money'

/**
 * Kwoty w raporcie czasu pracy.
 *
 * To sa liczby, ktore klient widzi obok faktury, wiec najwazniejsze testy nie
 * dotycza formatowania, tylko dwoch rzeczy:
 *
 *   1. BRAK STAWKI daje `null`, a nie zero i nie zgadnieta kwota. Kwota
 *      zmyslona przy fakturze jest gorsza niz jej brak.
 *   2. Suma liczona z milisekund nie moze dryfowac przez arytmetyke
 *      zmiennoprzecinkowa.
 *
 *   npx vitest run src/lib/money.test.ts
 */

const H = 60 * 60 * 1000

describe('kwotaNettoGrosze', () => {
  it('godzina po stawce 150 zl to 150 zl', () => {
    assert.strictEqual(kwotaNettoGrosze(H, 15000), 15000)
  })

  it('liczy czesci godziny', () => {
    assert.strictEqual(kwotaNettoGrosze(H / 2, 15000), 7500, 'pol godziny')
    assert.strictEqual(kwotaNettoGrosze(H / 4, 15000), 3750, 'kwadrans')
  })

  it('10h 14m po 140 zl liczy sie dokladnie', () => {
    // Prawdziwy przypadek z raportu Lukasza: „Łącznie 10h 14m", stawka WDF 140.
    // 10h14m = 10,2333h -> 1432,666... zl -> 1432,67 zl po zaokragleniu grosza.
    const ms = 10 * H + 14 * 60 * 1000
    assert.strictEqual(kwotaNettoGrosze(ms, 14000), 143267)
  })

  it('BRAK STAWKI daje null, nie zero', () => {
    // Zero wygladaloby jak „praca za darmo", a null pozwala pokazac same godziny.
    assert.strictEqual(kwotaNettoGrosze(H, null), null)
  })

  it('zerowy i ujemny czas daje 0, nie ujemna kwote', () => {
    assert.strictEqual(kwotaNettoGrosze(0, 15000), 0)
    assert.strictEqual(kwotaNettoGrosze(-1000, 15000), 0)
  })

  it('nie dryfuje przy sumowaniu wielu pozycji', () => {
    // Sedno liczenia na liczbach calkowitych: 3 x 20 minut ma dac dokladnie
    // tyle, co jedna godzina, a nie 149,99 albo 150,01.
    const dwadziescia = 20 * 60 * 1000
    const suma = [1, 2, 3].reduce(acc => acc + (kwotaNettoGrosze(dwadziescia, 15000) ?? 0), 0)
    assert.strictEqual(suma, kwotaNettoGrosze(H, 15000))
  })
})

describe('formatujZl', () => {
  it('zawsze dwa miejsca po przecinku', () => {
    assert.match(formatujZl(15000), /^150,00\s*zł$/)
    assert.match(formatujZl(143267), /^1\s*432,67\s*zł$/)
  })

  it('zero jest kwota, nie pustka', () => {
    assert.match(formatujZl(0), /^0,00\s*zł$/)
  })
})

describe('formatujStawke', () => {
  it('okragla stawka bez koncowki groszowej', () => {
    // Podpis pomocniczy, ma sie czytac jednym rzutem oka.
    assert.match(formatujStawke(14000), /^140\s*zł\/h$/)
  })

  it('nieokragla stawka z groszami', () => {
    assert.match(formatujStawke(14050), /^140,50\s*zł\/h$/)
  })
})

describe('stawkaNaGrosze', () => {
  it('przyjmuje liczbe i tekst', () => {
    assert.strictEqual(stawkaNaGrosze(140), 14000)
    assert.strictEqual(stawkaNaGrosze('140'), 14000)
  })

  it('przyjmuje polski przecinek dziesietny', () => {
    // Z formularza „140,50" jest naturalne; bez tego Number() dalby NaN.
    assert.strictEqual(stawkaNaGrosze('140,50'), 14050)
    assert.strictEqual(stawkaNaGrosze('140.50'), 14050)
  })

  it('znosi spacje w liczbie', () => {
    assert.strictEqual(stawkaNaGrosze('1 400'), 140000)
  })

  it('pusta wartosc znaczy WYCZYSC stawke, nie blad', () => {
    // Inaczej nie dalo by sie cofnac raz wpisanej stawki.
    assert.strictEqual(stawkaNaGrosze(null), null)
    assert.strictEqual(stawkaNaGrosze(''), null)
    assert.strictEqual(stawkaNaGrosze('   '), null)
  })

  it('odrzuca wartosci, ktore zamienilyby raport w bzdure', () => {
    assert.strictEqual(stawkaNaGrosze('-50'), null, 'ujemna stawka')
    assert.strictEqual(stawkaNaGrosze('abc'), null)
    assert.strictEqual(stawkaNaGrosze({}), null)
  })
})
