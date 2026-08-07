import { describe, it } from 'vitest'
import assert from 'node:assert'
import {
  isSafeHttpUrl,
  sanitizeLinks,
  MAX_LINKS_PER_PORTAL,
  MAX_LABEL_LENGTH,
} from './projectLinks'

/**
 * Linki projektu pokazywane klientowi na Dashboardzie.
 *
 * Adres trafia do atrybutu `href`, wiec `javascript:` WYKONUJE sie po
 * klikniecu — to jest realne wykonanie kodu w przegladarce klienta, nie
 * teoretyczne. Wartosci wpisuje admin, ale trasa `/api/admin/*` przyjmuje tez
 * token, wiec curl omija panel i jego walidacje w calosci.
 *
 *   npx vitest run src/lib/projectLinks.test.ts
 */
describe('isSafeHttpUrl', () => {
  it('https i http przechodza', () => {
    assert.strictEqual(isSafeHttpUrl('https://figma.com/plik'), true)
    assert.strictEqual(isSafeHttpUrl('http://wewnetrzny.local/panel'), true)
  })

  it('javascript: NIE przechodzi, w zadnym zapisie', () => {
    assert.strictEqual(isSafeHttpUrl('javascript:alert(1)'), false)
    // Wielkosc liter i spacja wiodaca to klasyczne obejscia naiwnego filtra.
    assert.strictEqual(isSafeHttpUrl('JavaScript:alert(1)'), false)
    assert.strictEqual(isSafeHttpUrl('  javascript:alert(1)'), false)
  })

  it('data: NIE przechodzi', () => {
    // To nie jest obrazek, tylko link do klikniecia — nie ma tu powodu na `data:`.
    assert.strictEqual(isSafeHttpUrl('data:text/html,<script>alert(1)</script>'), false)
  })

  it('inne schematy odpadaja', () => {
    for (const zly of ['file:///etc/passwd', 'ftp://serwer/plik', 'mailto:a@b.c', 'tel:+48123']) {
      assert.strictEqual(isSafeHttpUrl(zly), false, zly)
    }
  })

  it('adres wzgledny bez schematu odpada', () => {
    // `new URL` bez bazy odrzuci taki adres, i dobrze: link projektu ma
    // prowadzic na zewnatrz, a nie w glab portalu.
    assert.strictEqual(isSafeHttpUrl('/wewnetrzna/sciezka'), false)
    assert.strictEqual(isSafeHttpUrl('figma.com/plik'), false)
  })

  it('puste i brakujace wartosci odpadaja bez wyjatku', () => {
    assert.strictEqual(isSafeHttpUrl(''), false)
    assert.strictEqual(isSafeHttpUrl(null), false)
    assert.strictEqual(isSafeHttpUrl(undefined), false)
    assert.strictEqual(isSafeHttpUrl('   '), false)
  })

  it('spacje wokol poprawnego adresu nie przeszkadzaja', () => {
    assert.strictEqual(isSafeHttpUrl('  https://example.test  '), true)
  })
})

describe('sanitizeLinks', () => {
  const link = (label: string, url: string) => ({ label, url })

  it('poprawne wiersze przechodza bez zmian', () => {
    const wejscie = [link('Figma', 'https://figma.com/x'), link('Analytics', 'https://ga.example')]
    assert.deepStrictEqual(sanitizeLinks(wejscie), wejscie)
  })

  it('wiersz BEZ etykiety jest pomijany po cichu', () => {
    // Panel pozwala dodac pusty wiersz i to normalne, ze czesc zostanie
    // niewypelniona. Blad calej zmiany bylby tu gorszy od pominiecia.
    assert.deepStrictEqual(sanitizeLinks([link('', 'https://example.test')]), [])
    assert.deepStrictEqual(sanitizeLinks([link('   ', 'https://example.test')]), [])
  })

  it('wiersz z NIEBEZPIECZNYM adresem jest pomijany', () => {
    const wynik = sanitizeLinks([
      link('Zwykly', 'https://example.test'),
      link('Podstepny', 'javascript:alert(1)'),
    ])

    assert.deepStrictEqual(wynik, [link('Zwykly', 'https://example.test')])
  })

  it('etykieta jest przycinana do limitu, nie odrzucana', () => {
    const dluga = 'x'.repeat(MAX_LABEL_LENGTH + 20)
    const [wynik] = sanitizeLinks([link(dluga, 'https://example.test')])

    // Odrzucenie calego wiersza za zbyt dluga nazwe byloby karaniem za drobiazg.
    assert.strictEqual(wynik.label.length, MAX_LABEL_LENGTH)
  })

  it('spacje w etykiecie i adresie sa przycinane', () => {
    const [wynik] = sanitizeLinks([link('  Figma  ', '  https://figma.com/x  ')])

    assert.deepStrictEqual(wynik, link('Figma', 'https://figma.com/x'))
  })

  it('lista dluzsza niz limit jest UCINANA, a nie odrzucana w calosci', () => {
    const nadmiar = Array.from({ length: MAX_LINKS_PER_PORTAL + 5 }, (_, i) =>
      link(`Link ${i}`, `https://example.test/${i}`)
    )

    const wynik = sanitizeLinks(nadmiar)

    assert.strictEqual(wynik.length, MAX_LINKS_PER_PORTAL)
    assert.strictEqual(wynik[0].label, 'Link 0', 'zostaja PIERWSZE, czyli te u gory listy w panelu')
  })

  it('limit liczy sie PO odrzuceniu pustych wierszy', () => {
    // Inaczej kilka pustych wierszy u gory wypchneloby poprawne linki poza limit.
    const wejscie = [
      ...Array.from({ length: 5 }, () => link('', '')),
      ...Array.from({ length: MAX_LINKS_PER_PORTAL }, (_, i) =>
        link(`Link ${i}`, `https://example.test/${i}`)
      ),
    ]

    assert.strictEqual(sanitizeLinks(wejscie).length, MAX_LINKS_PER_PORTAL)
  })

  it('pusta lista zostaje pusta', () => {
    assert.deepStrictEqual(sanitizeLinks([]), [])
  })
})
