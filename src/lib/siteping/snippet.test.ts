import { describe, it } from 'vitest'
import assert from 'node:assert'
import { buildHtmlSnippet, buildWordPressSnippet } from './snippet'

/**
 * Kod osadzenia generowany dla klienta.
 *
 * Ten tekst ktos skopiuje i wklei na cudza strone produkcyjna, zwykle NIE
 * czytajac go w calosci. Blad tutaj nie wywala testow ani buildu — objawia sie
 * dopiero tym, ze zgloszenia nie dochodza, a nikt nie wie dlaczego. Stad testy
 * na rzeczy, ktore w innym miejscu bylyby przesada.
 *
 *   npx vitest run src/lib/siteping/snippet.test.ts
 */
const WEJSCIE = { slug: 'wdf', appUrl: 'https://portal.important.is' }

describe('buildHtmlSnippet', () => {
  it('niesie adres widgetu i endpoint z wypelnionym slugiem', () => {
    const s = buildHtmlSnippet(WEJSCIE)

    assert.match(s, /src="https:\/\/portal\.important\.is\/siteping\/widget\.js"/)
    assert.match(s, /endpoint: 'https:\/\/portal\.important\.is\/api\/siteping\/wdf'/)
    assert.match(s, /projectName: 'wdf'/)
  })

  it('ZAWSZE ma deepLink: true', () => {
    // Bez tego link „Zobacz na stronie" z zadania w ClickUpie otwiera strone
    // i niczego nie podswietla — czyli cala wartosc zaznaczania znika,
    // a nikt nie zglosi tego jako bledu, bo strona sie otwiera.
    assert.match(buildHtmlSnippet(WEJSCIE), /deepLink:\s*true/)
  })

  it('uzywa wielkiego P w window.SitePing', () => {
    // Globalna nazwa w bundlu IIFE. Mala litera daje `undefined is not
    // a function` dopiero w przegladarce klienta.
    assert.ok(buildHtmlSnippet(WEJSCIE).includes('window.SitePing.initSiteping'))
  })

  it('ukosnik na koncu adresu portalu nie daje podwojnego', () => {
    const s = buildHtmlSnippet({ slug: 'wdf', appUrl: 'https://portal.important.is/' })

    assert.ok(!s.includes('is//siteping'))
    assert.ok(!s.includes('is//api'))
  })

  it('mowi wprost, ze captureDiagnostics mozna usunac', () => {
    // To zbieranie konsoli CUDZEJ strony. Decyzja nalezy do klienta, wiec
    // instrukcja musi pokazac, jak z tego zrezygnowac.
    assert.match(buildHtmlSnippet(WEJSCIE), /Usuń tę linię/)
  })
})

describe('buildWordPressSnippet', () => {
  const s = buildWordPressSnippet(WEJSCIE)

  it('jest wtyczka mu-plugin, nie fragmentem motywu', () => {
    // mu-plugins przezywaja zmiane i aktualizacje motywu. Kod w functions.php
    // znika przy pierwszym podmienieniu szablonu i nikt tego nie zauwazy.
    assert.match(s, /Plugin Name: SitePing \(wdf\)/)
    assert.match(s, /mu-plugins/)
  })

  it('osadza widget WARUNKOWO, po parametrze w adresie', () => {
    // Bez tego przycisk zglaszania widzi kazdy odwiedzajacy — otwarta droga
    // spamu prosto do ClickUpa.
    assert.match(s, /isset\(\$_GET\['siteping'\]\)/)
  })

  it('wymienia token PO STRONIE SERWERA, nie w JavaScripcie', () => {
    // Gdyby token szedl przez front, odczytalby go dowolny inny skrypt na
    // stronie klienta: analityka, GTM, wtyczki.
    assert.match(s, /wp_remote_get/)
    assert.match(s, /api\/siteping\/identity/)
    assert.ok(!/fetch\(/.test(s), 'zadnego fetch po stronie przegladarki')
  })

  it('token jest odkazany przed uzyciem', () => {
    assert.match(s, /sanitize_text_field/)
  })

  it('sprawdza kod odpowiedzi, a nie tylko brak bledu', () => {
    // `!is_wp_error` przepuszcza takze 401 i 500. Bez sprawdzenia kodu
    // widget dostalby tresc bledu jako tozsamosc.
    assert.match(s, /wp_remote_retrieve_response_code/)
  })

  it('nieudana wymiana tokenu NIE blokuje widgetu', () => {
    // Widget ma sie pokazac takze wtedy — po prostu zapyta o imie i mail.
    // Brak widgetu bylby gorszy niz brak podstawionej tozsamosci.
    assert.match(s, /\$identity = null/)
    assert.match(s, /if \(\$identity\)/)
  })

  it('ma limit czasu na zapytanie do portalu', () => {
    // Bez limitu niedostepny portal zawiesza renderowanie STRONY KLIENTA.
    assert.match(s, /'timeout' => \d+/)
  })

  it('konfiguracja idzie przez wp_json_encode, nie sklejanie napisow', () => {
    assert.match(s, /wp_json_encode/)
  })

  it('ZAWSZE ma deepLink', () => {
    assert.match(s, /'deepLink'\s*=>\s*true/)
  })

  it('doklada token jako Authorization, nie do identity', () => {
    // `[slug]/route.ts` weryfikuje ten token PONOWNIE (podpis + slug), zeby
    // odblokowac zgloszenie jako admin@important.is — bez tego naglowka
    // Łukasz nie moze przetestowac wlasnego flow z panelu (store.ts).
    assert.match(s, /\$config\['headers'\]\s*=\s*\['Authorization' => 'Bearer ' \. \$identity\['token'\]\]/)
    assert.match(s, /if \(!empty\(\$identity\['token'\]\)\)/)
    // identity samo w sobie ograniczone do imienia i maila, token NIE trafia tam
    assert.match(s, /\$config\['identity'\] = \['name' => \$identity\['name'\], 'email' => \$identity\['email'\]\]/)
  })
})

describe('oba warianty', () => {
  it('nie zawieraja tokenu ani danych osobowych', () => {
    // W adresie jedzie TOKEN, nigdy imie i mail. Snippet jest generowany raz
    // i wklejany na stale, wiec nie moze niczego takiego niesc.
    for (const s of [buildHtmlSnippet(WEJSCIE), buildWordPressSnippet(WEJSCIE)]) {
      assert.ok(!/@\w+\.\w+/.test(s.replace(/important\.is/g, '')), 'brak adresow e-mail')
    }
  })

  it('slug trafia wszedzie, gdzie trzeba', () => {
    const inny = { slug: 'onyx', appUrl: 'https://portal.important.is' }

    for (const s of [buildHtmlSnippet(inny), buildWordPressSnippet(inny)]) {
      assert.match(s, /siteping\/onyx/, 'endpoint niesie slug')
      assert.ok(!s.includes('wdf'), 'zaden slad po innym projekcie')
    }
  })
})
