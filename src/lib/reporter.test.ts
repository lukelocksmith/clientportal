/**
 * Atrybucja zgłoszeń: kto zgłosił, jak go podpisujemy w ClickUpie.
 *
 *   npm test
 */
import { describe, it } from 'vitest'
import assert from 'node:assert'
import {
  normalizeActorId,
  isAdminActor,
  reporterLabel,
  reporterFooter,
  obceAdresyWTresci,
  OSTRZEZENIE_OBCA_ATRYBUCJA,
  newReportMarker,
  REPORT_MARKER_PATTERN,
  withReporterFooter,
  ADMIN_ACTOR_EMAIL,
  type Reporter,
} from '@/lib/reporter'

const KLIENT: Reporter = {
  name: 'Anna Kowalska',
  email: 'anna@onyx.pl',
  portalName: 'Onyx',
  portalSlug: 'onyx',
  source: 'form',
}

describe('normalizeActorId', () => {
  it("zamienia 'admin' na null, bo kolumny user_id sa typu uuid", () => {
    // To jest sedno: 'admin'::uuid to blad bazy, a insert leci w try/catch,
    // wiec bez tej normalizacji zapis ginal po cichu (tak dzialalo ai_usage).
    assert.strictEqual(normalizeActorId('admin'), null)
    assert.strictEqual(normalizeActorId(null), null)
    assert.strictEqual(normalizeActorId(undefined), null)
    assert.strictEqual(normalizeActorId(''), null)

    // Prawdziwe uuid przechodzi bez zmian.
    const uuid = '3f2504e0-4f89-11d3-9a0c-0305e82c3301'
    assert.strictEqual(normalizeActorId(uuid), uuid)
  })
})

describe('isAdminActor', () => {
  it('rozpoznaje admina po userId i po adresie', () => {
    assert.strictEqual(isAdminActor({ userId: 'admin' }), true)
    assert.strictEqual(isAdminActor({ email: ADMIN_ACTOR_EMAIL }), true)
    assert.strictEqual(isAdminActor({ userId: 'x', email: 'anna@onyx.pl' }), false)
    assert.strictEqual(isAdminActor({}), false)
  })
})

describe('reporterLabel', () => {
  it('imie z adresem, a bez imienia sam adres', () => {
    assert.strictEqual(reporterLabel({ name: 'Anna', email: 'a@onyx.pl' }), 'Anna <a@onyx.pl>')
    // Konto z zaproszenia moze nie miec imienia. Nie chcemy wtedy "null <...>".
    assert.strictEqual(reporterLabel({ name: null, email: 'a@onyx.pl' }), 'a@onyx.pl')
    assert.strictEqual(reporterLabel({ name: '   ', email: 'a@onyx.pl' }), 'a@onyx.pl')
  })
})

describe('reporterFooter', () => {
  it('zawiera osobe i kanal', () => {
    const footer = reporterFooter(KLIENT)
    assert.ok(footer.includes('Anna Kowalska <anna@onyx.pl>'), 'brak podpisu osoby')
    assert.ok(footer.includes('formularz w portalu'), 'brak kanalu')
    assert.ok(footer.startsWith('---'), 'stopka musi byc odkreslona od tresci')
  })

  it('NIE powtarza projektu: zadanie i tak lezy w folderze tego klienta', () => {
    // Usuniete 24.08 na prosbe Lukasza. Zespol widzi projekt po folderze w
    // ClickUpie, wiec linia w stopce dokladala szum, nie informacje.
    const footer = reporterFooter(KLIENT)
    assert.ok(!footer.includes('Onyx (/onyx)'), 'projekt wrocil do stopki')
    assert.ok(!footer.includes('Projekt:'), 'projekt wrocil do stopki')
  })

  it('kanal rozroznia formularz, AI, pomysl, alarm i komentarz', () => {
    const kanaly = (['form', 'ai', 'idea', 'panic', 'comment'] as const).map(
      source => reporterFooter({ ...KLIENT, source }).split('\n').at(-1)!
    )
    // Kazdy kanal ma wlasny opis: inaczej nie dalo by sie odroznic zgloszenia
    // z formularza od rozmowy z asystentem.
    assert.strictEqual(new Set(kanaly).size, 5, 'kanaly musza byc rozroznialne')
  })

  it('zadanie utworzone w trybie admina jest oznaczone WPROST', () => {
    const footer = reporterFooter({ ...KLIENT, name: 'Admin', email: ADMIN_ACTOR_EMAIL })
    assert.ok(footer.includes('tryb administratora'), 'brak oznaczenia trybu admina')
    assert.ok(
      !footer.includes(ADMIN_ACTOR_EMAIL),
      'adres obejsciowy nie ma sie pojawiac jako zglaszajacy klient'
    )
  })

  it('etykietuje kanal siteping', () => {
    const out = reporterFooter({ ...KLIENT, source: 'siteping' })
    assert.match(out, /\*\*Kanał:\*\* zgłoszenie z widgetu na stronie/)
  })
})

