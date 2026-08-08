/**
 * `getRecentlyClosedTasksForLists`/`getRecentlyClosedTasksForFolder`: dodatkowy,
 * OGRANICZONY pobor zamknietych zadan pod podglad w kolumnie "zamkniete" na
 * kanbanie (patrz design 2026-08-08). Fetch jest podstawiony globalnie —
 * to sa jedyne dwie funkcje modulu, ktore ten plik sprawdza, reszta
 * `lib/clickup.ts` jest przechodzona przez testy tras (docs/testing.md).
 *
 *   npx vitest run src/lib/clickup.test.ts
 */
import { describe, it, beforeEach, vi } from 'vitest'
import assert from 'node:assert'
import type { ClickUpTask } from './types'

const fetchMock = vi.fn()

beforeEach(() => {
  vi.clearAllMocks()
  vi.stubGlobal('fetch', fetchMock)
})

import { getRecentlyClosedTasksForLists, getRecentlyClosedTasksForFolder } from './clickup'

function zadanie(nadpisz: Partial<ClickUpTask> & { id: string }): ClickUpTask {
  return {
    name: 'Zadanie',
    description: '',
    priority: null,
    tags: [],
    date_created: '1700000000000',
    date_updated: '1700000000000',
    ...nadpisz,
  } as unknown as ClickUpTask
}

function odpowiedzListy(tasks: ClickUpTask[]) {
  fetchMock.mockResolvedValue({ ok: true, json: async () => ({ tasks }) })
}

describe('getRecentlyClosedTasksForLists', () => {
  it('zapytanie niesie include_closed=true i date_updated_gt', async () => {
    odpowiedzListy([])
    await getRecentlyClosedTasksForLists(['lista-1'])

    const [adres] = fetchMock.mock.calls[0]
    assert.match(adres as string, /\/list\/lista-1\/task\?/)
    assert.match(adres as string, /include_closed=true/)
    assert.match(adres as string, /date_updated_gt=\d+/)
  })

  it('odsiewa zadania OTWARTE zwrocone w tym samym oknie', async () => {
    odpowiedzListy([
      zadanie({ id: '1', status: { status: 'w trakcie', type: 'custom', color: '', orderindex: 0 } }),
      zadanie({
        id: '2',
        status: { status: 'zamknięte', type: 'closed', color: '', orderindex: 6 },
        date_closed: '200',
      }),
    ])

    const wynik = await getRecentlyClosedTasksForLists(['lista-1'])

    assert.deepStrictEqual(wynik.map(t => t.id), ['2'])
  })

  it('sortuje po dacie zamkniecia (najnowsze pierwsze) i przycina do limitu', async () => {
    odpowiedzListy([
      zadanie({ id: 'a', status: { status: 'zamknięte', type: 'closed', color: '', orderindex: 6 }, date_closed: '100' }),
      zadanie({ id: 'b', status: { status: 'zamknięte', type: 'closed', color: '', orderindex: 6 }, date_closed: '300' }),
      zadanie({ id: 'c', status: { status: 'zamknięte', type: 'closed', color: '', orderindex: 6 }, date_closed: '200' }),
    ])

    const wynik = await getRecentlyClosedTasksForLists(['lista-1'], { limit: 2 })

    assert.deepStrictEqual(wynik.map(t => t.id), ['b', 'c'])
  })

  it('brak date_closed -> uzywa date_updated jako przyblizenia', async () => {
    odpowiedzListy([
      zadanie({
        id: 'stare',
        status: { status: 'zamknięte', type: 'closed', color: '', orderindex: 6 },
        date_closed: null,
        date_updated: '50',
      }),
      zadanie({
        id: 'nowe',
        status: { status: 'zamknięte', type: 'closed', color: '', orderindex: 6 },
        date_closed: '9999',
      }),
    ])

    const wynik = await getRecentlyClosedTasksForLists(['lista-1'])

    assert.deepStrictEqual(wynik.map(t => t.id), ['nowe', 'stare'])
  })

  it('woła jedna liste na kazde id, bez zapetlania stron', async () => {
    odpowiedzListy([])
    await getRecentlyClosedTasksForLists(['lista-1', 'lista-2'])

    assert.strictEqual(fetchMock.mock.calls.length, 2)
  })
})

describe('getRecentlyClosedTasksForFolder', () => {
  it('pobiera listy folderu, potem zamkniete z kazdej z nich', async () => {
    fetchMock.mockImplementation(async (url: string) => ({
      ok: true,
      json: async () =>
        url.includes('/folder/')
          ? { lists: [{ id: 'lista-a', name: 'A' }, { id: 'lista-b', name: 'B' }] }
          : { tasks: [] },
    }))

    await getRecentlyClosedTasksForFolder('folder-1')

    const adresy = fetchMock.mock.calls.map(c => c[0] as string)
    assert.ok(adresy.some(a => a.includes('/folder/folder-1/list')))
    assert.ok(adresy.some(a => a.includes('/list/lista-a/task')))
    assert.ok(adresy.some(a => a.includes('/list/lista-b/task')))
  })
})
