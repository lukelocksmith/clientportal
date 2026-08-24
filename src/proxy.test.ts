import { describe, it } from 'vitest'
import assert from 'node:assert'
import { NextRequest } from 'next/server'
import { proxy } from './proxy'

/**
 * POLITYKA BEZPIECZENSTWA TRESCI (CSP) na wyjsciu z proxy.
 *
 * Ten plik powstal 2026-08-24, po tym jak brak jednej dyrektywy po cichu
 * wylaczyl funkcje: `media-src` nie bylo wcale, wiec wideo dolaczone do
 * komentarza w ClickUpie wpadalo w `default-src 'self'` i odtwarzacz milczal.
 * W interfejsie nie bylo ZADNEGO bledu, naruszenie widac bylo tylko w konsoli
 * przegladarki. Testy pilnuja wiec dwoch rzeczy naraz: ze to, co portal
 * naprawde pokazuje, jest dozwolone, i ze przy okazji nie poluzowalismy
 * niczego, co ma byc zamkniete.
 *
 *   npx vitest run src/proxy.test.ts
 */

/** Naglowek CSP z odpowiedzi na sciezke, ktora proxy przepuszcza bez sesji. */
function csp(pathname = '/wdf/login'): string {
  const res = proxy(new NextRequest(`http://localhost${pathname}`))
  const naglowek = res.headers.get('content-security-policy')
  assert.ok(naglowek, 'proxy nie odda nagłowka CSP')
  return naglowek
}

/** Wartosc jednej dyrektywy, bez jej nazwy. */
function dyrektywa(nazwa: string, naglowek = csp()): string {
  const czesc = naglowek.split(';').map(c => c.trim()).find(c => c === nazwa || c.startsWith(`${nazwa} `))
  assert.ok(czesc, `brak dyrektywy ${nazwa} w polityce`)
  return czesc.slice(nazwa.length).trim()
}

describe('co portal MUSI moc pokazac', () => {
  it('wideo z zalacznika ClickUpa nie jest blokowane', () => {
    // Bez `media-src` przegladarka spada do `default-src 'self'` i odtwarzacz
    // milczy, bo nagrania leza na CDN-ie ClickUpa, nie u nas.
    assert.match(dyrektywa('media-src'), /https:/)
  })

  it('obrazek z zalacznika i logo klienta nie sa blokowane', () => {
    assert.match(dyrektywa('img-src'), /https:/)
  })

  it('podglad wgrywanego pliku z pamieci przegladarki dziala', () => {
    // `blob:` jest potrzebny przy podgladzie zalacznika przed wyslaniem.
    assert.match(dyrektywa('img-src'), /blob:/)
    assert.match(dyrektywa('media-src'), /blob:/)
  })
})

describe('co MUSI zostac zamkniete', () => {
  it('skrypt tylko wlasny i tylko z nonce', () => {
    const wartosc = dyrektywa('script-src')

    assert.match(wartosc, /'self'/)
    assert.match(wartosc, /'nonce-/)
    assert.ok(!wartosc.includes('https:'), 'skrypt z dowolnego hosta to koniec zabawy')
    assert.ok(!wartosc.includes("'unsafe-inline'"), 'inline script nie ma prawa przejsc')
  })

  it('polaczenia wychodzace tylko do wlasnego API', () => {
    assert.strictEqual(dyrektywa('connect-src'), "'self'")
  })

  it('portal nie da sie osadzic w obcej ramce', () => {
    assert.strictEqual(dyrektywa('frame-ancestors'), "'none'")
  })

  it('wtyczki i obiekty wylaczone', () => {
    assert.strictEqual(dyrektywa('object-src'), "'none'")
  })

  it('domyslne zrodlo pozostaje wlasne', () => {
    assert.strictEqual(dyrektywa('default-src'), "'self'")
  })
})

describe('naglowek dociera wszedzie', () => {
  it('takze na przekierowaniu do logowania', () => {
    // Cztery wyjscia z proxy i tylko jedno z nich widac klikajac. Strona
    // logowania jest tym miejscem, gdzie CSP jest najbardziej potrzebne.
    const res = proxy(new NextRequest('http://localhost/wdf/raporty'))

    assert.strictEqual(res.status, 307, 'bez sesji ma byc przekierowanie')
    assert.ok(res.headers.get('content-security-policy'), 'przekierowanie bez CSP')
  })

  it('nonce jest INNY przy kazdym zadaniu', () => {
    // Staly nonce znaczy tyle samo, co brak nonce'a.
    const pierwszy = dyrektywa('script-src', csp())
    const drugi = dyrektywa('script-src', csp())

    assert.notStrictEqual(pierwszy, drugi)
  })
})
