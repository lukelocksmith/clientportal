import { describe, it } from 'vitest'
import assert from 'node:assert'
import { collectTaskMentions, applyTaskMentions, resolveTaskMentions } from './commentMentions'
import type { BlockNode } from './commentBlocks'

/**
 * Wzmianki o zadaniach w komentarzach.
 *
 * Reguła, na której stoi ten plik: nazwę zadania pokazujemy TYLKO wtedy, gdy to
 * zadanie należy do portalu tego klienta. Komentarz publiczny może wspominać
 * zadanie z innej listy albo z innego klienta, a nazwa takiego zadania to
 * wyciek, nie brakujący kontekst. Nierozpoznane zadanie zostaje bez nazwy i bez
 * linku.
 *
 *   npx vitest run src/lib/commentMentions.test.ts
 */

describe('collectTaskMentions', () => {
  it('zbiera identyfikatory z akapitow', () => {
    const blocks: BlockNode[] = [
      {
        kind: 'paragraph',
        inline: [
          { kind: 'text', text: 'patrz ' },
          { kind: 'taskMention', taskId: '869a' },
        ],
      },
      { kind: 'paragraph', inline: [{ kind: 'taskMention', taskId: '869b' }] },
    ]

    assert.deepStrictEqual(collectTaskMentions(blocks), ['869a', '869b'])
  })

  it('zaglada takze do list, cytatow, naglowkow i tabel', () => {
    const blocks: BlockNode[] = [
      { kind: 'bullets', items: [[{ kind: 'taskMention', taskId: '869list' }]] },
      { kind: 'ordered', items: [[{ kind: 'taskMention', taskId: '869ord' }]] },
      { kind: 'quote', inline: [{ kind: 'taskMention', taskId: '869quote' }] },
      { kind: 'heading', level: 2, inline: [{ kind: 'taskMention', taskId: '869head' }] },
      { kind: 'table', rows: [[[{ kind: 'taskMention', taskId: '869tab' }]]] },
    ]

    assert.deepStrictEqual(collectTaskMentions(blocks), ['869list', '869ord', '869quote', '869head', '869tab'])
  })

  it('nie powtarza tego samego zadania dwa razy', () => {
    const blocks: BlockNode[] = [
      { kind: 'paragraph', inline: [{ kind: 'taskMention', taskId: '869a' }, { kind: 'taskMention', taskId: '869a' }] },
    ]

    assert.deepStrictEqual(collectTaskMentions(blocks), ['869a'])
  })

  it('komentarz bez wzmianek daje pusta liste', () => {
    assert.deepStrictEqual(collectTaskMentions([{ kind: 'paragraph', inline: [{ kind: 'text', text: 'nic' }] }]), [])
  })
})

describe('applyTaskMentions', () => {
  const blocks: BlockNode[] = [
    {
      kind: 'paragraph',
      inline: [
        { kind: 'text', text: 'patrz ' },
        { kind: 'taskMention', taskId: '869a' },
        { kind: 'text', text: ' oraz ' },
        { kind: 'taskMention', taskId: '869obcy' },
      ],
    },
  ]

  it('zadanie z portalu dostaje nazwe', () => {
    const out = applyTaskMentions(blocks, new Map([['869a', 'Poprawki filtrowania']]))
    const inline = (out[0] as Extract<BlockNode, { kind: 'paragraph' }>).inline

    assert.deepStrictEqual(inline[1], { kind: 'taskMention', taskId: '869a', name: 'Poprawki filtrowania' })
  })

  it('zadanie SPOZA portalu zostaje bez nazwy', () => {
    const out = applyTaskMentions(blocks, new Map([['869a', 'Poprawki filtrowania']]))
    const inline = (out[0] as Extract<BlockNode, { kind: 'paragraph' }>).inline

    assert.deepStrictEqual(inline[3], { kind: 'taskMention', taskId: '869obcy' })
  })

  it('nazwa nie wycieka, gdy mapa mowi ze zadania nie ma w zakresie', () => {
    const out = applyTaskMentions(blocks, new Map([['869obcy', null]]))
    const inline = (out[0] as Extract<BlockNode, { kind: 'paragraph' }>).inline

    assert.deepStrictEqual(inline[3], { kind: 'taskMention', taskId: '869obcy' })
  })

  it('podmienia takze w punktach listy i w tabeli', () => {
    const out = applyTaskMentions(
      [
        { kind: 'bullets', items: [[{ kind: 'taskMention', taskId: '869a' }]] },
        { kind: 'table', rows: [[[{ kind: 'taskMention', taskId: '869a' }]]] },
      ],
      new Map([['869a', 'Nazwa']])
    )

    const bullets = out[0] as Extract<BlockNode, { kind: 'bullets' }>
    const table = out[1] as Extract<BlockNode, { kind: 'table' }>
    assert.deepStrictEqual(bullets.items[0][0], { kind: 'taskMention', taskId: '869a', name: 'Nazwa' })
    assert.deepStrictEqual(table.rows[0][0][0], { kind: 'taskMention', taskId: '869a', name: 'Nazwa' })
  })

  it('nie rusza blokow bez wzmianek', () => {
    const wejscie: BlockNode[] = [{ kind: 'code', language: 'css', lines: ['a{}'] }]

    assert.deepStrictEqual(applyTaskMentions(wejscie, new Map()), wejscie)
  })
})

describe('resolveTaskMentions', () => {
  it('nazwe z indeksu bierze bez pytania ClickUpa', async () => {
    let liveCalls = 0
    const out = await resolveTaskMentions(['869a'], {
      indexed: async () => new Map([['869a', 'Z indeksu']]),
      live: async () => {
        liveCalls++
        return { name: 'Z ClickUpa' }
      },
    })

    assert.deepStrictEqual([...out], [['869a', 'Z indeksu']])
    assert.strictEqual(liveCalls, 0, 'indeks wystarczyl, nie wolno pytac ClickUpa')
  })

  it('zadanie jeszcze nieindeksowane sprawdza na zywo', async () => {
    const out = await resolveTaskMentions(['869nowe'], {
      indexed: async () => new Map(),
      live: async id => (id === '869nowe' ? { name: 'Swieze zadanie' } : null),
    })

    assert.deepStrictEqual([...out], [['869nowe', 'Swieze zadanie']])
  })

  it('zadanie poza zakresem portalu wraca jako null, nie jako nazwa', async () => {
    const out = await resolveTaskMentions(['869obcy'], {
      indexed: async () => new Map(),
      live: async () => null,
    })

    assert.deepStrictEqual([...out], [['869obcy', null]])
  })

  it('awaria ClickUpa nie wywala komentarza, wzmianka zostaje bez nazwy', async () => {
    const out = await resolveTaskMentions(['869a'], {
      indexed: async () => new Map(),
      live: async () => {
        throw new Error('ClickUp 500')
      },
    })

    assert.deepStrictEqual([...out], [['869a', null]])
  })

  it('awaria indeksu nie blokuje sprawdzenia na zywo', async () => {
    const out = await resolveTaskMentions(['869a'], {
      indexed: async () => {
        throw new Error('baza padla')
      },
      live: async () => ({ name: 'Z ClickUpa' }),
    })

    assert.deepStrictEqual([...out], [['869a', 'Z ClickUpa']])
  })

  it('pusta lista wzmianek nie pyta ani indeksu, ani ClickUpa', async () => {
    let touched = 0
    const out = await resolveTaskMentions([], {
      indexed: async () => {
        touched++
        return new Map()
      },
      live: async () => {
        touched++
        return null
      },
    })

    assert.strictEqual(out.size, 0)
    assert.strictEqual(touched, 0)
  })
})
