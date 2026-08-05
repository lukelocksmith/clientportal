/**
 * Formatowanie daty pokazywanej klientowi.
 *
 *   npm test
 */
import { describe, it } from 'vitest'
import assert from 'node:assert'
import { formatDate, getStatusColor, STATUS_COLORS, STATUS_COLUMNS } from '@/lib/utils'

/** ClickUp podaje daty jako milisekundy w łańcuchu znaków. */
const ms = (iso: string) => String(new Date(iso).getTime())

const TERAZ = new Date('2026-07-30T12:00:00Z')

describe('formatDate', () => {
  it('rok pokazuje sie tylko wtedy, gdy jest inny niz biezacy', () => {
    // Bez roku data z zeszlego roku czytana dzis znaczy cos innego, niz znaczy.
    const stara = formatDate(ms('2025-11-06T13:48:00Z'), TERAZ)
    assert.ok(stara.includes('2025'), `data z innego roku musi miec rok, bylo: ${stara}`)

    // W biezacym roku rok jest szumem, bo i tak wiadomo.
    const biezaca = formatDate(ms('2026-07-06T10:00:00Z'), TERAZ)
    assert.ok(!biezaca.includes('2026'), `data z biezacego roku nie potrzebuje roku, bylo: ${biezaca}`)

    // Rok w przyszlosci tez sie liczy: termin na styczen nastepnego roku bez
    // roku wygladalby jak termin, ktory juz minal.
    const przyszla = formatDate(ms('2027-01-15T10:00:00Z'), TERAZ)
    assert.ok(przyszla.includes('2027'), `data z przyszlego roku musi miec rok, bylo: ${przyszla}`)
  })

  it('dzien i miesiac sa zawsze', () => {
    const out = formatDate(ms('2026-07-06T10:00:00Z'), TERAZ)
    assert.ok(out.includes('6'), `brak dnia: ${out}`)
    assert.ok(/lip/i.test(out), `brak miesiaca: ${out}`)
  })

  it('brak daty i smieci nie wywalaja widoku', () => {
    // Te wartosci trafiaja tu z ClickUpa i z indeksu, wiec pusty ciag jest
    // jedyna bezpieczna odpowiedzia: pole po prostu sie nie pokazuje.
    assert.strictEqual(formatDate(null), '')
    assert.strictEqual(formatDate(undefined), '')
    assert.strictEqual(formatDate(''), '')
    assert.strictEqual(formatDate('nie liczba', TERAZ), '')
  })
})

/**
 * Statusy kanbana kontra kolory statusow.
 *
 * 2026-08-05 te dwie listy rozjechaly sie ze soba i z ClickUpem: status
 * "zrobione" przemianowano na "weryfikacja" i doszedl "przeglad", a portal
 * dalej znal stare nazwy. Zadania spoza znanej listy wpadaja w kanbanie do
 * kolumny "backlog", wiec awaria byla cicha: klient widzial 53 zrobione
 * zadania jako niezaczete, a kolumna "zrobione" stala pusta.
 *
 * Ten test nie widzi ClickUpa i nie sprawdzi, czy nazwy zgadzaja sie
 * z przestrzenia. Pilnuje tanszej rzeczy: zeby kolumna nigdy nie istniala
 * bez wlasnego koloru, czyli zeby dodanie statusu w jednym miejscu i
 * zapomnienie o drugim przestalo byc mozliwe po cichu.
 */
describe('STATUS_COLUMNS kontra STATUS_COLORS', () => {
  it('kazda kolumna kanbana ma wpis w STATUS_COLORS', () => {
    // Sprawdzamy OBECNOSC KLUCZA, nie zwrocony kolor. Kolor awaryjny jest
    // rowny kolorowi backlogu, wiec porownanie wartosci przepuscilo by
    // backlog bez wpisu i test nie lapalby tego, po co istnieje.
    for (const status of STATUS_COLUMNS) {
      assert.ok(
        Object.hasOwn(STATUS_COLORS, status),
        `status "${status}" jest kolumna kanbana, ale nie ma koloru w STATUS_COLORS`
      )
    }
  })

  it('nieznany status dostaje kolor awaryjny, nie undefined', () => {
    // Statusy przychodza z ClickUpa i z lustra w bazie, wiec nieznana wartosc
    // jest kwestia czasu. Musi dac kolor, ktory da sie wstawic w style.
    assert.match(getStatusColor('status ktorego nie ma'), /^#[0-9a-f]{6}$/i)
  })

  it('kolejnosc kolumn idzie od backlogu do zamknietych', () => {
    // Kolejnosc odwzorowuje orderindex przestrzeni ClickUp. Klient czyta
    // tablice od lewej, wiec przestawienie tych dwoch skrajnych kolumn
    // zmienia znaczenie calego widoku.
    assert.strictEqual(STATUS_COLUMNS[0], 'backlog')
    assert.strictEqual(STATUS_COLUMNS[STATUS_COLUMNS.length - 1], 'zamknięte')
  })

  it('nie ma duplikatow', () => {
    // Duplikat rozbilby zadania jednego statusu na dwie kolumny, z ktorych
    // druga zawsze byla by pusta.
    assert.strictEqual(new Set(STATUS_COLUMNS).size, STATUS_COLUMNS.length)
  })
})
