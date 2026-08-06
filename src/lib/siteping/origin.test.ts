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
