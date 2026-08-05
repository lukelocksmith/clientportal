/**
 * Rozpoznawanie urządzenia z User-Agenta.
 *   npm test
 *
 * Nagłówki poniżej są PRAWDZIWE, skopiowane z realnych żądań, a nie wymyślone.
 * Cała trudność tej funkcji polega na tym, że przeglądarki podszywają się pod
 * siebie w tym nagłówku, więc test na uproszczonych napisach niczego nie broni.
 */
import { describe, it } from 'vitest'
import assert from 'node:assert'
import { deviceLabel } from '@/lib/deviceLabel'

describe('deviceLabel', () => {
  it('rozpoznaje przegladarke mimo podszywania sie w naglowku', () => {
    // Chrome na Macu udaje Safari. Bez wlasciwej kolejnosci dopasowan wyszloby
    // "Safari, Mac" i nikt by tego nie zauwazyl, bo napis wyglada sensownie.
    assert.strictEqual(
      deviceLabel('Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/141.0.0.0 Safari/537.36'),
      'Chrome, Mac'
    )

    // Edge udaje Chrome, ktory udaje Safari. Musi wygrac Edge.
    assert.strictEqual(
      deviceLabel('Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/141.0.0.0 Safari/537.36 Edg/141.0.0.0'),
      'Edge, Windows'
    )

    // Prawdziwe Safari na iPhonie: nie ma ani Chrome, ani Edg.
    assert.strictEqual(
      deviceLabel('Mozilla/5.0 (iPhone; CPU iPhone OS 18_1 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.1 Mobile/15E148 Safari/604.1'),
      'Safari, iPhone'
    )

    assert.strictEqual(
      deviceLabel('Mozilla/5.0 (Android 15; Mobile; rv:132.0) Gecko/132.0 Firefox/132.0'),
      'Firefox, Android'
    )
  })

  it('brak naglowka to komunikat, nie pusty wiersz', () => {
    for (const puste of [null, undefined, '', '   ']) {
      assert.strictEqual(deviceLabel(puste), 'nieznane urządzenie', `zawiodlo dla: ${String(puste)}`)
    }
  })

  it('nierozpoznany naglowek zwraca swoj poczatek, bo to bywa odpowiedz', () => {
    // Wejscie z narzedzia. Napis "nieznane" ukrylby najwazniejsza informacje:
    // ze to nie byla przegladarka czlowieka.
    assert.strictEqual(deviceLabel('curl/8.7.1'), 'curl/8.7.1')
    assert.strictEqual(deviceLabel('python-requests/2.32.3'), 'python-requests/2.32.3')

    // Dlugi naglowek jest przycinany, zeby nie rozwalil ukladu wiersza.
    const dlugi = 'SomeVeryLongCustomAgentString/1.0 '.repeat(5)
    const wynik = deviceLabel(dlugi)
    assert.ok(wynik.length <= 41, `za dlugi napis: ${wynik.length}`)
    assert.ok(wynik.endsWith('…'), 'brak znaku przyciecia')
  })

  it('sam system bez rozpoznanej przegladarki tez jest informacja', () => {
    assert.strictEqual(deviceLabel('Mozilla/5.0 (Windows NT 10.0; Win64; x64)'), 'Windows')
  })
})
