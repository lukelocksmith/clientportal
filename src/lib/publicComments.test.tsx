/**
 * Granica [P] / [PUBLIC]: co dociera do klienta, a co zostaje u nas.
 *
 * To jest test bezpieczenstwa, nie formatowania. Blad w jedna strone oznacza
 * niedostarczona odpowiedz, w druga wyciek wewnetrznej korespondencji agencji
 * do portalu klienta i do przeszukiwalnego indeksu Historii.
 *
 *   npm test
 */
import { describe, it } from 'vitest'
import assert from 'node:assert'
import {
  PUBLIC_PREFIX,
  AGENCY_SENDER,
  isPublicComment,
  stripPublicPrefix,
  filterPublicComments,
  publicCommentTexts,
  buildOwnComment,
  publicCommentBlocks,
} from '@/lib/publicComments'
import type { ClickUpComment } from '@/lib/types'

function comment(text: string): ClickUpComment {
  return { id: text.slice(0, 8), comment_text: text, date: '0', user: { id: 1, username: 'x' } } as ClickUpComment
}

describe('isPublicComment', () => {
  it('przepuszcza [P] i [PUBLIC] niezaleznie od wielkosci liter i spacji', () => {
    const przechodzi = [
      '[P] gotowe',
      '[p] gotowe',
      '[P]bez spacji',
      '[ P ] ze spacjami w nawiasie',
      '[PUBLIC] stary prefiks nadal dziala',
      '[public] mala litera',
      '  [P] wciecie przed znacznikiem',
    ]
    for (const text of przechodzi) {
      assert.strictEqual(isPublicComment(text), true, `powinno przejsc: ${JSON.stringify(text)}`)
    }
  })

  it('znacznik liczy sie w DOWOLNYM miejscu tresci', () => {
    // Decyzja Lukasza: przy pisaniu z telefonu pozycja kursora jest przypadkowa.
    assert.strictEqual(isPublicComment('gotowe, mozesz sprawdzac [P]'), true, 'na koncu')
    assert.strictEqual(isPublicComment('juz [P] poprawione'), true, 'w srodku')
    assert.strictEqual(isPublicComment('linia\ndruga [P]\ntrzecia'), true, 'w kolejnej linii')
  })

  it('NIE przepuszcza komentarza bez znacznika', () => {
    const zostaje = [
      'zrobione, ale nie mow klientowi',
      'PUBLIC bez nawiasow',
      'P',
      '',
    ]
    for (const text of zostaje) {
      assert.strictEqual(isPublicComment(text), false, `nie powinno przejsc: ${JSON.stringify(text)}`)
    }
    assert.strictEqual(isPublicComment(null), false)
    assert.strictEqual(isPublicComment(undefined), false)
  })

  it('NIE przepuszcza innych oznaczen w nawiasach', () => {
    // Wzorzec jest zamkniety na dokladnie `p` albo `public`. Przy dopasowaniu w
    // dowolnym miejscu kazde poszerzenie to nowa droga wycieku.
    const obce = [
      '[Pilne] poprawic do wtorku',
      '[PL] wersja polska',
      '[Priorytet] wysoki',
      '[PM] pytanie do Pauliny',
      '[przypomnienie] dopytac klienta',
    ]
    for (const text of obce) {
      assert.strictEqual(isPublicComment(text), false, `nie powinno przejsc: ${JSON.stringify(text)}`)
    }
  })
})

