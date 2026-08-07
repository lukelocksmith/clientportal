import { describe, it } from 'vitest'
import assert from 'node:assert'
import { parseStatusChange, parseClickUpDate } from './clickupHistoryItems'

/**
 * Odczyt zmiany statusu z payloadu webhooka ClickUpa.
 *
 * To jest zgadywanie kształtu CUDZYCH danych: pakiet nie ma na to typów,
 * dokumentacja bywa niepełna, a pola potrafią przyjść jako null. Testy są tu
 * jedynym sposobem sprawdzenia tych przypadków bez wywoływania prawdziwego
 * zdarzenia w ClickUpie — a błąd oznacza dziurę w historii, czyli rzecz, której
 * nikt nie zauważy, dopóki nie zapyta „kiedy to zadanie przeszło na weryfikację".
 *
 *   npx vitest run src/lib/clickupHistoryItems.test.ts
 */
const wpisStatusu = (nadpisz: Record<string, unknown> = {}) => ({
  field: 'status',
  date: '1786000000000',
  before: { status: 'do zrobienia' },
  after: { status: 'w trakcie' },
  user: { username: 'Filip', email: 'filip.g@important.is' },
  ...nadpisz,
})

describe('parseStatusChange', () => {
  it('czyta stan poprzedni, nowy, autora i czas', () => {
    const wynik = parseStatusChange([wpisStatusu()])

    assert.ok(wynik)
    assert.strictEqual(wynik!.fromStatus, 'do zrobienia')
    assert.strictEqual(wynik!.toStatus, 'w trakcie')
    assert.strictEqual(wynik!.actorLabel, 'Filip')
    assert.ok(wynik!.changedAt instanceof Date)
  })

  it('znajduje wpis statusu POŚRÓD innych zmian', () => {
    // Jedno zdarzenie ClickUpa potrafi nieść kilka zmian naraz.
    const wynik = parseStatusChange([
      { field: 'priority', after: { status: 'nieistotne' } },
      { field: 'name' },
      wpisStatusu(),
    ])

    assert.strictEqual(wynik?.toStatus, 'w trakcie')
  })

  it('zdarzenie BEZ zmiany statusu daje null', () => {
    // `taskUpdated` przychodzi także przy zmianie opisu czy priorytetu.
    assert.strictEqual(parseStatusChange([{ field: 'description' }]), null)
    assert.strictEqual(parseStatusChange([]), null)
  })

  it('brak tablicy w ogóle daje null, nie wyjątek', () => {
    assert.strictEqual(parseStatusChange(undefined), null)
    assert.strictEqual(parseStatusChange(null), null)
    // Webhook nie ma umowy na kształt, więc to nie jest paranoja.
    assert.strictEqual(parseStatusChange('nie tablica' as never), null)
  })

  it('brak NOWEGO statusu odrzuca cały wpis', () => {
    // Wiersz historii z pustym `to` nie mówi nic, a kolumna jest wymagana.
    assert.strictEqual(parseStatusChange([wpisStatusu({ after: null })]), null)
    assert.strictEqual(parseStatusChange([wpisStatusu({ after: { status: '  ' } })]), null)
  })

  it('brak POPRZEDNIEGO statusu jest w porządku i znaczy „nie wiemy"', () => {
    const wynik = parseStatusChange([wpisStatusu({ before: null })])

    // Odrzucenie całego zdarzenia byłoby gorsze: stracilibyśmy informację
    // o tym, że zadanie W OGÓLE zmieniło status.
    assert.strictEqual(wynik?.fromStatus, null)
    assert.strictEqual(wynik?.toStatus, 'w trakcie')
  })

  it('bez nazwy użytkownika bierzemy adres', () => {
    // Konto serwisowe agencji bywa bez `username`.
    const wynik = parseStatusChange([wpisStatusu({ user: { username: null, email: 'bot@important.is' } })])
    assert.strictEqual(wynik?.actorLabel, 'bot@important.is')
  })

  it('bez autora w ogóle zapisujemy null, nie pusty ciąg', () => {
    const wynik = parseStatusChange([wpisStatusu({ user: null })])
    assert.strictEqual(wynik?.actorLabel, null)
  })

  it('spacje wokół statusów są przycinane', () => {
    const wynik = parseStatusChange([
      wpisStatusu({ before: { status: '  do zrobienia ' }, after: { status: ' w trakcie  ' } }),
    ])
    assert.strictEqual(wynik?.fromStatus, 'do zrobienia')
    assert.strictEqual(wynik?.toStatus, 'w trakcie')
  })
})

describe('parseClickUpDate', () => {
  it('milisekundy jako NAPIS zamieniają się na datę', () => {
    // ClickUp podaje czas jako napis, nie liczbę.
    const data = parseClickUpDate('1786000000000')
    assert.ok(data instanceof Date)
    assert.strictEqual(data!.getTime(), 1786000000000)
  })

  it('brak, pusty i nieliczbowy dają null', () => {
    for (const zly of [undefined, null, '', '   ', 'wczoraj', {}]) {
      assert.strictEqual(parseClickUpDate(zly), null, String(zly))
    }
  })

  it('zero i wartości ujemne dają null', () => {
    assert.strictEqual(parseClickUpDate('0'), null)
    assert.strictEqual(parseClickUpDate('-5'), null)
  })

  it('data sprzed 2000 roku daje null, bo to zły format, nie stare zdarzenie', () => {
    // Sekundy zamiast milisekund wypadają właśnie tutaj: 1786000000 to 2026 rok
    // w sekundach, ale 1970 w milisekundach. Wołający użyje wtedy czasu
    // odebrania webhooka zamiast wartości, która przestawiłaby porządek.
    assert.strictEqual(parseClickUpDate('1786000000'), null)
  })
})
