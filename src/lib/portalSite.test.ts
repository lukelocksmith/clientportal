import { describe, it } from 'vitest'
import assert from 'node:assert'
import { portalSiteUrl } from './portalSite'

/**
 * Adres strony klienta pod przycisk „Pokaż na stronie".
 *
 * Ta funkcja decyduje, czy klient w ogóle zobaczy wybór drogi zgłoszenia.
 * Null znaczy „nie znamy strony" i wtedy przycisk otwiera asystenta od razu,
 * bez menu — czyli błąd tutaj nie wywala portalu, tylko po cichu odbiera
 * funkcję. Takie awarie są najtrudniejsze do zauważenia, stąd te testy.
 *
 *   npx vitest run src/lib/portalSite.test.ts
 */
const portal = (nadpisz: Partial<{ sitepingEnabled: boolean; siteDomains: string | null }> = {}) => ({
  sitepingEnabled: true,
  siteDomains: 'wodadlafirmy.pl',
  ...nadpisz,
})

describe('portalSiteUrl', () => {
  it('skonfigurowany projekt daje pełny adres https', () => {
    assert.strictEqual(portalSiteUrl(portal()), 'https://wodadlafirmy.pl')
  })

  it('bierze PIERWSZĄ domenę z listy', () => {
    // Kolejność w konfiguracji jest świadoma: pierwsza to produkcja,
    // kolejne bywają stagingiem.
    assert.strictEqual(
      portalSiteUrl(portal({ siteDomains: 'wodadlafirmy.pl,wdf.important.is' })),
      'https://wodadlafirmy.pl'
    )
  })

  it('WYŁĄCZONY SitePing daje null, nawet gdy domeny są', () => {
    // Inaczej wyłączenie funkcji zostawiałoby klientowi działający przycisk
    // prowadzący na stronę, z której endpoint i tak odrzuci zgłoszenie.
    assert.strictEqual(portalSiteUrl(portal({ sitepingEnabled: false })), null)
  })

  it('brak domen daje null, mimo włączonej flagi', () => {
    assert.strictEqual(portalSiteUrl(portal({ siteDomains: null })), null)
    assert.strictEqual(portalSiteUrl(portal({ siteDomains: '' })), null)
    assert.strictEqual(portalSiteUrl(portal({ siteDomains: '   ' })), null)
    assert.strictEqual(portalSiteUrl(portal({ siteDomains: ',,' })), null)
  })

  it('spacje wokół domeny nie psują adresu', () => {
    assert.strictEqual(portalSiteUrl(portal({ siteDomains: '  demo.pl , inne.pl ' })), 'https://demo.pl')
  })

  it('domena wpisana ze schematem NIE daje podwójnego https', () => {
    // Panel na to nie pozwala, ale `/api/admin/*` przyjmuje też token, więc
    // curl omija tamtą walidację. `https://https//cos` byłoby martwym linkiem.
    assert.strictEqual(portalSiteUrl(portal({ siteDomains: 'https://demo.pl' })), 'https://demo.pl')
    assert.strictEqual(portalSiteUrl(portal({ siteDomains: 'http://demo.pl' })), 'https://demo.pl')
  })

  it('ukośnik na końcu jest ucinany', () => {
    assert.strictEqual(portalSiteUrl(portal({ siteDomains: 'demo.pl/' })), 'https://demo.pl')
  })

  it('zawsze https, nawet gdy w konfiguracji było http', () => {
    // Portal chodzi po https, więc odesłanie na http oznaczaloby ostrzeżenie
    // przeglądarki w chwili zgłaszania usterki.
    assert.ok(portalSiteUrl(portal({ siteDomains: 'http://demo.pl' }))!.startsWith('https://'))
  })

  it('sam schemat bez hosta daje null, a nie pusty adres', () => {
    assert.strictEqual(portalSiteUrl(portal({ siteDomains: 'https://' })), null)
  })
})
