import { describe, it } from 'vitest'
import assert from 'node:assert'
import {
  embedClientIdMarker,
  extractClientIdFromDescription,
  embedUrlMarker,
  extractUrlFromDescription,
  buildFeedbackDescription,
  buildFeedbackTitle,
  feedbackKindLabel,
  feedbackKindTags,
  buildAnnotationLink,
  withSitepingMarkers,
} from './annotationMarker'

describe('client id marker', () => {
  it('round-trips through a description', () => {
    const marker = embedClientIdMarker('abc-123')
    assert.strictEqual(extractClientIdFromDescription(`${marker}\n\nresztka opisu`), 'abc-123')
  })

  it('returns null when there is no marker', () => {
    assert.strictEqual(extractClientIdFromDescription('zwykly opis bez markera'), null)
  })

  it('returns null for null description', () => {
    assert.strictEqual(extractClientIdFromDescription(null), null)
  })
})

describe('url marker', () => {
  it('round-trips a url with query string through a description', () => {
    const marker = embedUrlMarker('https://wodadlafirmy.pl/oferta?ref=fb')
    assert.strictEqual(
      extractUrlFromDescription(`${marker}\ntresc`),
      'https://wodadlafirmy.pl/oferta?ref=fb'
    )
  })
})

describe('buildFeedbackDescription', () => {
  it('includes selector, xpath and position when annotation is present', () => {
    const out = buildFeedbackDescription({
      clientId: 'c1',
      url: 'https://wodadlafirmy.pl/',
      message: 'Ten przycisk jest za maly',
      annotation: {
        cssSelector: 'main > button.cta',
        xpath: '/html/body/main/button',
        textSnippet: 'Zamow teraz',
        elementTag: 'BUTTON',
        elementId: null,
        textPrefix: '',
        textSuffix: '',
        fingerprint: '0:2:abc',
        neighborText: '',
        anchorKey: null,
        xPct: 0.42,
        yPct: 0.15,
        wPct: 0.2,
        hPct: 0.05,
        scrollX: 0,
        scrollY: 0,
        viewportW: 1440,
        viewportH: 900,
        devicePixelRatio: 2,
      },
    })
    assert.match(out, /main > button\.cta/)
    assert.match(out, /Ten przycisk jest za maly/)
    // Etykieta elementu niesie tekst, ktory czlowiek widzi na stronie —
    // to po nim zespol rozpoznaje miejsce szybciej niz po selektorze.
    assert.match(out, /Zamow teraz/)
  })

  it('stawia tresc zgloszenia w PIERWSZEJ linii', () => {
    const out = buildFeedbackDescription({
      clientId: 'c1',
      url: '/oferta',
      message: 'Przycisk jest za maly na mobile',
      annotation: null,
    })
    // To jest cala poanta kolejnosci: podglad zadania, powiadomienie i karta
    // pokazuja poczatek opisu, wiec markery techniczne nie moga tam stac.
    assert.strictEqual(out.split('\n')[0], 'Przycisk jest za maly na mobile')
    assert.doesNotMatch(out.split('\n')[0], /siteping-client-id/)
  })

  it('sam opis NIE zawiera markerow — dokleja je withSitepingMarkers po stopce', () => {
    const out = buildFeedbackDescription({
      clientId: 'abc-123',
      url: '/oferta',
      message: 'tresc',
      annotation: null,
    })
    assert.doesNotMatch(out, /siteping-client-id/)
  })

  it('omits the element section when there is no annotation', () => {
    const out = buildFeedbackDescription({
      clientId: 'c1',
      url: 'https://wodadlafirmy.pl/',
      message: 'Ogolna uwaga bez klikniecia',
      annotation: null,
    })
    assert.doesNotMatch(out, /\*\*Selektor:\*\*/)
    assert.match(out, /Ogolna uwaga bez klikniecia/)
  })
})