describe('stripPublicPrefix', () => {
  it('zdejmuje znacznik z poczatku i podpisuje agencje', () => {
    assert.deepStrictEqual(stripPublicPrefix('[P] gotowe'), { text: 'gotowe', sender: AGENCY_SENDER })
    assert.deepStrictEqual(stripPublicPrefix('[PUBLIC] gotowe'), { text: 'gotowe', sender: AGENCY_SENDER })
  })

  it('agencja podpisuje sie ZESPOLEM, nigdy imieniem konkretnej osoby', () => {
    // Zgloszone przez Lukasza 24.08. Klient ma widziec, ze odpowiedzial
    // important.is, a nie ktora osoba z zespolu siedziala tego dnia przy
    // zadaniu. Kto konkretnie, wiadomo z ClickUpa i z audit_log, czyli po
    // NASZEJ stronie.
    assert.strictEqual(AGENCY_SENDER, 'Zespół important.is')
    assert.ok(!AGENCY_SENDER.includes('Admin'), 'konto obejsciowe nie moze byc twarza agencji')
  })

  it('rozpoznaje autora po stronie klienta', () => {
    const { text, sender } = stripPublicPrefix(`${PUBLIC_PREFIX}(Anna) prosze o poprawke`)
    assert.strictEqual(sender, 'Anna')
    assert.strictEqual(text, 'prosze o poprawke')
  })

  it('usuwa znacznik ze srodka bez zlepiania slow', () => {
    assert.strictEqual(stripPublicPrefix('juz [P] poprawione').text, 'juz poprawione')
    assert.strictEqual(stripPublicPrefix('gotowe [P]').text, 'gotowe')
    // Dwa znaczniki to nie blad uzytkownika wart pokazywania klientowi.
    assert.strictEqual(stripPublicPrefix('[P] gotowe [P]').text, 'gotowe')
  })

  it('nie rusza wciec w kolejnych liniach', () => {
    // Znacznik na koncu linii schodzi bez sladu, ale lista markdown ponizej
    // musi zostac wcieta, bo inaczej zmienia sie formatowanie tresci.
    const out = stripPublicPrefix('[P] zrobione:\n  - punkt pierwszy\n  - punkt drugi').text
    assert.strictEqual(out, 'zrobione:\n  - punkt pierwszy\n  - punkt drugi')
  })
})

describe('filterPublicComments', () => {
  it('wpuszcza tylko oznaczone i zdejmuje z nich znacznik', () => {
    const wejscie = [
      comment('[P] Poprawione, sprawdz prosze.'),
      comment('wewnetrzne: klient nie zaplacil jeszcze faktury'),
      comment('[PUBLIC] (Anna) dziekuje'),
      comment('do zrobienia po godzinach'),
    ]
    const wynik = filterPublicComments(wejscie)

    assert.strictEqual(wynik.length, 2, 'przeszly tylko dwa oznaczone')
    assert.deepStrictEqual(
      wynik.map(c => c.comment_text),
      ['Poprawione, sprawdz prosze.', 'dziekuje']
    )
    assert.deepStrictEqual(wynik.map(c => c.sender), [AGENCY_SENDER, 'Anna'])

    // Najwazniejsza asercja tego pliku: zadna wewnetrzna tresc nie wyszla.
    const wyjscie = wynik.map(c => c.comment_text).join(' ')
    assert.ok(!wyjscie.includes('faktury'), 'WYCIEK wewnetrznego komentarza')
    assert.ok(!wyjscie.includes('po godzinach'), 'WYCIEK wewnetrznego komentarza')
  })
})

describe('publicCommentTexts', () => {
  it('do indeksu wyszukiwania wchodza tylko tresci publiczne', () => {
    const teksty = publicCommentTexts([
      comment('[P] zmiana koloru naglowka'),
      comment('budzet klienta konczy sie w marcu'),
      comment('[P]   '),
    ])
    // Komentarz oznaczony, ale pusty po zdjeciu znacznika, nie wnosi nic do
    // wyszukiwania i tylko podbijalby licznik.
    assert.deepStrictEqual(teksty, ['zmiana koloru naglowka'])
  })
})

