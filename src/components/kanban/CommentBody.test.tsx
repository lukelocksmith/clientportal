// @vitest-environment jsdom
import { describe, it, afterEach } from 'vitest'
import assert from 'node:assert'
import { render, screen, cleanup } from '@testing-library/react'
import { CommentBody } from './CommentBody'
import type { BlockNode } from '@/lib/commentBlocks'

/**
 * Renderowanie tresci komentarza z blokow ClickUpa.
 *
 * Najwazniejszy test tego pliku to ten o wzmiance BEZ nazwy: serwer nie dopisuje
 * nazwy zadaniu, ktorego nie ma w portalu klienta, a komponent nie ma prawa
 * pokazac ani nazwy, ani linku. Reszta pilnuje, ze formatowanie z ClickUpa
 * faktycznie dociera na ekran, bo o tym bylo zgloszenie z 2026-08-24.
 *
 *   npx vitest run src/components/kanban/CommentBody.test.tsx
 */
afterEach(cleanup)

function pokaz(blocks: BlockNode[]) {
  return render(<CommentBody blocks={blocks} slug="onyx" />)
}

describe('wzmianka o zadaniu', () => {
  it('zadanie z portalu jest linkiem z nazwa, nie identyfikatorem', () => {
    pokaz([
      {
        kind: 'paragraph',
        inline: [
          { kind: 'text', text: 'poprawione w ' },
          { kind: 'taskMention', taskId: '869enjjkr', name: 'Drobne poprawki' },
        ],
      },
    ])

    const link = screen.getByRole('link', { name: /Drobne poprawki/ })
    assert.strictEqual(link.getAttribute('href'), '/onyx?task=869enjjkr')
    assert.strictEqual(screen.queryByText(/869enjjkr/) === null, true, 'identyfikator nie ma prawa byc widoczny')
  })

  it('zadanie SPOZA portalu nie pokazuje nazwy ani linku', () => {
    pokaz([{ kind: 'paragraph', inline: [{ kind: 'taskMention', taskId: '869obcy' }] }])

    assert.strictEqual(screen.queryAllByRole('link').length, 0, 'nie wolno linkowac do cudzego zadania')
    assert.strictEqual(screen.queryByText(/869obcy/) === null, true, 'identyfikator tez nie')
    assert.ok(screen.getByText(/inne zadanie/i), 'klient ma wiedziec, ze cos tu bylo')
  })
})

describe('formatowanie w linii', () => {
  it('pogrubienie renderuje sie jako pogrubienie', () => {
    pokaz([{ kind: 'paragraph', inline: [{ kind: 'text', text: 'WAZNE', bold: true }] }])

    assert.strictEqual(screen.getByText('WAZNE').tagName, 'STRONG')
  })

  it('kursywa i przekreslenie maja wlasne znaczniki', () => {
    pokaz([
      {
        kind: 'paragraph',
        inline: [
          { kind: 'text', text: 'skos', italic: true },
          { kind: 'text', text: 'kreska', strike: true },
        ],
      },
    ])

    assert.strictEqual(screen.getByText('skos').tagName, 'EM')
    assert.strictEqual(screen.getByText('kreska').tagName, 'S')
  })

  it('kod w linii renderuje sie jako kod', () => {
    pokaz([{ kind: 'paragraph', inline: [{ kind: 'text', text: 'npm run build', code: true }] }])

    assert.strictEqual(screen.getByText('npm run build').tagName, 'CODE')
  })

  it('link z etykieta prowadzi pod adres, a nie pokazuje adresu', () => {
    pokaz([
      {
        kind: 'paragraph',
        inline: [{ kind: 'text', text: 'panel sklepu', link: 'https://gemsonyx.com/wp-admin/' }],
      },
    ])

    const link = screen.getByRole('link', { name: 'panel sklepu' })
    assert.strictEqual(link.getAttribute('href'), 'https://gemsonyx.com/wp-admin/')
    assert.strictEqual(link.getAttribute('target'), '_blank')
    assert.strictEqual(link.getAttribute('rel'), 'noopener noreferrer')
  })

  it('goly adres w tekscie tez jest klikalny', () => {
    pokaz([{ kind: 'paragraph', inline: [{ kind: 'text', text: 'wejdz na https://onyx.pl/adm i sprawdz' }] }])

    assert.strictEqual(screen.getByRole('link').getAttribute('href'), 'https://onyx.pl/adm')
  })

  it('wzmianka o osobie nie renderuje NICZEGO', () => {
    // Oznaczenie osoby jest powiadomieniem wewnatrz zespolu i wypada juz w
    // `publicCommentBlocks`. Ta galaz istnieje, zeby renderer byl zupelny, a
    // nie zeby cokolwiek pokazywac: gdyby wzmianka jakos tu dotarla, klient
    // ma nie zobaczyc nazwiska.
    pokaz([
      {
        kind: 'paragraph',
        inline: [
          { kind: 'text', text: 'przed ' },
          { kind: 'mention', label: 'Paulina Andrzejewska' },
          { kind: 'text', text: ' po' },
        ],
      },
    ])

    assert.strictEqual(screen.queryByText(/Paulina/) === null, true, 'nazwisko nie ma prawa wyjsc')
    assert.ok(screen.getByText(/przed/), 'reszta zdania zostaje')
  })
})

