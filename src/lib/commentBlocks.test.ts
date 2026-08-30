import { describe, it } from 'vitest'
import assert from 'node:assert'
import { parseCommentBlocks, blocksToText, type BlockNode, type InlineNode } from './commentBlocks'

/** Zawartosc linii bloku, z asercja rodzaju: TypeScript nie zwezi tego sam. */
function inlineOf(block: BlockNode | undefined): InlineNode[] {
  assert.ok(block && 'inline' in block, `oczekiwano bloku z trescia w linii, jest ${block?.kind}`)
  return block.inline
}

/**
 * Parser blokow komentarza ClickUpa.
 *
 * ClickUp oddaje komentarz w polu `comment` jako plaska liste wstawek w duchu
 * Quill delty: biegi tekstu, a atrybuty CALEJ LINII siedza na wstawce `"\n"`,
 * ktora te linie KONCZY. Portal czytal zamiast tego `comment_text`, czyli
 * splaszczony tekst, w ktorym wzmianka o zadaniu zostaje golym identyfikatorem
 * (zgloszone 2026-08-24), obrazek napisem "image.png", a listy, kod i linki
 * przepadaja. Te testy pilnuja przelozenia delty na drzewo blokow.
 *
 *   npx vitest run src/lib/commentBlocks.test.ts
 */

describe('akapity', () => {
  it('zwykly tekst to jeden akapit', () => {
    const out = parseCommentBlocks([{ text: 'Poprawione.', attributes: {} }])

    assert.deepStrictEqual(out, [{ kind: 'paragraph', inline: [{ kind: 'text', text: 'Poprawione.' }] }])
  })

  it('wstawka konczaca linie dzieli tekst na dwa akapity', () => {
    const out = parseCommentBlocks([
      { text: 'Pierwszy' },
      { text: '\n', attributes: { 'block-id': 'block-1' } },
      { text: 'Drugi' },
      { text: '\n', attributes: { 'block-id': 'block-2' } },
    ])

    assert.deepStrictEqual(out, [
      { kind: 'paragraph', inline: [{ kind: 'text', text: 'Pierwszy' }] },
      { kind: 'paragraph', inline: [{ kind: 'text', text: 'Drugi' }] },
    ])
  })

  it('nowa linia WEWNATRZ biegu tekstu tez dzieli akapity', () => {
    const out = parseCommentBlocks([{ text: 'Pierwszy\nDrugi' }])

    assert.deepStrictEqual(out, [
      { kind: 'paragraph', inline: [{ kind: 'text', text: 'Pierwszy' }] },
      { kind: 'paragraph', inline: [{ kind: 'text', text: 'Drugi' }] },
    ])
  })

  it('pusta linia miedzy akapitami nie znika, bo to odstep autora', () => {
    const out = parseCommentBlocks([
      { text: 'Pierwszy' },
      { text: '\n\n' },
      { text: 'Drugi' },
    ])

    assert.deepStrictEqual(out, [
      { kind: 'paragraph', inline: [{ kind: 'text', text: 'Pierwszy' }] },
      { kind: 'paragraph', inline: [] },
      { kind: 'paragraph', inline: [{ kind: 'text', text: 'Drugi' }] },
    ])
  })
})

describe('wzmianka o zadaniu', () => {
  it('zostaje wzmianka z identyfikatorem, nie golym tekstem', () => {
    const out = parseCommentBlocks([
      { text: 'Poprawione w zadaniu ' },
      { text: '869enjjkr', type: 'task_mention', task_mention: { task_id: '869enjjkr' } },
      { text: ', tam opisalem.' },
    ])

    assert.deepStrictEqual(out, [
      {
        kind: 'paragraph',
        inline: [
          { kind: 'text', text: 'Poprawione w zadaniu ' },
          { kind: 'taskMention', taskId: '869enjjkr' },
          { kind: 'text', text: ', tam opisalem.' },
        ],
      },
    ])
  })

  it('bierze identyfikator z pola task_mention, nie z widocznego tekstu', () => {
    const out = parseCommentBlocks([
      { text: 'nazwa ktora ClickUp podstawil', type: 'task_mention', task_mention: { task_id: '869abc123' } },
    ])

    assert.deepStrictEqual(out, [
      { kind: 'paragraph', inline: [{ kind: 'taskMention', taskId: '869abc123' }] },
    ])
  })
})

