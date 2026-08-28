/**
 * Formatowanie daty pokazywanej klientowi.
 *
 *   npm test
 */
import { describe, it } from 'vitest'
import assert from 'node:assert'
import { formatDate, formatDateRange, getStatusColor, isAwaria, isOverdue, sortOldestFirst, STATUS_COLORS, STATUS_COLUMNS } from '@/lib/utils'

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

describe('formatDateRange', () => {
  it('ten sam miesiac skraca sie do jednego miesiaca', () => {
    // Powtorzony miesiac zabiera miejsce, ktorego wiersz plakietek na karcie
    // nie ma: przy pelnym zestawie metadanych linia zawija sie na dwie.
    const out = formatDateRange(ms('2026-07-26T08:00:00Z'), ms('2026-07-28T08:00:00Z'), TERAZ)
    assert.strictEqual(out.match(/lip/g)?.length, 1, `miesiac ma byc raz, bylo: ${out}`)
    assert.ok(out.startsWith('26'), `zakres zaczyna sie dniem startu, bylo: ${out}`)
    assert.ok(out.includes('28'), `brak dnia terminu: ${out}`)
  })

  it('roznych miesiecy nie skraca', () => {
    const out = formatDateRange(ms('2026-07-26T08:00:00Z'), ms('2026-08-03T08:00:00Z'), TERAZ)
    assert.ok(/lip/.test(out) && /sie/.test(out), `oba miesiace musza zostac, bylo: ${out}`)
  })

  it('rozne lata zostaja w calosci, mimo tego samego miesiaca', () => {
    // Ta sama nazwa miesiaca w dwoch latach to pulapka skracania: „28-4 sty"
    // ukrywa, ze termin jest w nastepnym roku.
    const out = formatDateRange(ms('2026-01-28T08:00:00Z'), ms('2027-01-04T08:00:00Z'), TERAZ)
    assert.ok(out.includes('2027'), `rok terminu musi zostac, bylo: ${out}`)
    assert.strictEqual(out.match(/sty/g)?.length, 2, `oba miesiace zostaja, bylo: ${out}`)
  })

  it('sam termin daje date, sam start daje „od"', () => {
    const tylkoTermin = formatDateRange(null, ms('2026-07-28T08:00:00Z'), TERAZ)
    assert.strictEqual(tylkoTermin, formatDate(ms('2026-07-28T08:00:00Z'), TERAZ))

    const tylkoStart = formatDateRange(ms('2026-07-26T08:00:00Z'), null, TERAZ)
    assert.ok(tylkoStart.startsWith('od '), `start bez terminu nie moze czytac sie jak deadline, bylo: ${tylkoStart}`)
  })

  it('brak obu dat i smieci daja pusty ciag', () => {
    assert.strictEqual(formatDateRange(null, null, TERAZ), '')
    assert.strictEqual(formatDateRange('nie liczba', 'tez nie', TERAZ), '')
  })
})

