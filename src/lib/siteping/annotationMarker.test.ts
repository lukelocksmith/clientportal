import { describe, it } from 'vitest'
import assert from 'node:assert'
import {
  embedClientIdMarker,
  extractClientIdFromDescription,
  embedUrlMarker,
  extractUrlFromDescription,
  buildFeedbackDescription,
  buildFeedbackTitle,
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
    assert.match(out, /\/html\/body\/main\/button/)
    assert.match(out, /42%, 15%/)
    assert.match(out, /Ten przycisk jest za maly/)
  })

  it('omits the element section when there is no annotation', () => {
    const out = buildFeedbackDescription({
      clientId: 'c1',
      url: 'https://wodadlafirmy.pl/',
      message: 'Ogolna uwaga bez klikniecia',
      annotation: null,
    })
    assert.doesNotMatch(out, /Selektor CSS/)
    assert.match(out, /Ogolna uwaga bez klikniecia/)
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