describe('wzmianka o osobie', () => {
  it('zostaje wzmianka z imieniem, bez malpy w tresci', () => {
    const out = parseCommentBlocks([
      { type: 'tag', text: '@Paulina Andrzejewska', user: { id: 1, username: 'Paulina Andrzejewska' } },
    ])

    assert.deepStrictEqual(out, [
      { kind: 'paragraph', inline: [{ kind: 'mention', label: 'Paulina Andrzejewska' }] },
    ])
  })

  it('@followers to tez wzmianka, mimo ze nie ma uzytkownika', () => {
    const out = parseCommentBlocks([{ type: 'followers_tag', text: '@followers', field_id: 'followers_tag' }])

    assert.deepStrictEqual(out, [
      { kind: 'paragraph', inline: [{ kind: 'mention', label: 'followers' }] },
    ])
  })
})

describe('odpornosc na smieci', () => {
  it('brak blokow daje pusta liste, nie wyjatek', () => {
    assert.deepStrictEqual(parseCommentBlocks(undefined), [])
    assert.deepStrictEqual(parseCommentBlocks(null), [])
    assert.deepStrictEqual(parseCommentBlocks([]), [])
  })

  it('blok bez pola text nie wywala parsera', () => {
    const out = parseCommentBlocks([{ attributes: {} }, { text: 'Dalej dziala' }])

    assert.deepStrictEqual(out, [{ kind: 'paragraph', inline: [{ kind: 'text', text: 'Dalej dziala' }] }])
  })

  it('wzmianka o zadaniu bez identyfikatora spada do zwyklego tekstu', () => {
    const out = parseCommentBlocks([{ text: 'cos', type: 'task_mention' }])

    assert.deepStrictEqual(out, [{ kind: 'paragraph', inline: [{ kind: 'text', text: 'cos' }] }])
  })
})

describe('formatowanie w linii', () => {
  it('pogrubienie zostaje pogrubieniem, nie gwiazdkami', () => {
    const out = parseCommentBlocks([{ text: 'WAZNE', attributes: { bold: true } }])

    assert.deepStrictEqual(out, [
      { kind: 'paragraph', inline: [{ kind: 'text', text: 'WAZNE', bold: true }] },
    ])
  })

  it('kursywa, przekreslenie i kod sa rozpoznawane osobno', () => {
    const out = parseCommentBlocks([
      { text: 'a', attributes: { italic: true } },
      { text: 'b', attributes: { strike: true } },
      { text: 'c', attributes: { code: true } },
    ])

    assert.deepStrictEqual(inlineOf(out[0]), [
      { kind: 'text', text: 'a', italic: true },
      { kind: 'text', text: 'b', strike: true },
      { kind: 'text', text: 'c', code: true },
    ])
  })

  it('kilka atrybutow na jednym biegu tekstu skladaja sie', () => {
    const out = parseCommentBlocks([{ text: 'oba', attributes: { bold: true, italic: true } }])

    assert.deepStrictEqual(inlineOf(out[0]), [{ kind: 'text', text: 'oba', bold: true, italic: true }])
  })

  it('link z etykieta zachowuje ADRES, nie tylko widoczny napis', () => {
    const out = parseCommentBlocks([
      { text: 'panel sklepu', attributes: { link: 'https://gemsonyx.com/wp-admin/' } },
    ])

    assert.deepStrictEqual(inlineOf(out[0]), [
      { kind: 'text', text: 'panel sklepu', link: 'https://gemsonyx.com/wp-admin/' },
    ])
  })

  it('atrybut ktorego nie obslugujemy nie psuje tekstu', () => {
    const out = parseCommentBlocks([{ text: 'tekst', attributes: { 'color-class': 'cu-red', align: 'center' } }])

    assert.deepStrictEqual(inlineOf(out[0]), [{ kind: 'text', text: 'tekst' }])
  })

  it('atrybuty nie przeciekaja na nastepny bieg tekstu', () => {
    const out = parseCommentBlocks([
      { text: 'grube', attributes: { bold: true } },
      { text: ' chude' },
    ])

    assert.deepStrictEqual(inlineOf(out[0]), [
      { kind: 'text', text: 'grube', bold: true },
      { kind: 'text', text: ' chude' },
    ])
  })

  it('link na adresie z niebezpiecznym schematem jest odrzucany', () => {
    const out = parseCommentBlocks([
      { text: 'kliknij', attributes: { link: 'javascript:alert(1)' } },
    ])

    assert.deepStrictEqual(inlineOf(out[0]), [{ kind: 'text', text: 'kliknij' }])
  })
})

