import { describe, it } from 'vitest'
import assert from 'node:assert'
import {
  missingTags,
  detectWidget,
  parseSiteDomains,
  checkUrl,
  isAllowedRedirect,
  widgetVerdict,
  describeFetchError,
  REQUIRED_TAGS,
} from './check'

/**
 * Logika testu polaczenia SitePinga.
 *
 * Ten test odpowiada na pytanie „czemu klientowi nie dziala", wiec jego wlasny
 * blad jest kosztowny w obie strony: falszywy alarm wysyla zespol szukac
 * nieistniejacego problemu, falszywe „ok" zamyka sprawe, ktora zostaje otwarta.
 * Stad nacisk na trzeci stan (`unknown`) w kazdej grupie ponizej.
 *
 *   npx vitest run src/lib/siteping/check.test.ts
 */

describe('missingTags', () => {
  it('wymaga PIECIU tagow, nie samego `siteping`', () => {
    // Kazde zadanie dostaje dwa tagi: `siteping` + rodzaj. Brak `zmiana` psuje
    // filtrowanie tak samo jak brak `siteping`, tylko ciszej.
    assert.deepStrictEqual([...REQUIRED_TAGS], ['siteping', 'błąd', 'zmiana', 'pytanie', 'inne'])
  })

  it('komplet tagow daje pusta liste', () => {
    assert.deepStrictEqual(missingTags([...REQUIRED_TAGS, 'cokolwiek-innego']), [])
  })

  it('wskazuje dokladnie brakujace, nie wszystkie', () => {
    assert.deepStrictEqual(missingTags(['siteping', 'błąd']), ['zmiana', 'pytanie', 'inne'])
  })

  it('roznica wielkosci liter i spacje NIE sa brakiem tagu', () => {
    // ClickUp zwraca nazwy tak, jak ktos je wpisal. „SitePing " to ten sam tag.
    assert.deepStrictEqual(missingTags(['SitePing ', 'BŁĄD', ' zmiana', 'Pytanie', 'INNE']), [])
  })

  it('`blad` bez ogonkow to INNY tag, nie `błąd`', () => {
    // Zadanie dostaje tag z `feedbackKindTags`, czyli z ogonkami. Uznanie
    // `blad` za rownowazny konczy sie „test przechodzi, tag i tak znika".
    assert.deepStrictEqual(missingTags(['siteping', 'blad', 'zmiana', 'pytanie', 'inne']), ['błąd'])
  })

  it('pusta przestrzen zwraca komplet', () => {
    assert.strictEqual(missingTags([]).length, REQUIRED_TAGS.length)
  })
})

describe('detectWidget', () => {
  it('rozpoznaje adres bundla z portalu', () => {
    assert.ok(detectWidget('<script src="https://portal.important.is/siteping/widget.js"></script>'))
  })

  it('rozpoznaje samo wywolanie inicjujace', () => {
    // Strona moze serwowac bundle spod innego adresu (kopia u siebie, GTM),
    // ale wywolanie `initSiteping` jest w kazdym wariancie osadzenia.
    assert.ok(detectWidget('<script>window.SitePing.initSiteping({endpoint:"..."})</script>'))
  })

  it('nie zglasza widgetu na stronie, ktora go nie ma', () => {
    assert.strictEqual(detectWidget('<html><body><h1>Strona klienta</h1></body></html>'), false)
  })

  it('samo slowo „siteping" w tresci strony NIE wystarcza', () => {
    // Inaczej artykul na blogu o naszym narzedziu dawalby zielone „dziala".
    assert.strictEqual(detectWidget('<p>Wdrożyliśmy SitePing u klienta</p>'), false)
  })

  it('wielkosc liter nie ma znaczenia', () => {
    assert.ok(detectWidget('<SCRIPT SRC="/SitePing/Widget.JS"></SCRIPT>'))
  })
})