describe('buildOwnComment', () => {
  it('dziala nawet z okrojona odpowiedzia ClickUpa (bez comment_text, user, resolved)', () => {
    // To jest DOKLADNIE odpowiedz, ktora zwraca prawdziwe API ClickUpa z
    // POST /task/{id}/comment: id, hist_id, date, i nic wiecej. Kod, ktory
    // by uzyl `created.comment_text` wprost, dostalby undefined. Zgloszone
    // przez Lukasza 2026-08-10: "Cannot read properties of undefined
    // (reading 'split')" przy renderowaniu swiezo dodanego komentarza.
    const okrojona = { id: 'abc123', date: '1733900000000' }

    const wynik = buildOwnComment(okrojona, 'dziekuje, dziala', 'Anna')

    assert.strictEqual(wynik.comment_text, 'dziekuje, dziala')
    assert.strictEqual(wynik.id, 'abc123')
    assert.strictEqual(wynik.date, '1733900000000')
    assert.strictEqual(wynik.sender, 'Anna')
    assert.strictEqual(wynik.isOwn, true)
  })

  it('brak imienia w sesji daje sender "Klient", nie undefined', () => {
    const wynik = buildOwnComment({ id: 'x', date: '1' }, 'tresc', null)
    assert.strictEqual(wynik.sender, 'Klient')
  })

  it('brak daty w odpowiedzi ClickUpa nie zostawia pustego pola', () => {
    // ClickUp zwykle podaje date, ale kod nie ma prawa zalozyc, ze zawsze.
    const wynik = buildOwnComment({ id: 'x' }, 'tresc', 'Anna')
    assert.ok(wynik.date && wynik.date.length > 0, 'date nie moze byc puste')
  })

  it('tresc jest przycinana, tak samo jak przy wysylce do ClickUpa', () => {
    const wynik = buildOwnComment({ id: 'x', date: '1' }, '  ze spacjami  ', 'Anna')
    assert.strictEqual(wynik.comment_text, 'ze spacjami')
  })
})

describe('buildOwnComment -> MarkdownLite (zamkniecie petli)', () => {
  it('wynik buildOwnComment renderuje sie bez wywalenia szuflady', async () => {
    // To jest dokladnie miejsce, w ktorym pekl portal: undefined.split() przy
    // renderowaniu swiezo dodanego komentarza. Test przechodzi caly lancuch
    // od odpowiedzi ClickUpa do renderowania, nie tylko sam ksztalt obiektu.
    const { renderToStaticMarkup } = await import('react-dom/server')
    const { MarkdownLite } = await import('@/components/kanban/MarkdownLite')

    const okrojona = { id: 'abc123', date: '1733900000000' }
    const swiezyKomentarz = buildOwnComment(okrojona, 'dzieki, **super** robota', 'Anna')

    const html = renderToStaticMarkup(<MarkdownLite text={swiezyKomentarz.comment_text} />)
    assert.ok(html.includes('<strong>super</strong>'))
  })
})

describe('publicCommentBlocks', () => {
  /** Komentarz z prawdziwymi blokami ClickUpa, tak jak przychodzi z API. */
  function zBlokami(blocks: unknown[], text: string): ClickUpComment {
    return { id: 'c1', comment: blocks, comment_text: text, date: '0', user: null } as unknown as ClickUpComment
  }

  it('znacznik [P] nie zostaje w tresci pokazywanej klientowi', () => {
    const out = publicCommentBlocks(
      zBlokami([{ text: '[P] Poprawione.' }], '[P] Poprawione.')
    )

    assert.deepStrictEqual(out, [{ kind: 'paragraph', inline: [{ kind: 'text', text: 'Poprawione.' }] }])
  })

  it('znacznik w osobnej linii nie zostawia pustego akapitu na gorze', () => {
    const out = publicCommentBlocks(
      zBlokami(
        [{ text: '[P]' }, { text: '\n', attributes: { 'block-id': 'b1' } }, { text: 'Tresc' }],
        '[P]\nTresc'
      )
    )

    assert.deepStrictEqual(out, [{ kind: 'paragraph', inline: [{ kind: 'text', text: 'Tresc' }] }])
  })

  it('podpis klienta (Imie) nie zostaje w tresci, bo autor jest w naglowku', () => {
    const out = publicCommentBlocks(
      zBlokami([{ text: '[P] (Anna) dziekuje za szybka reakcje' }], '[P] (Anna) dziekuje za szybka reakcje')
    )

    assert.deepStrictEqual(out, [
      { kind: 'paragraph', inline: [{ kind: 'text', text: 'dziekuje za szybka reakcje' }] },
    ])
  })

  it('nawias w SRODKU zdania zostaje, bo to nie podpis', () => {
    const out = publicCommentBlocks(
      zBlokami([{ text: '[P] poprawione (tak jak ustalalismy)' }], '[P] poprawione (tak jak ustalalismy)')
    )

    assert.deepStrictEqual(out[0], {
      kind: 'paragraph',
      inline: [{ kind: 'text', text: 'poprawione (tak jak ustalalismy)' }],
    })
  })

  it('znacznik wewnatrz linii zwija sie do jednej spacji, nie zlepia slow', () => {
    const out = publicCommentBlocks(
      zBlokami([{ text: 'zrobione [P] sprawdz' }], 'zrobione [P] sprawdz')
    )

    assert.deepStrictEqual(out[0], {
      kind: 'paragraph',
      inline: [{ kind: 'text', text: 'zrobione sprawdz' }],
    })
  })

  it('znacznik zdejmuje sie takze z punktu listy', () => {
    const out = publicCommentBlocks(
      zBlokami(
        [{ text: '[P] pierwszy' }, { text: '\n', attributes: { list: { list: 'bullet' } } }],
        '[P] pierwszy'
      )
    )

    assert.deepStrictEqual(out, [{ kind: 'bullets', items: [[{ kind: 'text', text: 'pierwszy' }]] }])
  })

  it('komentarz bez blokow (stary, tylko comment_text) nie gubi tresci', () => {
    const out = publicCommentBlocks({
      id: 'c2',
      comment_text: '[P] Zrobione.',
      date: '0',
      user: null,
    } as unknown as ClickUpComment)

    assert.deepStrictEqual(out, [{ kind: 'paragraph', inline: [{ kind: 'text', text: 'Zrobione.' }] }])
  })

  it('formatowanie przezywa zdjecie znacznika', () => {
    const out = publicCommentBlocks(
      zBlokami(
        [{ text: '[P] ' }, { text: 'WAZNE', attributes: { bold: true } }],
        '[P] WAZNE'
      )
    )

    assert.deepStrictEqual(out[0], {
      kind: 'paragraph',
      inline: [{ kind: 'text', text: 'WAZNE', bold: true }],
    })
  })
})

