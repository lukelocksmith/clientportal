/**
 * Sprawdzenie logiki koloru marki i logo.
 *   npm test
 */
import { describe, it } from 'vitest'
import assert from 'node:assert'
import {

    normalizeHexColor,
    readableForeground,
    isSafeLogoUrl,
    resolveBranding,
    DEFAULT_BRAND_COLOR,
  } from '@/lib/branding'

describe('branding', () => {
    it('normalize', () => {
      assert.strictEqual(normalizeHexColor('#AABBCC'), '#aabbcc')
      assert.strictEqual(normalizeHexColor('aabbcc'), '#aabbcc')
      assert.strictEqual(normalizeHexColor('  #AbC  '), '#aabbcc', 'skrót rozwijany, spacje obcinane')
      assert.strictEqual(normalizeHexColor('#f00'), '#ff0000')

      // Wszystko, co nie jest czystym hexem, odpada. Ta wartość leci do atrybutu
      // style, więc wpuszczenie czegokolwiek innego byłoby wstrzyknięciem CSS-u.
      for (const bad of [
        null,
        undefined,
        '',
        '   ',
        'red',
        'rgb(1,2,3)',
        '#12345',
        '#1234567',
        '#gggggg',
        'red; background: url(http://zly.example)',
        '#fff; }',
        'var(--cos)',
      ]) {
        assert.strictEqual(normalizeHexColor(bad as string), null, `powinno odpaść: ${String(bad)}`)
      }
    })

    it('foreground', () => {
      // Ciemne tło => biały tekst.
      assert.strictEqual(readableForeground('#000000'), '#ffffff')
      assert.strictEqual(readableForeground('#6d28d9'), '#ffffff', 'fiolet portalu')
      assert.strictEqual(readableForeground('#1d4ed8'), '#ffffff')

      // Jasne tło => ciemny tekst. To jest powód istnienia tej funkcji: brand
      // klienta bywa żółty albo limonkowy i biały tekst byłby wtedy nieczytelny.
      assert.strictEqual(readableForeground('#ffffff'), '#111111')
      assert.strictEqual(readableForeground('#ffff00'), '#111111', 'żółty')
      assert.strictEqual(readableForeground('#c8f000'), '#111111', 'limonka')
      assert.strictEqual(readableForeground('#00ffff'), '#111111', 'cyjan')
      assert.strictEqual(readableForeground('#f8ae00'), '#111111', 'pomarańcz z palety statusów')

      // Wynik musi być zawsze jednym z dwóch, nigdy undefined.
      for (const c of ['#123456', '#abcdef', '#777777', '#808080']) {
        assert.ok(['#ffffff', '#111111'].includes(readableForeground(c)), c)
      }
    })

    it('logo url', () => {
      assert.ok(isSafeLogoUrl('https://klient.pl/logo.png'))
      assert.ok(isSafeLogoUrl('http://klient.pl/logo.svg'))
      assert.ok(isSafeLogoUrl('data:image/png;base64,iVBORw0KGgo='))
      assert.ok(isSafeLogoUrl('data:image/svg+xml;base64,PHN2Zz48L3N2Zz4='))

      // Schematy wykonywalne i śmieci odpadają.
      for (const bad of [
        null,
        undefined,
        '',
        '  ',
        'javascript:alert(1)',
        'JavaScript:alert(1)',
        'data:text/html;base64,PHNjcmlwdD4=',
        'data:image/png,niebase64',
        'file:///etc/passwd',
        'logo.png',
        './logo.png',
      ]) {
        assert.strictEqual(isSafeLogoUrl(bad as string), false, `powinno odpaść: ${String(bad)}`)
      }
    })

    it('resolve', () => {
      // Brak konfiguracji => domyślny kolor, brak logo. Portal musi się wyrenderować.
      const empty = resolveBranding({})
      assert.strictEqual(empty.brandColor, DEFAULT_BRAND_COLOR)
      assert.strictEqual(empty.logoUrl, null)
      assert.strictEqual(empty.brandForeground, readableForeground(DEFAULT_BRAND_COLOR))

      // Śmieci w bazie też nie mogą wysadzić portalu, tylko wrócić do domyślnych.
      const junk = resolveBranding({ brandColor: 'red; }', logoUrl: 'javascript:alert(1)' })
      assert.strictEqual(junk.brandColor, DEFAULT_BRAND_COLOR)
      assert.strictEqual(junk.logoUrl, null)

      const ok = resolveBranding({ brandColor: '#ffff00', logoUrl: ' https://klient.pl/l.png ' })
      assert.strictEqual(ok.brandColor, '#ffff00')
      assert.strictEqual(ok.brandForeground, '#111111', 'żółty brand dostaje ciemny tekst')
      assert.strictEqual(ok.logoUrl, 'https://klient.pl/l.png', 'spacje obcięte')
    })
})
