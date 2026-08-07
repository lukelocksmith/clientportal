import { describe, it, beforeEach, vi } from 'vitest'
import assert from 'node:assert'
import bcrypt from 'bcryptjs'

/**
 * Blokada konta po nieudanych probach.
 *
 * Trasy logowania maja juz swoje testy tej blokady (piec pomylek blokuje,
 * poprawne haslo zeruje licznik, zablokowane konto odmawia takze przy dobrym
 * hasle). Tutaj sa przypadki, do ktorych przez trase sie nie dojdzie, bo
 * wymagaja przesuniecia czasu albo stanu, ktorego formularz nie wytworzy:
 *
 *   - blokada, ktora WYGASLA, ma przepuscic,
 *   - licznik ma rosnac o jeden przy kazdej pomylce, takze z null,
 *   - blokada zaklada sie DOKLADNIE na progu, nie wczesniej i nie pozniej.
 *
 * `db` jest podstawione, zeby zobaczyc DOKLADNIE, jakie wartosci modul zapisuje
 * — na prawdziwej bazie widac tylko skutek, a nie roznice miedzy „zapisal null"
 * a „nie ruszyl kolumny".
 *
 *   npx vitest run src/lib/loginAttempts.test.ts
 */
const { db, drizzle } = vi.hoisted(() => ({
  db: { update: vi.fn() },
  drizzle: { eq: vi.fn() },
}))

vi.mock('./db', () => ({ db }))
vi.mock('drizzle-orm', () => drizzle)

import { verifyUserPassword, MAX_ATTEMPTS, LOCKOUT_MINUTES } from './loginAttempts'

const HASLO = 'poprawne-haslo'
const HASH = bcrypt.hashSync(HASLO, 4)

/**
 * Ostatnie wartosci przekazane do `set()`.
 *
 * Typ `unknown` wymagalby rzutowania przy kazdym `instanceof`, wiec kolumny,
 * ktore sprawdzamy, sa tu nazwane wprost.
 */
let zapisane: { failedAttempts?: number; lockedUntil?: Date | null } | undefined

beforeEach(() => {
  vi.clearAllMocks()
  zapisane = undefined
  db.update.mockReturnValue({
    set: (wartosci: { failedAttempts?: number; lockedUntil?: Date | null }) => {
      zapisane = wartosci
      return { where: () => Promise.resolve() }
    },
  })
})

/**
 * Czy zapisano date blokady. Osobno, bo `instanceof` na typie
 * `Date | null | undefined` nie przechodzi przez TypeScript.
 */
function zablokowanoDo(): Date | null {
  const wartosc = zapisane?.lockedUntil
  return wartosc ? wartosc : null
}

const konto = (nadpisz: Partial<{ failedAttempts: number | null; lockedUntil: Date | null }> = {}) => ({
  id: 'user-1',
  passwordHash: HASH,
  failedAttempts: 0,
  lockedUntil: null,
  ...nadpisz,
})