describe('isOverdue', () => {
  it('termin dzisiejszy NIE jest spozniony, choc godzina minela', () => {
    // Termin dotyczy dnia. Czerwien od poludnia w dniu terminu mowilaby
    // klientowi, ze jestesmy spoznieni, kiedy nie jestesmy.
    assert.strictEqual(isOverdue(ms('2026-07-30T09:00:00Z'), 'open', TERAZ), false)
  })

  it('wczorajszy termin jest spozniony', () => {
    assert.strictEqual(isOverdue(ms('2026-07-29T09:00:00Z'), 'open', TERAZ), true)
  })

  it('zadanie zamkniete nigdy nie jest spoznione', () => {
    assert.strictEqual(isOverdue(ms('2026-07-01T09:00:00Z'), 'closed', TERAZ), false)
    assert.strictEqual(isOverdue(ms('2026-07-01T09:00:00Z'), 'done', TERAZ), false)
  })

  it('brak terminu i smieci to nie spoznienie', () => {
    assert.strictEqual(isOverdue(null, 'open', TERAZ), false)
    assert.strictEqual(isOverdue('nie liczba', 'open', TERAZ), false)
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

/**
 * Rozpoznanie zgloszenia awaryjnego.
 *
 * Awaria nie ma wartosci w polu priority ClickUpa (2026-08-06: P1=urgent,
 * P2=high, P3=normal), wiec jedynym nosnikiem jest tag. Jesli to rozpoznanie
 * zawiedzie, alarm wyglada na tablicy jak zwykle pilne zadanie.
 */
describe('isAwaria', () => {
  it('lapie tag niezaleznie od wielkosci liter i spacji', () => {
    // Tag nadaje tez czlowiek recznie w ClickUpie, a tam nikt nie pilnuje
    // ani wielkosci liter, ani spacji na koncu.
    assert.strictEqual(isAwaria([{ name: 'awaria' }]), true)
    assert.strictEqual(isAwaria([{ name: 'Awaria' }]), true)
    assert.strictEqual(isAwaria([{ name: ' AWARIA ' }]), true)
  })

  it('znajduje tag obok innych tagow', () => {
    assert.strictEqual(isAwaria([{ name: 'bug' }, { name: 'awaria' }]), true)
  })

  it('brak tagow to brak awarii, nie blad', () => {
    // ClickUp pomija pole tags przy zadaniach bez tagow, wiec undefined jest
    // normalnym stanem, nie awaria danych.
    assert.strictEqual(isAwaria(undefined), false)
    assert.strictEqual(isAwaria(null), false)
    assert.strictEqual(isAwaria([]), false)
  })

  it('podobny tag NIE jest awaria', () => {
    // "błąd krytyczny" i "najwyższy-priorytet" istnieja w przestrzeni i znacza
    // co innego. Dopasowanie musi byc dokladne, nie "zawiera".
    assert.strictEqual(isAwaria([{ name: 'błąd krytyczny' }]), false)
    assert.strictEqual(isAwaria([{ name: 'awaria-krytyczna' }]), false)
  })
})

/**
 * Kolejnosc komentarzy w watku.
 *
 * ClickUp oddaje komentarze od NAJNOWSZEGO. Portal przepuszczal te kolejnosc
 * bez zmian, a swiezo wyslany komentarz dopinal na koniec listy, wiec wlasna
 * wypowiedz klienta ladowala pod najstarsza. Zglosil Lukasz 2026-08-06.
 */
describe('sortOldestFirst', () => {
  const c = (id: string, date: string) => ({ id, date })

  it('odwraca kolejnosc z ClickUpa na chronologiczna', () => {
    const zClickUpa = [c('nowy', '3000'), c('sredni', '2000'), c('stary', '1000')]
    assert.deepStrictEqual(
      sortOldestFirst(zClickUpa).map(x => x.id),
      ['stary', 'sredni', 'nowy']
    )
  })

  it('nie modyfikuje tablicy wejsciowej', () => {
    // Ta sama tablica idzie dalej do filtrowania i do indeksu Historii.
    const wejscie = [c('b', '2000'), c('a', '1000')]
    sortOldestFirst(wejscie)
    assert.deepStrictEqual(wejscie.map(x => x.id), ['b', 'a'])
  })

  it('rowne znaczniki czasu zachowuja kolejnosc zrodla', () => {
    // Komentarze dodane w tej samej sekundzie zdarzaja sie przy wklejaniu
    // kilku naraz. Sort ma byc stabilny, a nie tasowac je losowo.
    const rowne = [c('pierwszy', '1000'), c('drugi', '1000'), c('trzeci', '1000')]
    assert.deepStrictEqual(
      sortOldestFirst(rowne).map(x => x.id),
      ['pierwszy', 'drugi', 'trzeci']
    )
  })

  it('pusta lista nie wywala widoku', () => {
    assert.deepStrictEqual(sortOldestFirst([]), [])
  })
})
