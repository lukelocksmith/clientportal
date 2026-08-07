import { describe, it } from 'vitest'
import assert from 'node:assert'
import { requestHostname, isFromAllowedDomain, corsOrigins } from './origin'

function req(headers: Record<string, string> = {}): Request {
  return new Request('http://localhost/x', { headers })
}

describe('requestHostname', () => {
  it('extracts the hostname from the Origin header', () => {
    assert.strictEqual(requestHostname(req({ Origin: 'https://klient.pl' })), 'klient.pl')
  })

  it('falls back to Referer when Origin is absent', () => {
    assert.strictEqual(
      requestHostname(req({ Referer: 'https://klient.pl/podstrona?x=1' })),
      'klient.pl'
    )
  })

  it('prefers Origin over Referer when both are present', () => {
    assert.strictEqual(
      requestHostname(req({ Origin: 'https://origin.pl', Referer: 'https://referer.pl/' })),
      'origin.pl'
    )
  })

  it('returns null when neither header is present', () => {
    assert.strictEqual(requestHostname(req()), null)
  })

  it('returns null when the header value is not a parseable URL', () => {
    assert.strictEqual(requestHostname(req({ Origin: 'not-a-url' })), null)
  })
})

describe('isFromAllowedDomain', () => {
  const domains = ['klient.pl', 'www.klient.pl']

  it('matches when the hostname is in the list', () => {
    assert.strictEqual(isFromAllowedDomain(req({ Origin: 'https://klient.pl' }), domains), true)
  })

  it('matches case-insensitively', () => {
    assert.strictEqual(
      isFromAllowedDomain(req({ Origin: 'https://WWW.Klient.PL' }), domains),
      true
    )
  })

  it('returns false for a hostname not in the list', () => {
    assert.strictEqual(isFromAllowedDomain(req({ Origin: 'https://evil.example' }), domains), false)
  })

  it('returns false when there is no Origin or Referer at all', () => {
    assert.strictEqual(isFromAllowedDomain(req(), domains), false)
  })
})

describe('corsOrigins', () => {
  const domains = ['klient.pl']

  it('returns [origin] when the domain check passes', () => {
    assert.deepStrictEqual(corsOrigins(req({ Origin: 'https://klient.pl' }), domains), [
      'https://klient.pl',
    ])
  })

  it('returns [] when the domain check fails', () => {
    assert.deepStrictEqual(corsOrigins(req({ Origin: 'https://evil.example' }), domains), [])
  })

  it('returns [] when there is no Origin header, even if Referer would pass', () => {
    assert.deepStrictEqual(corsOrigins(req({ Referer: 'https://klient.pl/' }), domains), [])
  })
})

/**
 * PORT W KONFIGURACJI.
 *
 * `site_domains` moze zawierac port (`localhost:5500`), bo ten sam wpis buduje
 * link „Pokaz na stronie" w portalu — bez portu prowadzilby donikad. Do
 * sprawdzania `Origin` port jest POMIJANY, bo `new URL(...).hostname` go nie
 * zawiera; gdyby porownanie bralo caly wpis, kazde zgloszenie z tak
 * skonfigurowanego projektu konczyloby sie 403.
 */
describe('wpis konfiguracji z portem', () => {
  const zOriginem = (origin: string) =>
    new Request('https://portal.example/api', { headers: { origin } })

  it('zgloszenie z tego hosta przechodzi mimo portu w konfiguracji', () => {
    assert.strictEqual(
      isFromAllowedDomain(zOriginem('http://localhost:5500'), ['localhost:5500']),
      true
    )
  })

  it('INNY port tego samego hosta tez przechodzi', () => {
    // Port pelni tu role adresu, nie granicy — to zachowanie dotychczasowe,
    // zachowane swiadomie. Zawezenie po porcie byloby nowa regula.
    assert.strictEqual(
      isFromAllowedDomain(zOriginem('http://localhost:3000'), ['localhost:5500']),
      true
    )
  })

  it('OBCY host nadal odpada, mimo pasujacego portu', () => {
    assert.strictEqual(
      isFromAllowedDomain(zOriginem('http://zlodziej.example:5500'), ['localhost:5500']),
      false
    )
  })

  it('wielkosc liter we wpisie z portem nie ma znaczenia', () => {
    assert.strictEqual(
      isFromAllowedDomain(zOriginem('https://demo.example.test'), ['DEMO.example.TEST:8080']),
      true
    )
  })
})
