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
    const now = Date.now()
    odpowiedzListy([
      zadanie({ id: '1', status: { status: 'w trakcie', type: 'custom', color: '', orderindex: 0 }, date_closed: String(now) }),
      zadanie({
        id: '2',
        status: { status: 'zamknięte', type: 'closed', color: '', orderindex: 6 },
        date_closed: String(now),
      }),
    ])

    const wynik = await getRecentlyClosedTasksForLists(['lista-1'])

    assert.deepStrictEqual(wynik.map(t => t.id), ['2'])
  })

  it('sortuje po dacie zamkniecia (najnowsze pierwsze) i przycina do limitu', async () => {
    const now = Date.now()
    odpowiedzListy([
      zadanie({ id: 'a', status: { status: 'zamknięte', type: 'closed', color: '', orderindex: 6 }, date_closed: String(now - 300_000) }),
      zadanie({ id: 'b', status: { status: 'zamknięte', type: 'closed', color: '', orderindex: 6 }, date_closed: String(now) }),
      zadanie({ id: 'c', status: { status: 'zamknięte', type: 'closed', color: '', orderindex: 6 }, date_closed: String(now - 100_000) }),
    ])

    const wynik = await getRecentlyClosedTasksForLists(['lista-1'], { limit: 2 })

    assert.deepStrictEqual(wynik.map(t => t.id), ['b', 'c'])
  })

  it('brak date_closed -> uzywa date_updated jako przyblizenia', async () => {
    const now = Date.now()
    const oneDayAgo = now - 24 * 60 * 60 * 1000

    odpowiedzListy([
      zadanie({
        id: 'stare',
        status: { status: 'zamknięte', type: 'closed', color: '', orderindex: 6 },
        date_closed: null,
        date_updated: String(oneDayAgo),
      }),
      zadanie({
        id: 'nowe',
        status: { status: 'zamknięte', type: 'closed', color: '', orderindex: 6 },
        date_closed: String(now),
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

  it('odsiej zamkniete spoza okna, mimo swiezego date_updated', async () => {
    const now = Date.now()
    const thirtyDaysAgo = now - 30 * 24 * 60 * 60 * 1000
    const sixtyDaysAgo = now - 60 * 24 * 60 * 60 * 1000

    odpowiedzListy([
      // Zamkniete dawno, ale zaktualizowane dzisiaj (np. komentarz)
      // — powinno byc odrzucone pomimo swiezego date_updated
      zadanie({
        id: 'stare-ale-zaktualizowane',
        status: { status: 'zamknięte', type: 'closed', color: '', orderindex: 6 },
        date_closed: String(sixtyDaysAgo),
        date_updated: String(now),
      }),
      // Zamkniete niedawno, zaktualizowane niedawno — powinno zostac
      zadanie({
        id: 'nowe',
        status: { status: 'zamknięte', type: 'closed', color: '', orderindex: 6 },
        date_closed: String(thirtyDaysAgo + 100_000),
        date_updated: String(now),
      }),
    ])

    const wynik = await getRecentlyClosedTasksForLists(['lista-1'])

    assert.deepStrictEqual(wynik.map(t => t.id), ['nowe'])
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
