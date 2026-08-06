/**
 * Zgodnosc widgetu z walidacja adaptera.
 *
 * Wartosci w tescie „prawdziwy payload" NIE SA wymyslone: pochodza z kolejki
 * ponawiania w `localStorage` przegladarki po sesji, w ktorej klient klikal
 * Wyslij i nic sie nie dzialo. To dokladnie ten payload, ktory adapter odrzucal
 * z HTTP 400 na polu `annotations.0.rect.hPct`.
 *
 *   npm test
 */
import { describe, it } from 'vitest'
import assert from 'node:assert'
import { clampAnnotationRanges } from './clampPayload'

/** Ksztalt anotacji, jaki wysyla widget — pola nieistotne dla testu pominiete. */
function annotation(overrides: Record<string, unknown> = {}) {
  return {
    anchor: {
      cssSelector: 'body > button',
      xpath: '/html/body/button',
      textSnippet: 'Zamów teraz',
      elementTag: 'BUTTON',
      textPrefix: '',
      textSuffix: '',
      fingerprint: '12:0:0',
      neighborText: '',
      anchorKey: null,
    },
    rect: { xPct: 0.1, yPct: 0.1, wPct: 0.2, hPct: 0.3 },
    scrollX: 0,
    scrollY: 0,
    viewportW: 1496,
    viewportH: 939,
    devicePixelRatio: 2,
    ...overrides,
  }
}

function payload(overrides: Record<string, unknown> = {}) {
  return {
    projectName: 'siteping-test',
    type: 'bug',
    message: 'test',
    url: '/scripts/siteping-manual-test',
    viewport: '1496x939',
    userAgent: 'Mozilla/5.0',
    authorName: 'Test Klient',
    authorEmail: 'test@example.com',
    clientId: 'b35da94d-cc28-4141-a333-5c35740',
    annotations: [annotation()],
    ...overrides,
  }
}

describe('clampAnnotationRanges — prawdziwy payload, ktory adapter odrzucal', () => {
  it('sprowadza hPct 1.606 do 1 (bezposrednia przyczyna HTTP 400)', () => {
    const out = clampAnnotationRanges(
      payload({
        annotations: [
          annotation({
            rect: {
              xPct: 0.0891891891891892,
              yPct: 0.7140295831465711,
              wPct: 0.29121621621621624,
              hPct: 1.6064545047064096,
            },
          }),
        ],
      })
    )

    const rect = out.annotations[0].rect as Record<string, number>
    assert.strictEqual(rect.hPct, 1)
    // Pozostale ulamki byly juz poprawne — musza przejsc BEZ zmiany, inaczej
    // przycinanie gubiloby polozenie zaznaczenia zamiast tylko je ograniczac.
    assert.strictEqual(rect.xPct, 0.0891891891891892)
    assert.strictEqual(rect.yPct, 0.7140295831465711)
    assert.strictEqual(rect.wPct, 0.29121621621621624)
  })

  it('nie rusza selektora, xpath ani tekstu — to one wskazuja miejsce zmiany', () => {
    const out = clampAnnotationRanges(
      payload({ annotations: [annotation({ rect: { xPct: 5, yPct: 5, wPct: 5, hPct: 5 } })] })
    )

    const anchor = out.annotations[0].anchor as Record<string, unknown>
    assert.strictEqual(anchor.cssSelector, 'body > button')
    assert.strictEqual(anchor.xpath, '/html/body/button')
    assert.strictEqual(anchor.textSnippet, 'Zamów teraz')
  })
})

describe('clampAnnotationRanges — pozostale zakresy wymagane przez adapter', () => {
  it('podnosi ujemny scroll do zera (bounce scroll na macOS)', () => {
    const out = clampAnnotationRanges(
      payload({ annotations: [annotation({ scrollX: -40, scrollY: -120 })] })
    )

    assert.strictEqual(out.annotations[0].scrollX, 0)
    assert.strictEqual(out.annotations[0].scrollY, 0)
  })

  it('zaokragla viewport do dodatniej liczby calkowitej', () => {
    const out = clampAnnotationRanges(
      payload({ annotations: [annotation({ viewportW: 1496.4, viewportH: 0 })] })
    )

    assert.strictEqual(out.annotations[0].viewportW, 1496)
    assert.strictEqual(out.annotations[0].viewportH, 1)
  })

  it('zastepuje niedodatni devicePixelRatio jedynka', () => {
    const out = clampAnnotationRanges(
      payload({ annotations: [annotation({ devicePixelRatio: 0 })] })
    )

    assert.strictEqual(out.annotations[0].devicePixelRatio, 1)
  })

  it('zastepuje NaN wartoscia domyslna zamiast przepuszczac go dalej', () => {
    const out = clampAnnotationRanges(
      payload({ annotations: [annotation({ rect: { xPct: NaN, yPct: 0.5, wPct: 0.5, hPct: 0.5 } })] })
    )

    const rect = out.annotations[0].rect as Record<string, number>
    assert.strictEqual(rect.xPct, 0)
    assert.strictEqual(rect.yPct, 0.5)
  })
})

describe('clampAnnotationRanges — payloady, ktorych nie ruszamy', () => {
  it('przepuszcza zgloszenie bez anotacji (widget dopuszcza takie)', () => {
    const input = payload({ annotations: [] })
    const out = clampAnnotationRanges(input)
    assert.deepStrictEqual(out.annotations, [])
    assert.strictEqual(out.message, 'test')
  })

  it('zwraca nie-obiekt bez zmian — ocena nalezy do walidacji adaptera', () => {
    assert.strictEqual(clampAnnotationRanges(null), null)
    assert.strictEqual(clampAnnotationRanges('nonsens'), 'nonsens')
  })

  it('zostawia poprawne wartosci nietkniete', () => {
    const input = payload()
    const out = clampAnnotationRanges(input)
    assert.deepStrictEqual(out.annotations[0].rect, { xPct: 0.1, yPct: 0.1, wPct: 0.2, hPct: 0.3 })
    assert.strictEqual(out.annotations[0].devicePixelRatio, 2)
  })
})