describe('bloki doczepione do komentarza', () => {
  it('filterPublicComments dokleja gotowe bloki, ze zdjetym znacznikiem', () => {
    const wejscie = [
      {
        id: 'c1',
        comment: [
          { text: '[P] Poprawione w ' },
          { text: '869enjjkr', type: 'task_mention', task_mention: { task_id: '869enjjkr' } },
        ],
        comment_text: '[P] Poprawione w 869enjjkr',
        date: '0',
        user: null,
      },
    ] as unknown as ClickUpComment[]

    const [wynik] = filterPublicComments(wejscie)

    assert.deepStrictEqual(wynik.blocks, [
      {
        kind: 'paragraph',
        inline: [
          { kind: 'text', text: 'Poprawione w ' },
          { kind: 'taskMention', taskId: '869enjjkr' },
        ],
      },
    ])
  })

  it('komentarz wewnetrzny nie dostaje blokow, bo nie wychodzi wcale', () => {
    const wynik = filterPublicComments([comment('wewnetrzne: nie placi faktur')])

    assert.strictEqual(wynik.length, 0)
  })

  it('buildOwnComment ma bloki, zeby swiezy komentarz renderowal sie tak samo', () => {
    const own = buildOwnComment({ id: 'x1' }, 'Dziekuje za szybka reakcje', 'Anna')

    assert.deepStrictEqual(own.blocks, [
      { kind: 'paragraph', inline: [{ kind: 'text', text: 'Dziekuje za szybka reakcje' }] },
    ])
  })

  it('swiezy komentarz z kilku linii ma kilka akapitow, nie jeden zlepek', () => {
    const own = buildOwnComment({ id: 'x2' }, 'Pierwsza linia\nDruga linia', 'Anna')

    assert.deepStrictEqual(own.blocks?.length, 2)
  })
})