describe('withSitepingMarkers', () => {
  it('stawia oba markery w dwoch ostatnich liniach, pod stopka', () => {
    const zStopka = 'tresc\n\n---\n**Zgłoszone przez:** Anna <anna@klient.pl>'
    const out = withSitepingMarkers(zStopka, 'abc-123', '/oferta')
    const lines = out.split('\n')

    assert.match(lines[lines.length - 2], /siteping-client-id:abc-123/)
    assert.match(lines[lines.length - 1], /siteping-url/)
    // Stopka zostaje NAD markerami, czyli tam, gdzie czyta ja czlowiek.
    assert.ok(out.indexOf('Zgłoszone przez') < out.indexOf('siteping-client-id'))
  })

  it('zapisuje clientId i url tak, ze odczyt je odzyskuje', () => {
    const out = withSitepingMarkers('tresc', 'abc-123', '/oferta?ref=fb')
    assert.strictEqual(extractClientIdFromDescription(out), 'abc-123')
    assert.strictEqual(extractUrlFromDescription(out), '/oferta?ref=fb')
  })
})

describe('buildAnnotationLink', () => {
  it('sklada origin ze sciezka i dokleja parametr glebokiego linku', () => {
    assert.strictEqual(
      buildAnnotationLink('https://wodadlafirmy.pl', '/oferta', '869ef0b50'),
      'https://wodadlafirmy.pl/oferta?siteping=869ef0b50'
    )
  })

  it('zachowuje istniejace parametry sciezki', () => {
    const link = buildAnnotationLink('https://wodadlafirmy.pl', '/oferta?ref=fb', 'abc')
    assert.match(link!, /ref=fb/)
    assert.match(link!, /siteping=abc/)
  })

  it('zwraca null bez originu, zamiast budowac polamany adres', () => {
    assert.strictEqual(buildAnnotationLink(null, '/oferta', 'abc'), null)
    assert.strictEqual(buildAnnotationLink(undefined, '/oferta', 'abc'), null)
  })

  it('zwraca null, gdy origin nie jest poprawnym adresem', () => {
    assert.strictEqual(buildAnnotationLink('nie-adres', '/oferta', 'abc'), null)
  })
})

describe('buildFeedbackDescription — link do zaznaczonego miejsca', () => {
  it('wstawia klikalny link, gdy zna origin i identyfikator zadania', () => {
    const out = buildFeedbackDescription({
      clientId: 'c1',
      url: '/oferta',
      message: 'tresc',
      annotation: null,
      siteOrigin: 'https://wodadlafirmy.pl',
      feedbackId: '869ef0b50',
    })
    assert.match(out, /https:\/\/wodadlafirmy\.pl\/oferta\?siteping=869ef0b50/)
    assert.match(out, /Zobacz na stronie/)
  })

  it('pokazuje sama sciezke, gdy origin jest nieznany', () => {
    const out = buildFeedbackDescription({
      clientId: 'c1',
      url: '/oferta',
      message: 'tresc',
      annotation: null,
      feedbackId: '869ef0b50',
    })
    assert.doesNotMatch(out, /Zobacz na stronie/)
    assert.match(out, /\*\*Strona:\*\* \/oferta/)
  })

  it('pokazuje sama sciezke przy pierwszym zapisie, gdy zadania jeszcze nie ma', () => {
    // Opis powstaje dwa razy: najpierw bez identyfikatora (bo zadanie dopiero
    // powstaje), potem z nim. Pierwszy zapis nie moze udawac, ze ma link.
    const out = buildFeedbackDescription({
      clientId: 'c1',
      url: '/oferta',
      message: 'tresc',
      annotation: null,
      siteOrigin: 'https://wodadlafirmy.pl',
      feedbackId: null,
    })
    assert.doesNotMatch(out, /siteping=/)
  })
})