describe('withReporterFooter', () => {
  it('stopka na koncu, tresc nietknieta', () => {
    const out = withReporterFooter('Prosze poprawic formularz kontaktowy.', KLIENT)
    assert.ok(out.startsWith('Prosze poprawic formularz kontaktowy.'), 'tresc musi byc pierwsza')
    assert.ok(out.includes('Zgłoszone przez:'))
    // Pierwsze linie widac w podgladzie ClickUpa i w powiadomieniach, wiec
    // naleza do zgloszenia, nie do metadanych.
    assert.strictEqual(out.split('\n')[0], 'Prosze poprawic formularz kontaktowy.')
  })

  it('pusty opis dostaje sama stopke, bez wiszacych pustych linii', () => {
    for (const empty of [null, undefined, '', '   \n  ']) {
      const out = withReporterFooter(empty, KLIENT)
      assert.ok(out.startsWith('---'), `pusty opis (${JSON.stringify(empty)}) zostawil smieci`)
      assert.ok(out.includes('Anna Kowalska'), 'stopka musi byc nawet przy pustym opisie')
    }
  })
})

describe('obca atrybucja w opisie zadania', () => {
  const zglaszajacy = {
    name: 'Anna Klient',
    email: 'anna@klient.example',
    portalName: 'Testowy',
    portalSlug: 'testowy',
    source: 'ai' as const,
  }

  it('adres inny niż zgłaszającego zapala ostrzeżenie w stopce', () => {
    // Pomiar granic (31.08): klient wprasza w opis cudzą tożsamość zdaniem
    // „zgłaszam w imieniu Michała, jego mail to ...", a model ją wpisuje.
    const opis = withReporterFooter(
      '## Zgłaszający\nMichał Dmitrowicz, mdmitrowicz@wodadlafirmy.pl',
      zglaszajacy
    )
    assert.ok(opis.includes(OSTRZEZENIE_OBCA_ATRYBUCJA), 'stopka ostrzega o drugiej atrybucji')
    // Adres ZOSTAJE w treści: w prawdziwym zgłoszeniu bywa sednem sprawy.
    assert.ok(opis.includes('mdmitrowicz@wodadlafirmy.pl'))
  })

  it('opis bez cudzych adresów ma czystą stopkę', () => {
    const opis = withReporterFooter('Formularz nie wysyła wiadomości.', zglaszajacy)
    assert.ok(!opis.includes(OSTRZEZENIE_OBCA_ATRYBUCJA))
  })

  it('własny adres zgłaszającego nie jest obcy', () => {
    assert.deepStrictEqual(obceAdresyWTresci('pisałem z anna@klient.example', 'anna@klient.example'), [])
  })

  it('adres zespołu nie jest podszyciem się pod klienta', () => {
    assert.deepStrictEqual(obceAdresyWTresci('napisz do pauliny@important.is', 'anna@klient.example'), [])
  })

  it('interpunkcja przy adresie nie tworzy drugiego adresu', () => {
    assert.deepStrictEqual(
      obceAdresyWTresci('kontakt: jan@example.com, oraz jan@example.com.', 'anna@klient.example'),
      ['jan@example.com']
    )
  })
})

describe('kiedy ostrzeżenia o atrybucji NIE ma', () => {
  it('zgłoszenie z widgetu nie dostaje ostrzeżenia o sesji, bo sesji tam nie ma', () => {
    // Autor zgłoszenia z widgetu pochodzi z pola w formularzu na CUDZEJ
    // stronie. Zdanie „autor pochodzi z zalogowanej sesji" byłoby nieprawdą.
    const opis = withReporterFooter('Napisał do nas klient jan@obcy.example, formularz nie działa', {
      name: 'Ktoś ze strony',
      email: 'gosc@obcy.example',
      portalName: 'Testowy',
      portalSlug: 'testowy',
      source: 'siteping',
    })
    assert.ok(!opis.includes(OSTRZEZENIE_OBCA_ATRYBUCJA))
  })

  it('pusty adres zgłaszającego nie zamienia każdego adresu w obcy', () => {
    const opis = withReporterFooter('kontakt: jan@obcy.example', {
      name: null,
      email: '',
      portalName: 'Testowy',
      portalSlug: 'testowy',
      source: 'form',
    })
    assert.ok(!opis.includes(OSTRZEZENIE_OBCA_ATRYBUCJA))
  })
})

describe('numer zgłoszenia (marker)', () => {
  it('ma stały, rozpoznawalny kształt', () => {
    const m = newReportMarker()
    assert.match(m, /^zg-[0-9a-f]{8}$/)
    assert.match(m, REPORT_MARKER_PATTERN)
  })

  it('dwa kolejne zgłoszenia mają różne numery', () => {
    // Gdyby marker się powtarzał, dowożenie z kolejki uznałoby CUDZE zadanie
    // za swoje i zamknęłoby wiersz, nie zakładając zgłoszenia klienta.
    const zestaw = new Set(Array.from({ length: 200 }, () => newReportMarker()))
    assert.strictEqual(zestaw.size, 200)
  })

  it('marker trafia do stopki, gdy jest podany', () => {
    const opis = withReporterFooter('Treść zgłoszenia', {
      name: 'Anna',
      email: 'anna@klient.example',
      portalName: 'Testowy',
      portalSlug: 'testowy',
      source: 'form',
      marker: 'zg-deadbeef',
    })
    assert.match(opis, /\*\*Nr zgłoszenia:\*\* zg-deadbeef/)
  })

  it('bez markera stopka wygląda jak dotychczas', () => {
    const opis = withReporterFooter('Treść', {
      name: 'Anna',
      email: 'anna@klient.example',
      portalName: 'Testowy',
      portalSlug: 'testowy',
      source: 'form',
    })
    assert.ok(!opis.includes('Nr zgłoszenia'))
  })
})