describe('verifyUserPassword', () => {
  it('poprawne haslo przechodzi i ZERUJE licznik', async () => {
    const wynik = await verifyUserPassword(konto({ failedAttempts: 3 }), HASLO)

    assert.strictEqual(wynik, 'ok')
    assert.deepStrictEqual(zapisane, { failedAttempts: 0, lockedUntil: null })
  })

  it('zle haslo podnosi licznik o jeden', async () => {
    const wynik = await verifyUserPassword(konto({ failedAttempts: 2 }), 'zle')

    assert.strictEqual(wynik, 'bad')
    assert.strictEqual(zapisane?.failedAttempts, 3)
    assert.strictEqual(zapisane?.lockedUntil, null, 'ponizej progu blokady nie ma')
  })

  it('licznik NULL liczy sie jak zero', async () => {
    // Konta zalozone przed dodaniem tej kolumny maja tam null. Bez tego
    // `null + 1` dalby NaN i blokada nigdy by sie nie zalozyla.
    await verifyUserPassword(konto({ failedAttempts: null }), 'zle')

    assert.strictEqual(zapisane?.failedAttempts, 1)
  })

  it(`blokada zaklada sie DOKLADNIE przy ${MAX_ATTEMPTS} probie`, async () => {
    await verifyUserPassword(konto({ failedAttempts: MAX_ATTEMPTS - 2 }), 'zle')
    assert.strictEqual(zapisane?.lockedUntil, null, 'jedna proba przed progiem: bez blokady')

    await verifyUserPassword(konto({ failedAttempts: MAX_ATTEMPTS - 1 }), 'zle')
    assert.ok(zablokowanoDo(), 'na progu: blokada')
  })

  it(`blokada trwa ${LOCKOUT_MINUTES} minut, liczone od teraz`, async () => {
    const przed = Date.now()
    await verifyUserPassword(konto({ failedAttempts: MAX_ATTEMPTS - 1 }), 'zle')
    const po = Date.now()

    const doKiedy = zablokowanoDo()!.getTime()
    assert.ok(doKiedy >= przed + LOCKOUT_MINUTES * 60_000)
    assert.ok(doKiedy <= po + LOCKOUT_MINUTES * 60_000)
  })

  it('AKTYWNA blokada odmawia BEZ sprawdzania hasla', async () => {
    const zablokowane = konto({ lockedUntil: new Date(Date.now() + 60_000) })

    const wynik = await verifyUserPassword(zablokowane, HASLO)

    // Poprawne haslo, a mimo to 'locked'. Gdyby konto zablokowane odpowiadalo
    // inaczej na dobre i zle haslo, blokada bylaby wygodnym potwierdzeniem,
    // ze zgadywane haslo jest tym wlasciwym.
    assert.strictEqual(wynik, 'locked')
    assert.strictEqual(db.update.mock.calls.length, 0, 'nie ruszamy licznika przy blokadzie')
  })

  it('WYGASLA blokada przepuszcza poprawne haslo i czysci stan', async () => {
    const poBlokadzie = konto({ lockedUntil: new Date(Date.now() - 1000), failedAttempts: MAX_ATTEMPTS })

    const wynik = await verifyUserPassword(poBlokadzie, HASLO)

    // To jest przypadek, do ktorego przez formularz nie da sie dojsc bez
    // czekania kwadransa. Blokada, ktora nie wygasa, jest trwalym odcieciem
    // klienta od portalu.
    assert.strictEqual(wynik, 'ok')
    assert.deepStrictEqual(zapisane, { failedAttempts: 0, lockedUntil: null })
  })

  it('WYGASLA blokada przy ZLYM hasle liczy od nowa, nie od progu', async () => {
    const poBlokadzie = konto({ lockedUntil: new Date(Date.now() - 1000), failedAttempts: MAX_ATTEMPTS })

    const wynik = await verifyUserPassword(poBlokadzie, 'zle')

    assert.strictEqual(wynik, 'bad')
    // Licznik idzie dalej w gore, wiec kolejna pomylka blokuje natychmiast.
    // To jest swiadome: konto po serii pomylek nie dostaje pelnej puli od zera.
    assert.strictEqual(zapisane?.failedAttempts, MAX_ATTEMPTS + 1)
    assert.ok(zablokowanoDo(), 'i blokada wraca')
  })

  it('blokada wygasajaca DOKLADNIE teraz juz nie obowiazuje', async () => {
    // Warunek to `lockedUntil > new Date()`, wiec chwila rowna granicy
    // przepuszcza. Granica musi byc jednoznaczna, zeby nie bylo sekundy,
    // w ktorej zachowanie zalezy od szybkosci maszyny.
    const wynik = await verifyUserPassword(konto({ lockedUntil: new Date(Date.now() - 1) }), HASLO)

    assert.strictEqual(wynik, 'ok')
  })
})