describe('bloki', () => {
  it('lista punktowana renderuje punkty', () => {
    pokaz([
      {
        kind: 'bullets',
        items: [[{ kind: 'text', text: 'pierwszy' }], [{ kind: 'text', text: 'drugi' }]],
      },
    ])

    const punkty = screen.getAllByRole('listitem')
    assert.deepStrictEqual(punkty.map(li => li.textContent), ['pierwszy', 'drugi'])
    assert.strictEqual(punkty[0].parentElement?.tagName, 'UL')
  })

  it('lista numerowana jest numerowana, nie punktowana', () => {
    pokaz([{ kind: 'ordered', items: [[{ kind: 'text', text: 'raz' }]] }])

    assert.strictEqual(screen.getByRole('listitem').parentElement?.tagName, 'OL')
  })

  it('blok kodu pokazuje kod doslownie, bez interpretowania gwiazdek', () => {
    pokaz([{ kind: 'code', language: 'css', lines: ['.a { color: red }', '/* **nie pogrubienie** */'] }])

    const kod = screen.getByText(/color: red/)
    assert.strictEqual(kod.closest('pre') !== null, true)
    assert.match(kod.textContent ?? '', /\*\*nie pogrubienie\*\*/)
  })

  it('cytat renderuje sie jako cytat', () => {
    pokaz([{ kind: 'quote', inline: [{ kind: 'text', text: 'klient napisal' }] }])

    assert.ok(screen.getByText('klient napisal').closest('blockquote'))
  })

  it('naglowek zachowuje poziom', () => {
    pokaz([{ kind: 'heading', level: 2, inline: [{ kind: 'text', text: 'Podsumowanie' }] }])

    assert.ok(screen.getByRole('heading', { name: 'Podsumowanie' }))
  })
})

describe('obrazki, pliki, wideo', () => {
  it('obrazek pokazuje sie jako obrazek, z podpisem w alt', () => {
    pokaz([{ kind: 'image', url: 'https://cdn.clickup.test/zrzut.png', name: 'zrzut.png' }])

    const img = screen.getByRole('img')
    assert.strictEqual(img.getAttribute('src'), 'https://cdn.clickup.test/zrzut.png')
    assert.strictEqual(img.getAttribute('alt'), 'zrzut.png')
  })

  it('obrazek da sie otworzyc w pelnym rozmiarze', () => {
    pokaz([{ kind: 'image', url: 'https://cdn.clickup.test/zrzut.png', name: 'zrzut.png' }])

    assert.strictEqual(screen.getByRole('link').getAttribute('href'), 'https://cdn.clickup.test/zrzut.png')
  })

  it('plik jest linkiem z nazwa, nie golym adresem', () => {
    pokaz([{ kind: 'file', url: 'https://cdn.clickup.test/pomiary.pdf', name: 'pomiary.pdf' }])

    const link = screen.getByRole('link', { name: /pomiary\.pdf/ })
    assert.strictEqual(link.getAttribute('href'), 'https://cdn.clickup.test/pomiary.pdf')
  })

  it('wideo da sie odtworzyc na miejscu', () => {
    const { container } = pokaz([
      { kind: 'video', url: 'https://cdn.clickup.test/film.mp4', name: 'film.mp4' },
    ])

    const video = container.querySelector('video')
    assert.ok(video, 'brak odtwarzacza')
    assert.strictEqual(video.getAttribute('src'), 'https://cdn.clickup.test/film.mp4')
  })
})

describe('tabela', () => {
  it('pierwszy wiersz jest naglowkiem tabeli', () => {
    pokaz([
      {
        kind: 'table',
        rows: [
          [[{ kind: 'text', text: 'Parametr' }], [{ kind: 'text', text: 'Bylo' }]],
          [[{ kind: 'text', text: 'Odpowiedz' }], [{ kind: 'text', text: '2,72 s' }]],
        ],
      },
    ])

    assert.deepStrictEqual(
      screen.getAllByRole('columnheader').map(th => th.textContent),
      ['Parametr', 'Bylo']
    )
    assert.ok(screen.getByRole('cell', { name: '2,72 s' }))
  })
})

describe('brak tresci', () => {
  it('pusty komentarz nie renderuje nic, zamiast wywalac szuflade', () => {
    const { container } = pokaz([])

    assert.strictEqual(container.textContent, '')
  })
})