describe('wzmianki o osobach nie docieraja do klienta', () => {
  /** Komentarz z prawdziwymi blokami ClickUpa. */
  function zBlokami(blocks: unknown[]): ClickUpComment {
    return { id: 'c1', comment: blocks, comment_text: '', date: '0', user: null } as unknown as ClickUpComment
  }

  const wzmianka = (imie = 'Paulina Andrzejewska') => ({
    type: 'tag',
    text: `@${imie}`,
    user: { id: 1, username: imie },
  })

  it('ZGLOSZENIE: oznaczenie osoby z zespolu w ogole sie nie pokazuje', () => {
    // Artem oznaczal Pauline, zeby dostala powiadomienie w ClickUpie. To jest
    // ruch wewnatrz zespolu, nie tresc dla klienta.
    const out = publicCommentBlocks(
      zBlokami([wzmianka(), { text: '\n', attributes: { 'block-id': 'b1' } }, { text: 'Poprawione.' }])
    )

    assert.deepStrictEqual(out, [{ kind: 'paragraph', inline: [{ kind: 'text', text: 'Poprawione.' }] }])
  })

  it('linia zlozona TYLKO ze wzmianki znika cala, nie zostawia pustego akapitu', () => {
    const out = publicCommentBlocks(
      zBlokami([
        { text: 'Pierwszy akapit.' },
        { text: '\n', attributes: { 'block-id': 'b1' } },
        wzmianka(),
        { text: '\n', attributes: { 'block-id': 'b2' } },
        { text: 'Drugi akapit.' },
      ])
    )

    assert.deepStrictEqual(out, [
      { kind: 'paragraph', inline: [{ kind: 'text', text: 'Pierwszy akapit.' }] },
      { kind: 'paragraph', inline: [{ kind: 'text', text: 'Drugi akapit.' }] },
    ])
  })

  it('wzmianka na POCZATKU zdania nie zostawia spacji na wcieciu', () => {
    const out = publicCommentBlocks(zBlokami([wzmianka(), { text: ' sprawdz prosze.' }]))

    assert.deepStrictEqual(out, [
      { kind: 'paragraph', inline: [{ kind: 'text', text: 'sprawdz prosze.' }] },
    ])
  })

  it('wzmianka w SRODKU zdania nie zostawia podwojnej spacji', () => {
    const out = publicCommentBlocks(
      zBlokami([{ text: 'Prosze ' }, wzmianka(), { text: ' o sprawdzenie.' }])
    )
    const inline = (out[0] as { inline: Array<{ text: string }> }).inline

    assert.strictEqual(inline.map(n => n.text).join(''), 'Prosze o sprawdzenie.')
  })

  it('@followers tez nie jest trescia dla klienta', () => {
    const out = publicCommentBlocks(
      zBlokami([{ type: 'followers_tag', text: '@followers', field_id: 'followers_tag' }, { text: ' gotowe' }])
    )

    assert.deepStrictEqual(out, [{ kind: 'paragraph', inline: [{ kind: 'text', text: 'gotowe' }] }])
  })

  it('wzmianka w punkcie listy znika, punkt zostaje', () => {
    const out = publicCommentBlocks(
      zBlokami([
        { text: 'zrobione przez ' },
        wzmianka(),
        { text: '\n', attributes: { list: { list: 'bullet' } } },
      ])
    )

    assert.deepStrictEqual(out, [{ kind: 'bullets', items: [[{ kind: 'text', text: 'zrobione przez' }]] }])
  })

  it('punkt listy zlozony tylko ze wzmianki znika, lista nie zostaje pusta', () => {
    const out = publicCommentBlocks(
      zBlokami([
        { text: 'prawdziwy punkt' },
        { text: '\n', attributes: { list: { list: 'bullet' } } },
        wzmianka(),
        { text: '\n', attributes: { list: { list: 'bullet' } } },
      ])
    )

    assert.deepStrictEqual(out, [{ kind: 'bullets', items: [[{ kind: 'text', text: 'prawdziwy punkt' }]] }])
  })

  it('komentarz zlozony WYLACZNIE ze wzmianki nie zostawia nic do pokazania', () => {
    const out = publicCommentBlocks(zBlokami([wzmianka()]))

    assert.deepStrictEqual(out, [])
  })

  it('wzmianka o ZADANIU zostaje, bo to kontekst dla klienta, nie powiadomienie', () => {
    const out = publicCommentBlocks(
      zBlokami([
        { text: 'patrz ' },
        { text: '869abc', type: 'task_mention', task_mention: { task_id: '869abc' } },
      ])
    )

    assert.deepStrictEqual(out, [
      {
        kind: 'paragraph',
        inline: [{ kind: 'text', text: 'patrz ' }, { kind: 'taskMention', taskId: '869abc' }],
      },
    ])
  })
})