describe('bloki liniowe', () => {
  /** Atrybut linii siedzi na wstawce konczacej te linie. To sedno formatu. */
  const koniec = (attributes: Record<string, unknown>) => ({ text: '\n', attributes })

  it('linia z atrybutem listy staje sie punktem, nie akapitem', () => {
    const out = parseCommentBlocks([{ text: 'pierwszy' }, koniec({ list: { list: 'bullet' } })])

    assert.deepStrictEqual(out, [
      { kind: 'bullets', items: [[{ kind: 'text', text: 'pierwszy' }]] },
    ])
  })

  it('kolejne punkty skladaja sie w JEDNA liste', () => {
    const out = parseCommentBlocks([
      { text: 'pierwszy' },
      koniec({ list: { list: 'bullet' } }),
      { text: 'drugi' },
      koniec({ list: { list: 'bullet' } }),
    ])

    assert.strictEqual(out.length, 1)
    assert.deepStrictEqual(out[0], {
      kind: 'bullets',
      items: [[{ kind: 'text', text: 'pierwszy' }], [{ kind: 'text', text: 'drugi' }]],
    })
  })

  it('akapit miedzy punktami rozdziela dwie listy', () => {
    const out = parseCommentBlocks([
      { text: 'a' },
      koniec({ list: { list: 'bullet' } }),
      { text: 'przerwa' },
      koniec({}),
      { text: 'b' },
      koniec({ list: { list: 'bullet' } }),
    ])

    assert.deepStrictEqual(out.map(b => b.kind), ['bullets', 'paragraph', 'bullets'])
  })

  it('lista numerowana to inny rodzaj bloku niz punktowana', () => {
    const out = parseCommentBlocks([{ text: 'raz' }, koniec({ list: { list: 'ordered' } })])

    assert.deepStrictEqual(out, [
      { kind: 'ordered', items: [[{ kind: 'text', text: 'raz' }]] },
    ])
  })

  it('punktowana i numerowana obok siebie nie zlewaja sie w jedna', () => {
    const out = parseCommentBlocks([
      { text: 'a' },
      koniec({ list: { list: 'bullet' } }),
      { text: 'b' },
      koniec({ list: { list: 'ordered' } }),
    ])

    assert.deepStrictEqual(out.map(b => b.kind), ['bullets', 'ordered'])
  })

  it('blok kodu zbiera linie i zapamietuje jezyk', () => {
    const out = parseCommentBlocks([
      { text: '.a { color: red }' },
      koniec({ 'code-block': { 'code-block': 'css' } }),
      { text: '.b { color: blue }' },
      koniec({ 'code-block': { 'code-block': 'css' } }),
    ])

    assert.deepStrictEqual(out, [
      { kind: 'code', language: 'css', lines: ['.a { color: red }', '.b { color: blue }'] },
    ])
  })

  it('blok kodu bez podanego jezyka ma jezyk null, a nie napis', () => {
    const out = parseCommentBlocks([{ text: 'echo 1' }, koniec({ 'code-block': true })])

    assert.deepStrictEqual(out, [{ kind: 'code', language: null, lines: ['echo 1'] }])
  })

  it('w bloku kodu formatowanie nie jest doklejane, bo kod to kod', () => {
    const out = parseCommentBlocks([
      { text: 'const a = 1', attributes: { bold: true } },
      koniec({ 'code-block': { 'code-block': 'js' } }),
    ])

    assert.deepStrictEqual(out, [{ kind: 'code', language: 'js', lines: ['const a = 1'] }])
  })

  it('cytat jest osobnym blokiem', () => {
    const out = parseCommentBlocks([{ text: 'klient napisal' }, koniec({ blockquote: true })])

    assert.deepStrictEqual(out, [
      { kind: 'quote', inline: [{ kind: 'text', text: 'klient napisal' }] },
    ])
  })

  it('naglowek zachowuje poziom', () => {
    const out = parseCommentBlocks([{ text: 'Podsumowanie' }, koniec({ header: 2 })])

    assert.deepStrictEqual(out, [
      { kind: 'heading', level: 2, inline: [{ kind: 'text', text: 'Podsumowanie' }] },
    ])
  })

  it('poziom naglowka jest przycinany do zakresu, ktory umiemy wyrenderowac', () => {
    const out = parseCommentBlocks([{ text: 'x' }, koniec({ header: 9 })])

    assert.deepStrictEqual(out, [{ kind: 'heading', level: 3, inline: [{ kind: 'text', text: 'x' }] }])
  })

  it('lista zamyka sie na koncu komentarza, bez zjadania ostatniego punktu', () => {
    const out = parseCommentBlocks([
      { text: 'ostatni' },
      koniec({ list: { list: 'bullet' } }),
    ])

    assert.strictEqual(out.length, 1)
    assert.deepStrictEqual(out[0], { kind: 'bullets', items: [[{ kind: 'text', text: 'ostatni' }]] })
  })
})

