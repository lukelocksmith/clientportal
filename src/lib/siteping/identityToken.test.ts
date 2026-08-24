/**
 * Token tozsamosci: to jest test bezpieczenstwa, nie formatowania.
 *
 * Blad w jedna strone oznacza, ze widget dalej pyta o imie i mail (niewygoda).
 * W druga: mozliwosc podpisania cudzego zgloszenia czyims nazwiskiem, czyli
 * falszywa tozsamosc w zadaniu ClickUp, ktoremu zespol ufa.
 *
 *   npm test
 */
import { describe, it, beforeEach, afterEach } from 'vitest'
import assert from 'node:assert'

const SEKRET = 'testowy-sekret-o-wystarczajacej-dlugosci'

/** Modul czyta env w czasie wywolania, wiec da sie go przelaczac miedzy testami. */
async function modul() {
  return import('@/lib/siteping/identityToken')
}

let poprzedni: string | undefined

beforeEach(() => {
  poprzedni = process.env.JWT_SECRET
  process.env.JWT_SECRET = SEKRET
})

afterEach(() => {
  if (poprzedni === undefined) delete process.env.JWT_SECRET
  else process.env.JWT_SECRET = poprzedni
})

describe('signIdentityToken / verifyIdentityToken', () => {
  it('token przechodzi w obie strony i niesie tozsamosc', async () => {
    const { signIdentityToken, verifyIdentityToken } = await modul()
    const token = await signIdentityToken({ name: 'Anna', email: 'anna@onyx.pl', slug: 'onyx' })
    assert.ok(token, 'token powinien powstac')

    const out = await verifyIdentityToken(token!, 'onyx')
    assert.deepStrictEqual(out, { name: 'Anna', email: 'anna@onyx.pl', slug: 'onyx' })
  })

  it('token WYDANY DLA INNEGO PROJEKTU nie przechodzi', async () => {
    // Bez tego token z portalu jednego klienta dalby sie uzyc na stronie
    // drugiego, a stad krok do podpisania cudzego zgloszenia.
    const { signIdentityToken, verifyIdentityToken } = await modul()
    const token = await signIdentityToken({ name: 'Anna', email: 'anna@onyx.pl', slug: 'onyx' })
    assert.strictEqual(await verifyIdentityToken(token!, 'wdf'), null)
  })

  it('podrobiony token nie przechodzi', async () => {
    const { signIdentityToken, verifyIdentityToken } = await modul()
    const token = await signIdentityToken({ name: 'Anna', email: 'anna@onyx.pl', slug: 'onyx' })
    // Zmiana jednego znaku W SRODKU podpisu, nie na koncu. Podpis HS256 ma 32
    // bajty, czyli 43 znaki base64url, z ktorych OSTATNI nosi bity wypelnienia
    // pomijane przy dekodowaniu. Podmiana ostatniego znaku dawala wiec czasem
    // ten sam podpis po zdekodowaniu i test przechodzil mimo poprawnego kodu:
    // raz na 64 przebiegi calego zestawu (zlapane 2026-08-24).
    const [naglowek, tresc, podpis] = token!.split('.')
    const srodek = Math.floor(podpis.length / 2)
    const zepsutyPodpis = podpis.slice(0, srodek) + (podpis[srodek] === 'a' ? 'b' : 'a') + podpis.slice(srodek + 1)
    const zepsuty = `${naglowek}.${tresc}.${zepsutyPodpis}`
    assert.strictEqual(await verifyIdentityToken(zepsuty, 'onyx'), null)
  })

  it('token podpisany INNYM sekretem nie przechodzi', async () => {
    // Modul czyta JWT_SECRET przy KAZDYM wywolaniu, nie raz przy imporcie,
    // wiec podmiana zmiennej miedzy podpisaniem a weryfikacja wystarczy —
    // nie trzeba przeladowywac modulu.
    const { signIdentityToken, verifyIdentityToken } = await modul()
    const token = await signIdentityToken({ name: 'Anna', email: 'anna@onyx.pl', slug: 'onyx' })

    process.env.JWT_SECRET = 'zupelnie-inny-sekret-tez-dosc-dlugi'
    assert.strictEqual(
      await verifyIdentityToken(token!, 'onyx'),
      null,
      'token podpisany starym sekretem nie moze przejsc po jego zmianie'
    )
  })

  it('smieci zamiast tokenu nie wywalaja weryfikacji', async () => {
    const { verifyIdentityToken } = await modul()
    for (const smiec of ['', 'abc', 'a.b.c', '{}', 'null']) {
      assert.strictEqual(await verifyIdentityToken(smiec, 'onyx'), null, `smiec: ${smiec}`)
    }
  })

  it('brak imienia jest dozwolony, brak maila nie', async () => {
    // Zaproszenie moglo pojsc bez imienia; adres jest zawsze.
    const { signIdentityToken, verifyIdentityToken } = await modul()
    const token = await signIdentityToken({ name: null, email: 'x@onyx.pl', slug: 'onyx' })
    const out = await verifyIdentityToken(token!, 'onyx')
    assert.strictEqual(out?.name, null)
    assert.strictEqual(out?.email, 'x@onyx.pl')
  })
})

describe('brak sekretu', () => {
  it('nie wywala portalu, tylko wylacza podstawianie', async () => {
    // Portal ma dzialac dalej, a widget zapytac o tozsamosc jak dotad.
    delete process.env.JWT_SECRET
    const { signIdentityToken, verifyIdentityToken, isIdentityTokenConfigured } = await modul()
    assert.strictEqual(isIdentityTokenConfigured(), false)
    assert.strictEqual(await signIdentityToken({ name: 'A', email: 'a@b.pl', slug: 'onyx' }), null)
    assert.strictEqual(await verifyIdentityToken('cokolwiek', 'onyx'), null)
  })

  it('sekret za krotki liczy sie jak brak', async () => {
    // Krotki sekret daje zludzenie ochrony. Lepiej wylaczyc funkcje.
    process.env.JWT_SECRET = 'krotki'
    const { isIdentityTokenConfigured } = await modul()
    assert.strictEqual(isIdentityTokenConfigured(), false)
  })
})