describe('co NIE wychodzi do przegladarki', () => {
  it('surowe bloki ClickUpa nie jada razem z gotowymi', () => {
    // Pole `comment` to nieprzetworzony zapis z ClickUpa: ze znacznikiem [P] i
    // ze wzmiankami o osobach. Renderowanie ich nie uzywa, ale dopoki lecialy
    // w odpowiedzi, to co usunelismy z widoku bylo dalej w przegladarce
    // klienta, do odczytania w narzedziach deweloperskich.
    const wejscie = [
      {
        id: 'c1',
        comment: [
          { text: '[P] ' },
          { type: 'tag', text: '@Paulina Andrzejewska', user: { id: 1, username: 'Paulina Andrzejewska' } },
          { text: ' gotowe' },
        ],
        comment_text: '[P] @Paulina Andrzejewska gotowe',
        date: '0',
        user: null,
      },
    ] as unknown as ClickUpComment[]

    const wynik = filterPublicComments(wejscie)
    const wyslane = JSON.stringify(wynik)

    assert.strictEqual('comment' in wynik[0], false, 'surowe bloki nadal jada do klienta')
    assert.ok(!wyslane.includes('Paulina'), 'WYCIEK oznaczenia osoby')
    assert.ok(!wyslane.includes('[P]'), 'znacznik nadal jedzie do klienta')
  })

  it('gotowe bloki i tekst zostaja, bo z nich renderuje sie watek', () => {
    const wynik = filterPublicComments([comment('[P] Zrobione.')])

    assert.deepStrictEqual(wynik[0].comment_text, 'Zrobione.')
    assert.deepStrictEqual(wynik[0].blocks, [
      { kind: 'paragraph', inline: [{ kind: 'text', text: 'Zrobione.' }] },
    ])
  })
})

describe('komentarz wychodzi do klienta z WYBRANYMI polami', () => {
  /** Komentarz w kształcie, w jakim naprawdę oddaje go ClickUp. */
  const zClickUpa = () =>
    ({
      id: 'c1',
      comment: [{ text: '[P] gotowe' }],
      comment_text: '[P] gotowe',
      date: '1786025083695',
      resolved: false,
      reply_count: 0,
      reactions: [],
      assignee: null,
      group_assignee: null,
      user: {
        id: 94729587,
        username: 'Paulina Andrzejewska',
        email: 'andrzejewska.paulina78@gmail.com',
        initials: 'PA',
        profilePicture: 'https://attachments.clickup.com/profilePictures/94729587.jpg',
      },
    }) as unknown as ClickUpComment

  it('WYCIEK: prywatny mail autora z zespolu nie jedzie do klienta', () => {
    const wyslane = JSON.stringify(filterPublicComments([zClickUpa()]))

    assert.ok(!wyslane.includes('gmail.com'), 'adres prywatny w przegladarce klienta')
    assert.ok(!wyslane.includes('Paulina'), 'imie i nazwisko autora z zespolu')
    assert.ok(!wyslane.includes('profilePictures'), 'zdjecie profilowe autora')
  })

  it('wychodza DOKLADNIE pola, ktore portal renderuje', () => {
    // Lista wprost, nie „bez tych kilku". Nowe pole od ClickUpa ma trafic do
    // klienta dopiero wtedy, gdy ktos je tu swiadomie dopisze.
    const [wynik] = filterPublicComments([zClickUpa()])

    assert.deepStrictEqual(Object.keys(wynik).sort(), ['blocks', 'comment_text', 'date', 'id', 'sender'])
  })

  it('autor jest w polu sender, wiec klient nadal wie, kto odpowiedzial', () => {
    const [agencja] = filterPublicComments([zClickUpa()])
    const [klient] = filterPublicComments([comment('[P] (Anna) dziekuje')])

    assert.strictEqual(agencja.sender, AGENCY_SENDER)
    assert.strictEqual(klient.sender, 'Anna')
  })
})
