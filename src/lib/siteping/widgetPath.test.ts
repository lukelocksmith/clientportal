/**
 * Adres bundla widgetu: brama w middleware i snippet dla klienta MUSZA
 * mowic o tej samej sciezce.
 *
 * Zdarzylo sie 2026-08-10: middleware braolo `/siteping/widget.js` za portal
 * o slugu „siteping", nie znajdowalo sesji i odsylalo przegladarke na ekran
 * logowania. Skrypt na stronie klienta dostawal 307 zamiast kodu i widget
 * nie ladowal sie wcale.
 *
 *   npm test
 */
import { describe, it } from 'vitest'
import assert from 'node:assert'
import {
  SITEPING_WIDGET_PATH,
  isSitepingWidgetPath,
  sitepingWidgetUrl,
} from '@/lib/siteping/widgetPath'

describe('isSitepingWidgetPath', () => {
  it('rozpoznaje sciezke bundla', () => {
    assert.strictEqual(isSitepingWidgetPath(SITEPING_WIDGET_PATH), true)
    assert.strictEqual(isSitepingWidgetPath('/siteping/widget.js'), true)
  })

  it('NIE otwiera calego prefiksu /siteping/', () => {
    // Wykluczenie z bramy sesji ma obejmowac jeden znany plik. Dopasowanie po
    // prefiksie przepuszczaloby dowolna sciezke zaczynajaca sie tak samo.
    assert.strictEqual(isSitepingWidgetPath('/siteping/cokolwiek.js'), false)
    assert.strictEqual(isSitepingWidgetPath('/siteping/'), false)
    assert.strictEqual(isSitepingWidgetPath('/siteping'), false)
  })

  it('nie koliduje z portalem o podobnym slugu', () => {
    // Portal `siteping-test` istnieje naprawde i musi dalej przechodzic
    // przez brame sesji jak kazdy inny.
    assert.strictEqual(isSitepingWidgetPath('/siteping-test'), false)
    assert.strictEqual(isSitepingWidgetPath('/siteping-test/widget.js'), false)
  })
})

describe('sitepingWidgetUrl', () => {
  it('sklada pelny adres do wklejenia w script src', () => {
    assert.strictEqual(
      sitepingWidgetUrl('https://portal.important.is'),
      'https://portal.important.is/siteping/widget.js'
    )
  })

  it('znosi koncowy ukosnik w adresie aplikacji', () => {
    // NEXT_PUBLIC_APP_URL bywa ustawiony z ukosnikiem na koncu, a podwojny
    // ukosnik w sciezce rozminie sie z porownaniem w middleware.
    assert.strictEqual(
      sitepingWidgetUrl('https://portal.important.is/'),
      'https://portal.important.is/siteping/widget.js'
    )
  })

  it('adres z snippetu przechodzi przez brame middleware', () => {
    // Zamkniecie petli: to, co wklejamy klientowi, musi byc dokladnie tym,
    // co middleware przepuszcza bez sesji.
    const url = sitepingWidgetUrl('https://portal.important.is')
    const sciezka = new URL(url).pathname
    assert.strictEqual(isSitepingWidgetPath(sciezka), true)
  })
})