describe('obrazki, pliki, wideo', () => {
  const OBRAZEK = {
    text: 'image.png',
    type: 'image',
    image: {
      id: '84a2a375.png',
      url: 'https://t4552118.p.clickup-attachments.com/t4552118/84a2a375/image.png',
      name: 'image.png',
      width: 940,
      height: 842,
    },
    attributes: { alt: 'image.png', width: '300' },
  }

  it('obrazek to obrazek, nie napis "image.png"', () => {
    const out = parseCommentBlocks([OBRAZEK])

    assert.deepStrictEqual(out, [
      {
        kind: 'image',
        url: 'https://t4552118.p.clickup-attachments.com/t4552118/84a2a375/image.png',
        name: 'image.png',
        width: 940,
        height: 842,
      },
    ])
  })

  it('obrazek konczy biezacy akapit, zeby nie wisial w srodku zdania', () => {
    const out = parseCommentBlocks([{ text: 'Zobacz:' }, OBRAZEK])

    assert.deepStrictEqual(out.map(b => b.kind), ['paragraph', 'image'])
  })

  it('obrazek bez adresu jest pomijany, nie renderowany jako pusty', () => {
    const out = parseCommentBlocks([{ text: 'x.png', type: 'image', image: { name: 'x.png' } }])

    assert.deepStrictEqual(out, [])
  })

  it('zalacznik zostaje plikiem z nazwa i adresem', () => {
    const out = parseCommentBlocks([
      {
        text: 'pomiary.pdf',
        type: 'attachment',
        attachment: {
          title: 'pomiary.pdf',
          extension: 'pdf',
          size: 120000,
          url: 'https://t4552118.p.clickup-attachments.com/t4552118/dcf1f91c/pomiary.pdf',
        },
      },
    ])

    assert.deepStrictEqual(out, [
      {
        kind: 'file',
        url: 'https://t4552118.p.clickup-attachments.com/t4552118/dcf1f91c/pomiary.pdf',
        name: 'pomiary.pdf',
      },
    ])
  })

  it('zalacznik ktory jest obrazkiem tez pokazujemy jako obrazek', () => {
    const out = parseCommentBlocks([
      {
        text: 'zrzut.png',
        type: 'attachment',
        attachment: {
          title: 'zrzut.png',
          extension: 'png',
          mimetype: 'image/png',
          url: 'https://t4552118.p.clickup-attachments.com/t4552118/aaa/zrzut.png',
        },
      },
    ])

    assert.deepStrictEqual(out[0].kind, 'image')
  })

  it('wideo z ClickUpa zostaje wideo', () => {
    const out = parseCommentBlocks([
      {
        type: 'frame',
        frame: {
          service: 'clickup_video',
          url: 'https://t4552118.p.clickup-attachments.com/t4552118/859255f7/film.mp4?view=open',
        },
        text: 'https://t4552118.p.clickup-attachments.com/t4552118/859255f7/film.mp4?view=open',
      },
    ])

    assert.deepStrictEqual(out, [
      {
        kind: 'video',
        url: 'https://t4552118.p.clickup-attachments.com/t4552118/859255f7/film.mp4?view=open',
        name: 'film.mp4',
      },
    ])
  })

  it('osadzenie z obcego serwisu, ktorego nie odtworzymy, zostaje linkiem', () => {
    const out = parseCommentBlocks([
      { type: 'frame', frame: { service: 'youtube', url: 'https://youtu.be/abc' }, text: 'https://youtu.be/abc' },
    ])

    assert.deepStrictEqual(out[0], {
      kind: 'paragraph',
      inline: [{ kind: 'text', text: 'https://youtu.be/abc', link: 'https://youtu.be/abc' }],
    })
  })
})