describe('parseSiteDomains', () => {
  it('rozdziela po przecinku i przycina', () => {
    assert.deepStrictEqual(parseSiteDomains('wodadlafirmy.pl,  wdf.important.is '), [
      'wodadlafirmy.pl',
      'wdf.important.is',
    ])
  })

  it('ZACHOWUJE port', () => {
    // Bez portu adres testowy prowadzi donikad, a lokalne sprawdzenie przed
    // wdrozeniem u klienta jest jedynym, jakie mamy.
    assert.deepStrictEqual(parseSiteDomains('localhost:5500'), ['localhost:5500'])
  })

  it('obcina schemat i sciezke wpisana przez pomylke', () => {
    assert.deepStrictEqual(parseSiteDomains('https://demo.pl/kontakt'), ['demo.pl'])
  })

  it('puste pole daje pusta liste, nie wpis pusty', () => {
    assert.deepStrictEqual(parseSiteDomains(null), [])
    assert.deepStrictEqual(parseSiteDomains('  ,  '), [])
  })
})

describe('checkUrl', () => {
  it('ZAWSZE dokleja ?siteping=1', () => {
    // Bez tego parametru mu-plugin nie osadzi widgetu i test dalby „nie ma"
    // u KAZDEGO poprawnie skonfigurowanego klienta.
    assert.match(checkUrl('demo.pl'), /\?siteping=1$/)
  })

  it('host publiczny idzie po https', () => {
    assert.strictEqual(checkUrl('demo.pl'), 'https://demo.pl/?siteping=1')
  })

  it('host lokalny idzie po http, razem z portem', () => {
    // https://localhost konczy sie odmowa polaczenia — nic nie nasluchuje na 443.
    assert.strictEqual(checkUrl('localhost:5500'), 'http://localhost:5500/?siteping=1')
  })

  it('nie niesie tokenu tozsamosci', () => {
    assert.ok(!checkUrl('demo.pl').includes('sp_token'))
  })
})

describe('isAllowedRedirect', () => {
  const domeny = ['demo.pl', 'wdf.important.is']

  it('przepuszcza http → https na tym samym hoscie', () => {
    assert.ok(isAllowedRedirect('https://demo.pl/', domeny))
  })

  it('przepuszcza dopisanie www', () => {
    // demo.pl → www.demo.pl to najczestsze przekierowanie w internecie.
    assert.ok(isAllowedRedirect('https://www.demo.pl/', domeny))
  })

  it('przepuszcza tez zdjecie www', () => {
    assert.ok(isAllowedRedirect('https://demo.pl/', ['www.demo.pl']))
  })

  it('ZATRZYMUJE przekierowanie poza allowliste', () => {
    // Test wychodzi na cudza infrastrukture; bez tej granicy klikniecie
    // admina moze zostac poprowadzone gdziekolwiek.
    assert.strictEqual(isAllowedRedirect('https://kto-to.example/', domeny), false)
  })

  it('podobna nazwa NIE wystarcza', () => {
    assert.strictEqual(isAllowedRedirect('https://demo.pl.zly-host.example/', domeny), false)
  })

  it('smiec zamiast adresu to odmowa, nie wyjatek', () => {
    assert.strictEqual(isAllowedRedirect('/gdzies', domeny), false)
    assert.strictEqual(isAllowedRedirect('', domeny), false)
  })

  it('port w konfiguracji nie blokuje przekierowania', () => {
    assert.ok(isAllowedRedirect('http://localhost:5500/', ['localhost:5500']))
  })
})

