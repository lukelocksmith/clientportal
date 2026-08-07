import { describe, it, beforeEach, afterEach } from 'vitest'
import assert from 'node:assert'
import { NextRequest } from 'next/server'
import { verifyToken } from './apiAuth'

/**
 * Tokeny maszyna-maszyna: crony i zarzadzanie portalem z terminala.
 *
 * Przechodza tedy `CRON_SECRET` i `ADMIN_API_TOKEN`, czyli klucze dajace dostep
 * do WSZYSTKICH projektow naraz. Trasy, ktore z tego korzystaja, maja wlasne
 * testy, ale one sprawdzaja „czy dobry token wpuszcza, a zly nie". Tutaj
 * chodzi o przypadki brzegowe samego porownania — takie, do ktorych przez trase
 * sie nie dojdzie, a ktore decyduja o tym, czy porownanie w ogole jest bezpieczne.
 *
 *   npx vitest run src/lib/apiAuth.test.ts
 */
const ZMIENNA = 'TEST_TOKEN_DO_SPRAWDZENIA'
const TOKEN = 'poprawny-token-abcdef'

const zadanie = (opts: { naglowek?: string; parametr?: string } = {}) => {
  const url = opts.parametr !== undefined
    ? `http://localhost/api/x?token=${encodeURIComponent(opts.parametr)}`
    : 'http://localhost/api/x'
  return new NextRequest(url, {
    headers: opts.naglowek ? { authorization: opts.naglowek } : {},
  } as ConstructorParameters<typeof NextRequest>[1])
}

beforeEach(() => {
  process.env[ZMIENNA] = TOKEN
})
afterEach(() => {
  delete process.env[ZMIENNA]
})

describe('verifyToken', () => {
  it('poprawny token w naglowku Bearer przechodzi', () => {
    assert.strictEqual(verifyToken(zadanie({ naglowek: `Bearer ${TOKEN}` }), ZMIENNA), true)
  })

  it('slowo Bearer moze byc pisane dowolna wielkoscia liter', () => {
    // Naglowek `Authorization` jest w tym miejscu nieczuly na wielkosc liter
    // wg RFC, a klienty pisza go rozmaicie.
    assert.strictEqual(verifyToken(zadanie({ naglowek: `bearer ${TOKEN}` }), ZMIENNA), true)
    assert.strictEqual(verifyToken(zadanie({ naglowek: `BEARER ${TOKEN}` }), ZMIENNA), true)
  })

  it('nadmiarowe spacje wokol tokenu nie psuja porownania', () => {
    assert.strictEqual(verifyToken(zadanie({ naglowek: `Bearer   ${TOKEN}  ` }), ZMIENNA), true)
  })

  it('token w parametrze adresu tez przechodzi (proste harmonogramy)', () => {
    assert.strictEqual(verifyToken(zadanie({ parametr: TOKEN }), ZMIENNA), true)
  })

  it('naglowek ma PIERWSZENSTWO przed parametrem adresu', () => {
    const zNaglowkiem = (naglowek: string, parametr: string) =>
      new NextRequest(`http://localhost/api/x?token=${parametr}`, {
        headers: { authorization: naglowek },
      } as ConstructorParameters<typeof NextRequest>[1])

    // Dobry naglowek plus zly parametr: przechodzi, bo liczy sie naglowek.
    assert.strictEqual(verifyToken(zNaglowkiem(`Bearer ${TOKEN}`, 'zly'), ZMIENNA), true)

    // Zly naglowek plus DOBRY parametr: NIE przechodzi. To jest wlasciwy dowod
    // pierwszenstwa. Gdyby parametr mogl nadpisac naglowek, doklejenie
    // `?token=` do adresu byloby sposobem na obejscie tego, co niesie zadanie.
    assert.strictEqual(verifyToken(zNaglowkiem('Bearer zly', TOKEN), ZMIENNA), false)
  })

  it('zly token nie przechodzi', () => {
    assert.strictEqual(verifyToken(zadanie({ naglowek: 'Bearer zgadywany' }), ZMIENNA), false)
  })

  it('token o TEJ SAMEJ dlugosci, ale innej tresci, nie przechodzi', () => {
    // Porownanie stalo-czasowe wymaga rownych dlugosci, wiec to jest jedyny
    // przypadek, w ktorym faktycznie dochodzi do porownania bajt po bajcie.
    const podobny = 'poprawny-token-abcdeg'
    assert.strictEqual(podobny.length, TOKEN.length)
    assert.strictEqual(verifyToken(zadanie({ naglowek: `Bearer ${podobny}` }), ZMIENNA), false)
  })

  it('token DLUZSZY i KROTSZY odpadaja bez wyjatku', () => {
    // `timingSafeEqual` RZUCA przy roznych dlugosciach buforow. Brak
    // wczesniejszego sprawdzenia dlugosci konczylby sie bledem 500 zamiast 401.
    assert.strictEqual(verifyToken(zadanie({ naglowek: `Bearer ${TOKEN}x` }), ZMIENNA), false)
    assert.strictEqual(verifyToken(zadanie({ naglowek: 'Bearer x' }), ZMIENNA), false)
  })

  it('token bedacy PREFIKSEM poprawnego nie przechodzi', () => {
    assert.strictEqual(verifyToken(zadanie({ naglowek: 'Bearer poprawny' }), ZMIENNA), false)
  })

  it('brak naglowka i brak parametru -> odmowa', () => {
    assert.strictEqual(verifyToken(zadanie(), ZMIENNA), false)
  })

  it('naglowek BEZ slowa Bearer jest ignorowany', () => {
    // Sam token bez schematu, albo Basic — zadne z nich nie jest tym, czego
    // oczekujemy, wiec nie zgadujemy intencji.
    assert.strictEqual(verifyToken(zadanie({ naglowek: TOKEN }), ZMIENNA), false)
    assert.strictEqual(verifyToken(zadanie({ naglowek: `Basic ${TOKEN}` }), ZMIENNA), false)
  })

  it('pusty token w parametrze -> odmowa', () => {
    assert.strictEqual(verifyToken(zadanie({ parametr: '' }), ZMIENNA), false)
  })

  it('NIEUSTAWIONA zmienna srodowiskowa odmawia WSZYSTKIEGO', () => {
    delete process.env[ZMIENNA]

    // Fail closed. Gdyby brak konfiguracji przepuszczal, wdrozenie bez
    // ustawionej zmiennej otwieraloby crony i panel dla kazdego.
    assert.strictEqual(verifyToken(zadanie({ naglowek: `Bearer ${TOKEN}` }), ZMIENNA), false)
    assert.strictEqual(verifyToken(zadanie({ naglowek: 'Bearer ' }), ZMIENNA), false)
    assert.strictEqual(verifyToken(zadanie(), ZMIENNA), false)
  })

  it('PUSTA zmienna srodowiskowa tez odmawia wszystkiego', () => {
    process.env[ZMIENNA] = ''

    // Pusty ciag jest falsy, wiec traktujemy go jak brak konfiguracji —
    // inaczej `?token=` bez wartosci bylby prawidlowym uwierzytelnieniem.
    assert.strictEqual(verifyToken(zadanie({ parametr: '' }), ZMIENNA), false)
  })
})