describe('linki osadzone i emoji', () => {
  it('zakladka staje sie klikalnym linkiem', () => {
    const out = parseCommentBlocks([
      { type: 'bookmark', bookmark: { service: 'custom', url: 'https://www.onyxwroclaw.pl/adm' } },
    ])

    assert.deepStrictEqual(out, [
      {
        kind: 'paragraph',
        inline: [{ kind: 'text', text: 'https://www.onyxwroclaw.pl/adm', link: 'https://www.onyxwroclaw.pl/adm' }],
      },
    ])
  })

  it('link_mention z pustym tekstem nie gubi adresu', () => {
    const out = parseCommentBlocks([
      { type: 'link_mention', link_mention: { url: 'https://gemsonyx.com/wp-admin/admin.php?page=x' }, text: '' },
    ])

    assert.deepStrictEqual(inlineOf(out[0]), [
      {
        kind: 'text',
        text: 'https://gemsonyx.com/wp-admin/admin.php?page=x',
        link: 'https://gemsonyx.com/wp-admin/admin.php?page=x',
      },
    ])
  })

  it('emoji zostaje w tresci jako znak', () => {
    const out = parseCommentBlocks([
      { text: 'Dziala ' },
      { type: 'emoticon', emoticon: { code: '1f604', name: 'Smiling Face' }, text: '\u{1F604}' },
    ])

    assert.deepStrictEqual(inlineOf(out[0]), [
      { kind: 'text', text: 'Dziala ' },
      { kind: 'text', text: '\u{1F604}' },
    ])
  })
})

describe('tabele', () => {
  /** Komorki tabeli maja WLASNA delte, w ktorej tekst siedzi pod `insert`, nie `text`. */
  const komorka = (text: string, attributes: Record<string, unknown> = {}) => ({
    content: [{ insert: text, attributes }, { insert: '\n' }],
    attributes: { colspan: '1', rowspan: '1' },
  })

  const TABELA = {
    type: 'table-embed',
    'table-embed': {
      rows: [{ insert: { id: 'row-1' } }, { insert: { id: 'row-2' } }],
      columns: [{ insert: { id: 'col-1' } }, { insert: { id: 'col-2' } }],
      cells: {
        '1:1': komorka('Co mierzylismy'),
        '1:2': komorka('Jest'),
        '2:1': komorka('Odpowiedz serwera'),
        '2:2': komorka('1,15 s', { bold: true }),
      },
    },
  }

  it('tabela zostaje tabela, a nie znika z komentarza', () => {
    const out = parseCommentBlocks([TABELA])

    assert.strictEqual(out.length, 1)
    assert.strictEqual(out[0].kind, 'table')
  })

  it('tresc komorek jest czytana z zagniezdzonej delty', () => {
    const out = parseCommentBlocks([TABELA])
    const table = out[0] as { kind: 'table'; rows: unknown[][][] }

    assert.deepStrictEqual(table.rows, [
      [[{ kind: 'text', text: 'Co mierzylismy' }], [{ kind: 'text', text: 'Jest' }]],
      [[{ kind: 'text', text: 'Odpowiedz serwera' }], [{ kind: 'text', text: '1,15 s', bold: true }]],
    ])
  })

  it('brakujaca komorka daje pusta, nie przesuwa kolumn', () => {
    const out = parseCommentBlocks([
      {
        type: 'table-embed',
        'table-embed': {
          rows: [{ insert: { id: 'row-1' } }],
          columns: [{ insert: { id: 'col-1' } }, { insert: { id: 'col-2' } }],
          cells: { '1:2': komorka('druga') },
        },
      },
    ])
    const table = out[0] as { kind: 'table'; rows: unknown[][][] }

    assert.deepStrictEqual(table.rows, [[[], [{ kind: 'text', text: 'druga' }]]])
  })

  it('tabela bez komorek jest pomijana, zamiast renderowac pusta ramke', () => {
    const out = parseCommentBlocks([{ type: 'table-embed', 'table-embed': { rows: [], columns: [], cells: {} } }])

    assert.deepStrictEqual(out, [])
  })

  it('tabela zamyka biezacy akapit, bo jest blokiem', () => {
    const out = parseCommentBlocks([{ text: 'Pomiary:' }, TABELA])

    assert.deepStrictEqual(out.map(b => b.kind), ['paragraph', 'table'])
  })
})