describe('describeFetchError', () => {
  /** Tak wyglada blad sieci z `fetch` w Node: powod siedzi w `cause`. */
  const sieciowy = (code: string) => Object.assign(new Error('fetch failed'), { cause: { code } })

  it('tlumaczy „fetch failed" na powod, ktory cos znaczy', () => {
    // Node zwraca „fetch failed" dla WSZYSTKIEGO: literowki w domenie,
    // wygaslego certyfikatu i wylaczonego serwera. Kazde z nich naprawia sie
    // inaczej i kto inny, wiec ten komunikat rozstrzyga, do kogo pisac.
    assert.strictEqual(describeFetchError(sieciowy('ENOTFOUND')), 'domena nie istnieje w DNS')
    assert.strictEqual(describeFetchError(sieciowy('ECONNREFUSED')), 'serwer odrzucił połączenie')
    assert.strictEqual(describeFetchError(sieciowy('CERT_HAS_EXPIRED')), 'wygasł certyfikat strony')
  })

  it('nieznany kod pokazuje surowo, zamiast go gubic', () => {
    // Lepiej „EPROTO" niz „nieznany blad": po tym da sie chociaz poszukac.
    assert.strictEqual(describeFetchError(sieciowy('EPROTO')), 'EPROTO')
  })

  it('przerwanie po czasie nazywa po ludzku, nie „TimeoutError"', () => {
    const t = new Error('The operation was aborted')
    t.name = 'TimeoutError'
    assert.strictEqual(describeFetchError(t, 5000), 'brak odpowiedzi w 5 s')
  })

  it('zwykly blad pokazuje swoja tresc, ale przycieta', () => {
    assert.strictEqual(describeFetchError(new Error('coś padło')), 'coś padło')
    assert.ok(describeFetchError(new Error('x'.repeat(500))).length <= 120)
  })

  it('rzecz, ktora nie jest bledem, nie wywala sprawdzenia', () => {
    assert.strictEqual(describeFetchError('napis'), 'nieznany błąd')
    assert.strictEqual(describeFetchError(null), 'nieznany błąd')
  })
})

describe('widgetVerdict', () => {
  const teraz = new Date('2026-08-11T10:00:00Z')
  const wczoraj = new Date('2026-08-10T10:00:00Z')

  it('skrypt widoczny to `ok`', () => {
    const w = widgetVerdict({ htmlHasWidget: true, lastFeedbackAt: null, now: teraz })
    assert.strictEqual(w.state, 'ok')
  })

  it('skryptu nie ma i nigdy nic nie przyszlo — dopiero to jest `fail`', () => {
    const w = widgetVerdict({ htmlHasWidget: false, lastFeedbackAt: null, now: teraz })
    assert.strictEqual(w.state, 'fail')
  })

  it('skryptu nie widac, ale zgloszenia byly — `unknown`, NIE `fail`', () => {
    // To jest granica metody, nie awaria: widget wstrzykiwany przez GTM albo
    // renderowany w przegladarce nie pojawi sie w pobranym HTML. Krzyzyk
    // wyslalby zespol naprawiac cos, co dziala.
    const w = widgetVerdict({ htmlHasWidget: false, lastFeedbackAt: wczoraj, now: teraz })
    assert.strictEqual(w.state, 'unknown')
    assert.match(w.detail, /przeglądarki/)
  })

  it('nieudane pobranie to `unknown`, NIGDY `fail`', () => {
    // Strona nie odpowiedziala. O widgecie nie wiemy niczego — ani ze jest,
    // ani ze go nie ma.
    const w = widgetVerdict({
      htmlHasWidget: null,
      lastFeedbackAt: null,
      fetchError: 'przekroczony czas',
      now: teraz,
    })
    assert.strictEqual(w.state, 'unknown')
    assert.match(w.detail, /przekroczony czas/)
  })

  it('przy nieudanym pobraniu historia zgloszen nadal trafia do komunikatu', () => {
    // To jedyny sygnal, jaki wtedy zostaje, i akurat wtedy jest najcenniejszy.
    const w = widgetVerdict({ htmlHasWidget: null, lastFeedbackAt: wczoraj, now: teraz })
    assert.strictEqual(w.state, 'unknown')
    assert.match(w.detail, /wczoraj/)
  })

  it('komunikat mowi KIEDY przyszlo ostatnie zgloszenie', () => {
    const w = widgetVerdict({ htmlHasWidget: true, lastFeedbackAt: wczoraj, now: teraz })
    assert.match(w.detail, /wczoraj/)

    const stare = widgetVerdict({
      htmlHasWidget: true,
      lastFeedbackAt: new Date('2026-08-08T10:00:00Z'),
      now: teraz,
    })
    assert.match(stare.detail, /3 dni temu/)
  })

  it('kazdy wynik ma niepusty opis', () => {
    // Sam kolor bez zdania nie odpowiada na pytanie „no dobrze, a co teraz".
    for (const html of [true, false, null] as const) {
      for (const last of [null, wczoraj]) {
        const w = widgetVerdict({ htmlHasWidget: html, lastFeedbackAt: last, now: teraz })
        assert.ok(w.detail.length > 0, `pusty opis dla html=${html} last=${last}`)
      }
    }
  })
})
