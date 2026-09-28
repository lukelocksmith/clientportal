/**
 * Widoczność zadań po tagu `portal`.
 *
 * Test bezpieczeństwa, nie formatowania. Błąd w jedną stronę oznacza, że klient
 * czyta wewnętrzną notatkę (tak było z `869eprajy` u Onyxu), w drugą, że znika
 * mu z tablicy jego własne zgłoszenie.
 *
 *   npm test
 */
import { describe, it } from 'vitest'
import assert from 'node:assert'
import {
  PORTAL_VISIBILITY_TAG,
  hasPortalTag,
  withPortalTag,
  isTaskVisibleInPortal,
  computeVisibleIds,
  filterTaskTreeToPortal,
} from '@/lib/portalVisibility'
import { buildTaskTree } from '@/lib/clickup'
import type { ClickUpTask } from '@/lib/types'

const tag = (name: string) => ({ name })

function task(id: string, opts: { parent?: string | null; tags?: string[] } = {}): ClickUpTask {
  return {
    id,
    name: `Zadanie ${id}`,
    parent: opts.parent ?? null,
    tags: (opts.tags ?? []).map(tag),
  } as unknown as ClickUpTask
}

describe('hasPortalTag', () => {
  it('rozpoznaje tag bez względu na wielkość liter i spacje', () => {
    assert.equal(hasPortalTag({ tags: [tag('portal')] }), true)
    assert.equal(hasPortalTag({ tags: [tag(' Portal ')] }), true)
  })

  it('brak tagów, inne tagi albo brak pola = brak tagu', () => {
    assert.equal(hasPortalTag({ tags: [] }), false)
    assert.equal(hasPortalTag({ tags: [tag('portal-wewnetrzny'), tag('asana')] }), false)
    assert.equal(hasPortalTag({}), false)
    assert.equal(hasPortalTag(null), false)
    assert.equal(hasPortalTag({ tags: [{ name: null }] }), false)
  })
})

describe('withPortalTag', () => {
  it('dokłada tag portal raz, zachowując pozostałe i kolejność', () => {
    assert.deepEqual(withPortalTag(), [PORTAL_VISIBILITY_TAG])
    assert.deepEqual(withPortalTag(['awaria']), ['awaria', 'portal'])
    assert.deepEqual(withPortalTag(['portal', 'siteping']), ['portal', 'siteping'])
    assert.deepEqual(withPortalTag(['PORTAL']), ['PORTAL'])
  })

  it('nie modyfikuje tablicy wejściowej', () => {
    const input = ['siteping']
    withPortalTag(input)
    assert.deepEqual(input, ['siteping'])
  })
})

describe('isTaskVisibleInPortal', () => {
  it('przy wyłączonej fladze przepuszcza wszystko, jak przed zmianą', () => {
    assert.equal(isTaskVisibleInPortal({ tags: [] }, [], false), true)
  })

  it('przy włączonej: własny tag albo tag któregokolwiek przodka', () => {
    assert.equal(isTaskVisibleInPortal({ tags: [tag('portal')] }, [], true), true)
    assert.equal(isTaskVisibleInPortal({ tags: [] }, [{ tags: [] }, { tags: [tag('portal')] }], true), true)
    assert.equal(isTaskVisibleInPortal({ tags: [tag('asana')] }, [{ tags: [] }], true), false)
    assert.equal(isTaskVisibleInPortal({ tags: [] }, [], true), false)
  })
})

describe('computeVisibleIds', () => {
  it('podzadania dziedziczą po przodkach, także przez kilka poziomów', () => {
    const ids = computeVisibleIds([
      { id: 'root', parentId: null, hasTag: true },
      { id: 'sub', parentId: 'root', hasTag: false },
      { id: 'subsub', parentId: 'sub', hasTag: false },
      { id: 'internal', parentId: null, hasTag: false },
      { id: 'internal-sub', parentId: 'internal', hasTag: false },
      { id: 'tagged-under-internal', parentId: 'internal', hasTag: true },
    ])
    assert.deepEqual([...ids].sort(), ['root', 'sub', 'subsub', 'tagged-under-internal'])
  })

  it('przodek spoza zbioru jest nieznany, więc nie odsłania dziecka', () => {
    const ids = computeVisibleIds([{ id: 'orphan', parentId: 'nie-ma-go', hasTag: false }])
    assert.equal(ids.size, 0)
  })

  it('pętla w danych nie zawiesza i nie odsłania', () => {
    const ids = computeVisibleIds([
      { id: 'a', parentId: 'b', hasTag: false },
      { id: 'b', parentId: 'a', hasTag: false },
    ])
    assert.equal(ids.size, 0)
  })
})

describe('filterTaskTreeToPortal', () => {
  const flat = [
    task('onyx-zgloszenie', { tags: ['portal'] }),
    task('krok-1', { parent: 'onyx-zgloszenie' }),
    task('krok-1a', { parent: 'krok-1' }),
    // Odtworzenie przypadku 869eprajy: wewnętrzna notatka bez tagu.
    task('869eprajy', { tags: ['wycena'] }),
    task('notatka-sub', { parent: '869eprajy' }),
    task('pokazany-krok', { parent: '869eprajy', tags: ['portal'] }),
  ]

  it('przy wyłączonej fladze zwraca to samo drzewo, ta sama referencja', () => {
    const tree = buildTaskTree(flat)
    assert.strictEqual(filterTaskTreeToPortal(tree, false), tree)
  })

  it('ukrywa zadanie bez tagu razem z jego nieoznaczonymi podzadaniami', () => {
    const out = filterTaskTreeToPortal(buildTaskTree(flat), true)
    const all = JSON.stringify(out)
    assert.equal(all.includes('"869eprajy"'), false)
    assert.equal(all.includes('notatka-sub'), false)
  })

  it('widoczne zadanie zostaje z CAŁYM poddrzewem', () => {
    const out = filterTaskTreeToPortal(buildTaskTree(flat), true)
    const root = out.find(t => t.id === 'onyx-zgloszenie')!
    assert.ok(root)
    assert.deepEqual(root.children!.map(c => c.id), ['krok-1'])
    assert.deepEqual(root.children![0].children!.map(c => c.id), ['krok-1a'])
  })

  it('otagowane podzadanie ukrytego rodzica wychodzi na poziom główny BEZ wskaźnika na rodzica', () => {
    const out = filterTaskTreeToPortal(buildTaskTree(flat), true)
    const promoted = out.find(t => t.id === 'pokazany-krok')
    assert.ok(promoted)
    assert.equal(promoted!.parent, null)
    assert.deepEqual(out.map(t => t.id).sort(), ['onyx-zgloszenie', 'pokazany-krok'])
  })

  it('zadanie bez pola tags jest ukryte', () => {
    const bezTagow = { id: 'x', name: 'x', parent: null } as unknown as ClickUpTask
    assert.deepEqual(filterTaskTreeToPortal([bezTagow], true), [])
  })
})