describe('blocksToText', () => {
  it('sklada tekst z akapitow, linia na akapit', () => {
    const out = blocksToText([
      { kind: 'paragraph', inline: [{ kind: 'text', text: 'Pierwszy' }] },
      { kind: 'paragraph', inline: [{ kind: 'text', text: 'Drugi' }] },
    ])

    assert.strictEqual(out, 'Pierwszy\nDrugi')
  })

  it('bierze tekst z list, cytatow, naglowkow i tabel', () => {
    const out = blocksToText([
      { kind: 'heading', level: 2, inline: [{ kind: 'text', text: 'Naglowek' }] },
      { kind: 'bullets', items: [[{ kind: 'text', text: 'punkt' }]] },
      { kind: 'ordered', items: [[{ kind: 'text', text: 'krok' }]] },
      { kind: 'quote', inline: [{ kind: 'text', text: 'cytat' }] },
      { kind: 'code', language: 'css', lines: ['a{}'] },
      { kind: 'table', rows: [[[{ kind: 'text', text: 'komorka' }]]] },
    ])

    for (const slowo of ['Naglowek', 'punkt', 'krok', 'cytat', 'a{}', 'komorka']) {
      assert.match(out, new RegExp(slowo.replace(/[{}]/g, '\\$&')))
    }
  })

  it('nazwa pliku zostaje, bo to jedyny slad zalacznika w tekscie', () => {
    const out = blocksToText([{ kind: 'image', url: 'https://x.test/z.png', name: 'zrzut.png' }])

    assert.strictEqual(out, 'zrzut.png')
  })

  it('wzmianka o zadaniu wchodzi nazwa, a bez nazwy nie wchodzi wcale', () => {
    const zNazwa = blocksToText([
      { kind: 'paragraph', inline: [{ kind: 'taskMention', taskId: '869a', name: 'Drobne poprawki' }] },
    ])
    const bezNazwy = blocksToText([
      { kind: 'paragraph', inline: [{ kind: 'taskMention', taskId: '869obcy' }] },
    ])

    assert.strictEqual(zNazwa, 'Drobne poprawki')
    // Identyfikator nie ma prawa wejsc do tekstu, bo tekst idzie tez do
    // wyszukiwarki Historii i pokazuje sie w wynikach.
    assert.strictEqual(bezNazwy, '')
  })

  it('pusta lista blokow daje pusty tekst, nie napis "undefined"', () => {
    assert.strictEqual(blocksToText([]), '')
  })
})

describe('pliki wewnętrzne (nazwa od podkreślenia)', () => {
  it('obrazek z podkreśleniem nie wchodzi do komentarza', () => {
    const bloki = parseCommentBlocks([
      { type: 'image', image: { url: 'https://t.clickup.com/1/_notatka.png', title: '_notatka.png' } },
      { type: 'image', image: { url: 'https://t.clickup.com/2/zrzut.png', title: 'zrzut.png' } },
    ])
    const obrazki = bloki.filter(b => b.kind === 'image')
    assert.equal(obrazki.length, 1)
    assert.equal(obrazki[0].kind === 'image' ? obrazki[0].name : null, 'zrzut.png')
  })

  it('załącznik z podkreśleniem nie wchodzi do komentarza', () => {
    const bloki = parseCommentBlocks([
      { type: 'attachment', attachment: { url: 'https://t.clickup.com/3/_wersja.pdf', title: '_wersja.pdf' } },
    ])
    assert.equal(bloki.filter(b => b.kind === 'file' || b.kind === 'image').length, 0)
  })
})
