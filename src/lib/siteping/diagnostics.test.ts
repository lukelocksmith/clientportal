import { describe, it } from 'vitest'
import assert from 'node:assert'
import { buildDiagnosticsComment, hasDiagnostics, type Diagnostics } from './diagnostics'

/**
 * Slad techniczny z chwili zgloszenia, jako komentarz do zadania.
 *
 * Powstal pod zgloszenia „strona nie dziala", ktore nie niosa zadnych
 * szczegolow. Wartosc calej funkcji zalezy od tego, czy zespol to PRZECZYTA —
 * a przeczyta tylko wtedy, gdy nie bedzie to sciana tekstu i gdy jedyny wyjatek
 * nie bedzie zakopany pod dziesiecioma logami biblioteki analitycznej.
 * Stad limity i kolejnosc, i stad te testy.
 *
 *   npx vitest run src/lib/siteping/diagnostics.test.ts
 */
const log = (level: string, message: string, timestamp = '2026-08-07T16:30:00.000Z') =>
  ({ level, message, timestamp })

const req = (status: number, url: string, method = 'GET', durationMs = 120) =>
  ({ status, url, method, durationMs, timestamp: '2026-08-07T16:30:00.000Z' })

describe('hasDiagnostics', () => {
  it('brak, null i puste tablice znacza „nie ma czego pokazac"', () => {
    assert.strictEqual(hasDiagnostics(null), false)
    assert.strictEqual(hasDiagnostics(undefined), false)
    assert.strictEqual(hasDiagnostics({}), false)
    assert.strictEqual(hasDiagnostics({ console: [], network: [] }), false)
    assert.strictEqual(hasDiagnostics({ console: null, network: null }), false)
  })

  it('jeden wpis w dowolnym kanale wystarczy', () => {
    assert.strictEqual(hasDiagnostics({ console: [log('error', 'x')] }), true)
    assert.strictEqual(hasDiagnostics({ network: [req(500, '/api/x')] }), true)
  })
})

describe('buildDiagnosticsComment', () => {
  it('PUSTY slad nie tworzy komentarza', () => {
    // Zadanie z komentarzem „brak danych" wyglada jak awaria zbierania,
    // a jest zwykla cisza w konsoli.
    assert.strictEqual(buildDiagnosticsComment(null), null)
    assert.strictEqual(buildDiagnosticsComment({ console: [], network: [] }), null)
  })

  it('komentarz NIE ma prefiksu [P], wiec zostaje wewnetrzny', () => {
    const c = buildDiagnosticsComment({ console: [log('error', 'Uncaught TypeError')] })!

    // To sa wlasne bledy techniczne strony klienta. Nie ma powodu, zeby
    // ogladal je w naszym portalu.
    assert.ok(!c.includes('[P]'))
  })

  it('pokazuje tresc, poziom i godzine wpisu', () => {
    const c = buildDiagnosticsComment({
      console: [log('error', 'Uncaught TypeError: x is not a function')],
    })!

    assert.match(c, /ERROR/)
    assert.match(c, /Uncaught TypeError/)
    assert.match(c, /\d{2}:\d{2}:\d{2}/)
  })

  it('BLEDY I OSTRZEZENIA ida PRZED zwyklymi logami', () => {
    const c = buildDiagnosticsComment({
      console: [
        log('log', 'analytics gotowe'),
        log('log', 'baner zamkniety'),
        log('error', 'TO JEST WAZNE'),
      ],
    })!

    // Przy pietnastu wpisach kolejnosc chronologiczna zakopalaby jedyny
    // wyjatek pod logami biblioteki analitycznej.
    assert.ok(
      c.indexOf('TO JEST WAZNE') < c.indexOf('analytics gotowe'),
      'blad stoi nad zwyklym logiem'
    )
  })

  it('dluga linia jest UCINANA, bo jeden log potrafi miec kilobajty', () => {
    const c = buildDiagnosticsComment({ console: [log('log', 'x'.repeat(5000))] })!

    assert.ok(c.length < 1000, `komentarz ma ${c.length} znakow`)
    assert.match(c, /…/)
  })

  it('wielolinijkowy slad stosu jest sprowadzony do jednej linii', () => {
    const c = buildDiagnosticsComment({ console: [log('error', 'Blad\n  at foo\n  at bar')] })!

    // Inaczej jeden wyjatek rozbilby cala liste wypunktowana.
    const linieZWpisami = c.split('\n').filter(l => l.startsWith('- '))
    assert.strictEqual(linieZWpisami.length, 1)
  })

  it('nadmiar wpisow jest UCINANY, z informacja ILE zostalo', () => {
    const duzo = Array.from({ length: 40 }, (_, i) => log('log', `wpis ${i}`))

    const c = buildDiagnosticsComment({ console: duzo })!

    // Komplet i tak zostaje w zalaczniku JSON, wiec nic nie ginie.
    assert.match(c, /Konsola\*\* \(40\)/, 'liczba CALKOWITA jest podana, nie liczba pokazanych')
    assert.match(c, /i jeszcze \d+/)
    assert.match(c, /załączniku JSON/)
  })

  it('nieudane zadania niosa status, metode, adres i czas', () => {
    const c = buildDiagnosticsComment({ network: [req(500, 'https://api.test/zamowienia', 'POST', 3400)] })!

    assert.match(c, /500/)
    assert.match(c, /POST/)
    assert.match(c, /api\.test\/zamowienia/)
    assert.match(c, /3400 ms/)
  })

  it('status 0 nazywamy „brak odpowiedzi", a nie zerem', () => {
    const c = buildDiagnosticsComment({ network: [req(0, 'https://api.test/x')] })!

    // Zero znaczy, ze zadanie NIGDY nie doszlo do serwera — inna przyczyna
    // niz 500 i inna reakcja zespolu.
    assert.match(c, /brak odpowiedzi/)
    assert.ok(!/`0`/.test(c))
  })

  it('bardzo dlugi adres tez jest ucinany', () => {
    const c = buildDiagnosticsComment({
      network: [req(404, `https://api.test/x?${'a=1&'.repeat(200)}`)],
    })!

    assert.ok(c.length < 1000)
  })

  it('oba kanaly naraz daja jeden komentarz z dwoma sekcjami', () => {
    const d: Diagnostics = {
      console: [log('error', 'wyjatek')],
      network: [req(503, 'https://api.test/x')],
    }

    const c = buildDiagnosticsComment(d)!

    assert.match(c, /Konsola/)
    assert.match(c, /Nieudane żądania/)
  })

  it('popsuty znacznik czasu nie wywala formatowania', () => {
    const c = buildDiagnosticsComment({ console: [log('error', 'x', 'to nie data')] })!

    // Zadanie bez komentarza byloby gorsze niz komentarz bez godziny.
    assert.match(c, /--:--:--/)
    assert.match(c, /ERROR/)
  })
})
