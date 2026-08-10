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
    assert.strictEqual(portalSiteUrl(portal()), 'https://wodadlafirmy.pl?siteping=1')
  })

  it('bierze PIERWSZĄ domenę z listy', () => {
    // Kolejność w konfiguracji jest świadoma: pierwsza to produkcja,
    // kolejne bywają stagingiem.
    assert.strictEqual(
      portalSiteUrl(portal({ siteDomains: 'wodadlafirmy.pl,wdf.important.is' })),
      'https://wodadlafirmy.pl?siteping=1'
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
    assert.strictEqual(portalSiteUrl(portal({ siteDomains: '  demo.pl , inne.pl ' })), 'https://demo.pl?siteping=1')
  })

  it('domena wpisana ze schematem NIE daje podwójnego https', () => {
    // Panel na to nie pozwala, ale `/api/admin/*` przyjmuje też token, więc
    // curl omija tamtą walidację. `https://https//cos` byłoby martwym linkiem.
    assert.strictEqual(portalSiteUrl(portal({ siteDomains: 'https://demo.pl' })), 'https://demo.pl?siteping=1')
    assert.strictEqual(portalSiteUrl(portal({ siteDomains: 'http://demo.pl' })), 'https://demo.pl?siteping=1')
  })

  it('ukośnik na końcu jest ucinany', () => {
    assert.strictEqual(portalSiteUrl(portal({ siteDomains: 'demo.pl/' })), 'https://demo.pl?siteping=1')
  })

  it('domena w internecie dostaje https, nawet gdy w konfiguracji było http', () => {
    // Strona klienta ma chodzić po https; odesłanie na http oznaczałoby
    // ostrzeżenie przeglądarki w chwili zgłaszania usterki.
    assert.ok(portalSiteUrl(portal({ siteDomains: 'http://demo.pl' }))!.startsWith('https://'))
  })

  describe('hosty lokalne', () => {
    // BŁĄD, KTÓRY TU BYŁ: schemat był wpisany na sztywno jako https, więc
    // przycisk „Pokaż na stronie" prowadził na `https://localhost`, gdzie nic
    // nie nasłuchuje — przeglądarka pokazywała ERR_CONNECTION_REFUSED.
    // Zgłoszone przez Łukasza przy pierwszym kliknięciu, 2026-08-07.
    it('localhost dostaje http, nie https', () => {
      assert.strictEqual(portalSiteUrl(portal({ siteDomains: 'localhost' })), 'http://localhost?siteping=1')
    })

    it('poddomena .localhost też', () => {
      assert.strictEqual(portalSiteUrl(portal({ siteDomains: 'wdf.localhost' })), 'http://wdf.localhost?siteping=1')
    })

    it('adres pętli zwrotnej też', () => {
      assert.strictEqual(portalSiteUrl(portal({ siteDomains: '127.0.0.1' })), 'http://127.0.0.1?siteping=1')
    })

    it('PORT zostaje w adresie, bo bez niego link prowadzi donikąd', () => {
      // Strona testowa stoi na 5500; `http://localhost` (port 80) to była
      // druga połowa tego samego błędu.
      assert.strictEqual(
        portalSiteUrl(portal({ siteDomains: 'localhost:5500' })),
        'http://localhost:5500?siteping=1'
      )
    })

    it('domena KOŃCZĄCA SIĘ na „localhost" bez kropki to zwykła domena', () => {
      // `mojlocalhost.pl` nie jest lokalny. Dopasowanie po samej końcówce
      // wpuściłoby tu http dla prawdziwej domeny w internecie.
      assert.ok(portalSiteUrl(portal({ siteDomains: 'mojlocalhost.pl' }))!.startsWith('https://'))
    })
  })

  it('sam schemat bez hosta daje null, a nie pusty adres', () => {
    assert.strictEqual(portalSiteUrl(portal({ siteDomains: 'https://' })), null)
  })

  describe('parametr wlaczajacy widget', () => {
    /**
     * BLAD, KTORY TU BYL (2026-08-10): adres nie niosl zadnego parametru,
     * a strona important.is osadza widget WARUNKOWO, zeby nie pokazywac go
     * kazdemu odwiedzajacemu. Przycisk „Pokaz na stronie" otwieral wiec
     * strone BEZ widgetu: klient klikal „Zaznacz miejsce, ktorego dotyczy
     * sprawa" i nie widzial niczego, bez zadnego bledu.
     */
    it('KAZDY zwrocony adres niesie parametr, inaczej widget sie nie pokaze', () => {
      const przypadki = ['demo.pl', 'localhost:5500', 'https://demo.pl', 'demo.pl/']
      for (const siteDomains of przypadki) {
        const url = portalSiteUrl(portal({ siteDomains }))!
        assert.ok(
          url.includes('siteping='),
          `adres bez parametru prowadzi na strone bez widgetu: ${siteDomains} -> ${url}`
        )
      }
    })

    it('adres da sie sparsowac i ma parametr jako query, nie w hoscie', () => {
      // Sklejenie bez znaku zapytania dawaloby host „demo.plsiteping=1",
      // czyli link prowadzacy donikad.
      const url = new URL(portalSiteUrl(portal({ siteDomains: 'demo.pl' }))!)
      assert.strictEqual(url.host, 'demo.pl')
      assert.strictEqual(url.searchParams.get('siteping'), '1')
    })

    it('port zostaje portem, a nie czescia parametru', () => {
      const url = new URL(portalSiteUrl(portal({ siteDomains: 'localhost:5500' }))!)
      assert.strictEqual(url.host, 'localhost:5500')
      assert.strictEqual(url.searchParams.get('siteping'), '1')
    })
  })
})