describe('buildFeedbackTitle', () => {
  it('falls back to a generic title for empty messages', () => {
    assert.strictEqual(buildFeedbackTitle('   '), 'Zgłoszenie ze strony')
  })

  it('truncates long messages to 80 characters with an ellipsis', () => {
    const long = 'x'.repeat(120)
    const title = buildFeedbackTitle(long)
    assert.strictEqual(title.length, 80)
    assert.ok(title.endsWith('...'))
  })

  it('keeps short messages verbatim', () => {
    assert.strictEqual(buildFeedbackTitle('Literowka w naglowku'), 'Literowka w naglowku')
  })
})

/**
 * RODZAJ ZGLOSZENIA: blad, zmiana, pytanie, inne.
 *
 * Widget pyta o to klienta, bo kazdy rodzaj wymaga innej reakcji zespolu.
 * Trafia w DWA miejsca i to jest swiadome: opis dziala ZAWSZE, a tag jest
 * wygoda przy filtrowaniu, ktora ClickUp potrafi po cichu pominac.
 */
describe('rodzaj zgloszenia', () => {
  describe('feedbackKindLabel', () => {
    it('kazdy znany rodzaj ma czytelna etykiete po polsku', () => {
      assert.match(feedbackKindLabel('bug'), /Błąd/)
      assert.match(feedbackKindLabel('change'), /Zmiana/)
      assert.match(feedbackKindLabel('question'), /Pytanie/)
      assert.match(feedbackKindLabel('other'), /Inne/)
    })

    it('NIEZNANA wartosc spada na „Inne", zamiast gubic zgloszenie', () => {
      // Pakiet moze kiedys dodac nowy rodzaj. Zadanie bez opisu byloby gorsze
      // niz zadanie opisane ogolnie.
      assert.match(feedbackKindLabel('cokolwiek-nowego'), /Inne/)
      assert.match(feedbackKindLabel(null), /Inne/)
      assert.match(feedbackKindLabel(undefined), /Inne/)
    })
  })

  describe('feedbackKindTags', () => {
    it('zawsze DWA tagi: zrodlo i rodzaj', () => {
      // `siteping` mowi SKAD to przyszlo, rodzaj mowi CZEGO dotyczy.
      assert.deepStrictEqual(feedbackKindTags('bug'), ['siteping', 'błąd'])
      assert.deepStrictEqual(feedbackKindTags('change'), ['siteping', 'zmiana'])
      assert.deepStrictEqual(feedbackKindTags('question'), ['siteping', 'pytanie'])
    })

    it('nieznany rodzaj nadal daje tag zrodla', () => {
      // Utrata `siteping` zerwalaby rozpoznawanie zgloszen z widgetu.
      assert.deepStrictEqual(feedbackKindTags('nowy-rodzaj'), ['siteping', 'inne'])
      assert.deepStrictEqual(feedbackKindTags(null), ['siteping', 'inne'])
    })
  })

  describe('opis zadania', () => {
    const opis = (kind?: string | null) =>
      buildFeedbackDescription({
        clientId: 'c-1',
        url: 'https://demo.test/kontakt',
        message: 'przycisk nie dziala',
        annotation: null,
        kind,
      })

    it('rodzaj NIE wypycha tresci klienta z pierwszej linii', () => {
      // Tresc zgloszenia zostaje na gorze — to byla swiadoma decyzja Lukasza
      // i rodzaj jej nie przesłania. Do skanowania listy zadan sluzy TAG,
      // ktory ClickUp pokazuje przy nazwie.
      const linie = opis('bug').split('\n')
      assert.strictEqual(linie[0], 'przycisk nie dziala')
      assert.ok(opis('bug').includes('Błąd'), 'rodzaj jest w opisie, tylko nizej')
    })

    it('opis BEZ podanego rodzaju nadal niesie rodzaj „Inne"', () => {
      // Brak rodzaju nie moze zostawic zadania bez tej informacji — zespol
      // czytalby wtedy tresc, nie wiedzac, czy to usterka, czy pytanie.
      assert.match(opis(undefined), /Rodzaj:.*Inne/)
    })
  })
})
