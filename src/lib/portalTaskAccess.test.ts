/**
 * Widoczność POJEDYNCZEGO zadania z dociąganiem przodków. To jest brama tras
 * szczegółów, komentarzy, załączników i obserwatorów: klient znający
 * identyfikator ukrytego zadania nie może przez nią przejść.
 */
import { describe, it } from 'vitest'
import assert from 'node:assert'
import { taskVisibleWithAncestors } from '@/lib/portalTaskAccess'
import type { ClickUpTask } from '@/lib/types'

type Node = Pick<ClickUpTask, 'tags' | 'parent'>
const node = (parent: string | null, tags: string[] = []): Node => ({
  parent,
  tags: tags.map(name => ({ name })),
})

function fetcher(tree: Record<string, Node>) {
  const calls: string[] = []
  const fetchTask = async (id: string) => {
    calls.push(id)
    const n = tree[id]
    if (!n) throw new Error(`404 ${id}`)
    return n
  }
  return { fetchTask, calls }
}

describe('taskVisibleWithAncestors', () => {
  it('flaga wyłączona: przepuszcza bez żadnego wywołania ClickUpa', async () => {
    const { fetchTask, calls } = fetcher({})
    assert.equal(await taskVisibleWithAncestors(node('p'), false, fetchTask), true)
    assert.deepEqual(calls, [])
  })

  it('własny tag: przepuszcza bez pobierania rodzica', async () => {
    const { fetchTask, calls } = fetcher({})
    assert.equal(await taskVisibleWithAncestors(node('p', ['portal']), true, fetchTask), true)
    assert.deepEqual(calls, [])
  })

  it('zadanie główne bez tagu: odmowa', async () => {
    const { fetchTask } = fetcher({})
    assert.equal(await taskVisibleWithAncestors(node(null, ['wycena']), true, fetchTask), false)
  })

  it('podzadanie dziedziczy po dziadku i przestaje pytać, gdy znajdzie tag', async () => {
    const { fetchTask, calls } = fetcher({
      rodzic: node('dziadek'),
      dziadek: node('pradziadek', ['portal']),
      pradziadek: node(null),
    })
    assert.equal(await taskVisibleWithAncestors(node('rodzic'), true, fetchTask), true)
    assert.deepEqual(calls, ['rodzic', 'dziadek'])
  })

  it('żaden przodek bez tagu: odmowa', async () => {
    const { fetchTask } = fetcher({ rodzic: node('dziadek'), dziadek: node(null) })
    assert.equal(await taskVisibleWithAncestors(node('rodzic'), true, fetchTask), false)
  })

  it('błąd pobrania rodzica kończy się ODMOWĄ, nie przepuszczeniem', async () => {
    const { fetchTask } = fetcher({})
    assert.equal(await taskVisibleWithAncestors(node('nieosiagalny'), true, fetchTask), false)
  })

  it('pętla w danych nie zawiesza', async () => {
    const { fetchTask } = fetcher({ a: node('b'), b: node('a') })
    assert.equal(await taskVisibleWithAncestors(node('a'), true, fetchTask), false)
  })
})
