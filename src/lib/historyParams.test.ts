import { describe, it } from 'vitest'
import assert from 'node:assert'
import { firstParam, nextPageHref, parseHistoryParams, scopeToFilters } from './historyParams'

/**
 * Parametry adresu zakladki Historia.
 *
 * Zasada calego modulu: LINK Z FILTRAMI WYSLANY KLIENTOWI NIGDY NIE MA UMRZEC.
 * Cokolwiek popsutego w adresie ma cicho wrocic do wartosci domyslnej, zamiast
 * zwracac 404 albo wyjatek. To jest odwrotnosc zasady z tras API, gdzie zle
 * dane odrzucamy — bo tu nie ma zadnej decyzji o dostepie, jest tylko widok.
 *
 *   npx vitest run src/lib/historyParams.test.ts
 */
describe('firstParam', () => {
  it('powtorzony parametr daje PIERWSZA wartosc', () => {
    // Next oddaje tablice przy `?q=a&q=b`. Bez tego do zapytania poszlaby
    // tablica i filtrowanie po niej nie mialoby sensu.
    assert.strictEqual(firstParam(['a', 'b']), 'a')
  })

  it('pojedyncza wartosc przechodzi bez zmian', () => {
    assert.strictEqual(firstParam('a'), 'a')
  })

  it('brak parametru to undefined', () => {
    assert.strictEqual(firstParam(undefined), undefined)
  })

  it('pusta tablica to undefined, nie wyjatek', () => {
    assert.strictEqual(firstParam([]), undefined)
  })
})

describe('parseHistoryParams', () => {
  it('pusty adres daje sensowne wartosci domyslne', () => {
    const wynik = parseHistoryParams({})

    assert.strictEqual(wynik.zakres, 'wszystkie')
    assert.strictEqual(wynik.q, undefined)
    assert.strictEqual(wynik.kursor, undefined)
  })

  it('poprawne wartosci przechodza', () => {
    const wynik = parseHistoryParams({
      q: 'formularz', status: 'zamkniete', priorytet: 'high', zakres: 'otwarte', kursor: '123_abc',
    })

    assert.strictEqual(wynik.q, 'formularz')
    assert.strictEqual(wynik.priorytet, 'high')
    assert.strictEqual(wynik.zakres, 'otwarte')
  })

  it('NIEZNANY zakres cicho wraca do „wszystkie"', () => {
    // Nie 404: klient dostal ten link od nas i ma zobaczyc Historie, nawet gdy
    // adres przyszedl obciety przez klienta pocztowego.
    assert.strictEqual(parseHistoryParams({ zakres: 'cokolwiek' }).zakres, 'wszystkie')
  })

  it('NIEZNANY priorytet cicho znika, reszta filtrow zostaje', () => {
    const wynik = parseHistoryParams({ priorytet: 'krytyczny', q: 'szukane' })

    assert.strictEqual(wynik.priorytet, undefined)
    assert.strictEqual(wynik.q, 'szukane', 'pozostale filtry przezywaja jeden bledny')
  })

  it('ZA DLUGIE wartosci cicho znikaja', () => {
    const wynik = parseHistoryParams({ q: 'x'.repeat(500), kursor: 'y'.repeat(200) })

    assert.strictEqual(wynik.q, undefined)
    assert.strictEqual(wynik.kursor, undefined)
  })

  it('powtorzone parametry sa sprowadzane do pierwszego', () => {
    assert.strictEqual(parseHistoryParams({ q: ['pierwsze', 'drugie'] }).q, 'pierwsze')
  })

  it('caly adres pelen smieci NIE rzuca wyjatkiem', () => {
    const wynik = parseHistoryParams({
      q: ['x'.repeat(300)], status: 'y'.repeat(100), priorytet: '<script>', zakres: '../../etc',
      kursor: 'z'.repeat(500),
    })

    assert.strictEqual(wynik.zakres, 'wszystkie')
    assert.strictEqual(wynik.priorytet, undefined)
  })
})

describe('scopeToFilters', () => {
  it('„otwarte" i „zamkniete" daja rozlaczne flagi', () => {
    assert.deepStrictEqual(scopeToFilters('otwarte'), { onlyOpen: true })
    assert.deepStrictEqual(scopeToFilters('zamkniete'), { onlyClosed: true })
  })

  it('„wszystkie" NIE ustawia zadnej flagi', () => {
    // Ustawienie obu na false znaczyloby co innego niz brak zawezenia.
    assert.deepStrictEqual(scopeToFilters('wszystkie'), {})
  })
})

describe('nextPageHref', () => {
  it('zachowuje filtry i dokleja kursor', () => {
    const href = nextPageHref(
      'wdf',
      { q: 'formularz', status: 'zamkniete', priorytet: 'high', zakres: 'otwarte', kursor: undefined },
      '1700_zad9'
    )

    assert.ok(href.startsWith('/wdf/historia?'))
    const p = new URLSearchParams(href.split('?')[1])
    assert.strictEqual(p.get('q'), 'formularz')
    assert.strictEqual(p.get('priorytet'), 'high')
    assert.strictEqual(p.get('zakres'), 'otwarte')
    assert.strictEqual(p.get('kursor'), '1700_zad9')
  })

  it('domyslny zakres NIE trafia do adresu', () => {
    const href = nextPageHref('wdf', { zakres: 'wszystkie', q: undefined, status: undefined, priorytet: undefined, kursor: undefined }, 'k1')

    // Krotszy adres i brak szumu w linku, ktory klient widzi w pasku.
    assert.ok(!href.includes('zakres='))
  })

  it('puste filtry nie zostawiaja pustych parametrow', () => {
    const href = nextPageHref('wdf', { zakres: 'wszystkie', q: undefined, status: undefined, priorytet: undefined, kursor: undefined }, 'k1')

    assert.strictEqual(href, '/wdf/historia?kursor=k1')
  })

  it('znaki specjalne w szukanej frazie sa kodowane', () => {
    const href = nextPageHref('wdf', { q: 'a&b=c d', zakres: 'wszystkie', status: undefined, priorytet: undefined, kursor: undefined }, 'k1')

    // Bez kodowania `&` rozbilby adres na dwa parametry.
    assert.strictEqual(new URLSearchParams(href.split('?')[1]).get('q'), 'a&b=c d')
  })

  it('adres da sie z powrotem sparsowac na te same filtry', () => {
    const wejscie = { q: 'formularz', status: undefined, priorytet: 'low' as const, zakres: 'zamkniete' as const, kursor: undefined }
    const href = nextPageHref('wdf', wejscie, 'k9')

    const p = new URLSearchParams(href.split('?')[1])
    const odczytane = parseHistoryParams(Object.fromEntries(p.entries()))

    assert.strictEqual(odczytane.q, wejscie.q)
    assert.strictEqual(odczytane.priorytet, wejscie.priorytet)
    assert.strictEqual(odczytane.zakres, wejscie.zakres)
  })
})
