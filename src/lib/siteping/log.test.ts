import { describe, it } from 'vitest'
import assert from 'node:assert'
import { shortenIp, outcomeForStatus, trimForLog } from './log'

/**
 * Log diagnostyczny SitePinga — czesc CZYSTA, bez bazy.
 *
 * Te trzy funkcje decyduja o tym, CO trafia do tabeli, wiec sprawdzamy je
 * osobno od zapisu: blad w skracaniu adresu IP jest bledem prywatnosci,
 * a nie bledem SQL-a, i nie chcemy go szukac w tescie integracyjnym.
 */
describe('shortenIp', () => {
  it('IPv4 zostaje przyciete do trzech oktetow', () => {
    // Trzy oktety wystarcza, zeby odroznic „jeden klient bije w kolko" od
    // „ruch z wielu miejsc", a nie sa juz adresem konkretnej maszyny.
    assert.strictEqual(shortenIp('89.64.12.34'), '89.64.12')
  })

  it('IPv6 zostaje przyciete do trzech grup', () => {
    assert.strictEqual(shortenIp('2001:0db8:85a3:0000:0000:8a2e:0370:7334'), '2001:0db8:85a3')
  })

  it('port po adresie nie wchodzi do zapisu', () => {
    // `x-forwarded-for` bywa podawany z portem przez czesc proxy.
    assert.strictEqual(shortenIp('89.64.12.34:51515'), '89.64.12')
  })

  it('brak adresu nie wywala zapisu, tylko daje null', () => {
    assert.strictEqual(shortenIp(null), null)
    assert.strictEqual(shortenIp(undefined), null)
    assert.strictEqual(shortenIp(''), null)
    // Tyle wpisuje `clientIp` w trasie, gdy naglowka nie bylo w ogole.
    assert.strictEqual(shortenIp('unknown'), null)
  })

  it('smiec z naglowka nie trafia do kolumny', () => {
    // Naglowek jest sterowany przez nadawce, wiec wszystko, co nie wyglada
    // na adres, odrzucamy zamiast zapisywac dowolny tekst.
    assert.strictEqual(shortenIp('nie-jest-adresem'), null)
    assert.strictEqual(shortenIp('999.1.1.1'), null)
  })
})

describe('outcomeForStatus', () => {
  it('kod ponizej 400 to wynik ok', () => {
    assert.strictEqual(outcomeForStatus(200), 'ok')
    assert.strictEqual(outcomeForStatus(201), 'ok')
  })

  it('kazda odmowa ma wlasna nazwe', () => {
    // Te trzy odpowiadaja na „czemu klientowi nie dochodza zgloszenia",
    // wiec musza byc rozroznialne w panelu bez czytania kodu HTTP.
    assert.strictEqual(outcomeForStatus(403), 'origin_not_allowed')
    assert.strictEqual(outcomeForStatus(429), 'rate_limited')
    assert.strictEqual(outcomeForStatus(404), 'misconfigured')
    assert.strictEqual(outcomeForStatus(400), 'invalid_payload')
  })

  it('500 i kody nieprzewidziane to blad', () => {
    // Nieznany kod NIE jest zgadywany: log ma powiedziec „cos jest nie tak",
    // a nie podstawic najblizsza pasujaca etykiete.
    assert.strictEqual(outcomeForStatus(500), 'error')
    assert.strictEqual(outcomeForStatus(502), 'error')
    assert.strictEqual(outcomeForStatus(401), 'error')
  })
})

describe('trimForLog', () => {
  it('krotka wartosc przechodzi bez zmian', () => {
    assert.strictEqual(trimForLog('https://wodadlafirmy.pl', 200), 'https://wodadlafirmy.pl')
  })

  it('dluga wartosc jest przycinana', () => {
    // Origin i tresc bledu przychodza z zewnatrz i moga miec dowolna dlugosc.
    const wynik = trimForLog('x'.repeat(500), 200)
    assert.strictEqual(wynik?.length, 200)
  })

  it('pusta wartosc daje null, nie pusty napis', () => {
    assert.strictEqual(trimForLog(null, 200), null)
    assert.strictEqual(trimForLog('   ', 200), null)
  })
})
