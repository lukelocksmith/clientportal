/**
 * clickupCache: cache zadan folderu ClickU (`unstable_cache` z Next) i jego
 * uniewaznianie po zmianie.
 *
 * `next/cache` i `./clickup` sa podstawione. Prawdziwy `unstable_cache` wymaga
 * kontekstu serwera Next (async storage), ktorego tu nie ma — dlatego mock
 * zwraca PRZEKAZANA fabryke BEZ ZMIAN, zamiast probowac symulowac cache.
 * To ogranicza test do tego, co da sie sensownie sprawdzic bez srodowiska
 * Next, ale to akurat NAJWAZNIEJSZA czesc modulu: czy identyfikator folderu
 * i zakres NAPRAWDE wchodza do klucza cache'u. Bez tego pierwszy klient, ktory
 * wejdzie na tablice, obsadzilby cache dla wszystkich pozostalych — patrz
 * komentarz w zrodle. Druga czesc to `invalidateFolderTasks`, ktora nie ma
 * prawa rzucic wyjatkiem, bo uniewaznienie jest wtorne wobec operacji, ktora
 * juz sie udala.
 *
 *   npx vitest run src/lib/clickupCache.test.ts
 */
import { describe, it, beforeEach, vi } from 'vitest'
import assert from 'node:assert'

// `vi.hoisted`, bo `vi.mock` jest wynoszony na sam poczatek pliku.
// Fabryki bez wbudowanej implementacji (samo `vi.fn()`), zeby TS nie zawezal
// typu wywolan do sygnatury o jednym argumencie — inaczej `mock.calls[i]`
// staje sie 1-elementowa krotka i destrukturyzacja `[, keyA]` nie kompiluje sie.
const { nextCache, clickup } = vi.hoisted(() => ({
  nextCache: { unstable_cache: vi.fn(), revalidateTag: vi.fn() },
  clickup: { getAllTasksForFolder: vi.fn(), getAllTasksForLists: vi.fn() },
}))

vi.mock('next/cache', () => nextCache)
vi.mock('./clickup', () => clickup)

import {
  getCachedTasksForScope,
  invalidateFolderTasks,
  folderTasksTag,
  FOLDER_TASKS_TTL_SECONDS,
} from './clickupCache'

beforeEach(() => {
  vi.clearAllMocks()
  // Mock zwraca PRZEKAZANA fabryke bez zmian — patrz komentarz na gorze pliku.
  nextCache.unstable_cache.mockImplementation((fn: (...args: unknown[]) => unknown) => fn)
  nextCache.revalidateTag.mockImplementation(() => undefined)
  clickup.getAllTasksForFolder.mockResolvedValue([])
  clickup.getAllTasksForLists.mockResolvedValue([])
})

describe('getCachedTasksForScope — budowa klucza cache (izolacja miedzy klientami)', () => {
  it('klucz zawiera identyfikator folderu — bez tego klient A zobaczylby dane klienta B', async () => {
    await getCachedTasksForScope('folder-A', [])
    await getCachedTasksForScope('folder-B', [])

    const [, keyA] = nextCache.unstable_cache.mock.calls[0]
    const [, keyB] = nextCache.unstable_cache.mock.calls[1]
    assert.ok((keyA as string[]).includes('folder-A'))
    assert.ok((keyB as string[]).includes('folder-B'))
    assert.notDeepStrictEqual(keyA, keyB)
  })

  it('klucz zawiera zakres — zmiana list wybranych w panelu zmienia klucz, nie tylko dane', async () => {
    await getCachedTasksForScope('folder-1', [])
    await getCachedTasksForScope('folder-1', ['lista-a'])

    const [, keyCalyFolder] = nextCache.unstable_cache.mock.calls[0]
    const [, keyZawezony] = nextCache.unstable_cache.mock.calls[1]
    assert.notDeepStrictEqual(keyCalyFolder, keyZawezony)
  })

  it('kolejnosc list w zakresie NIE zmienia klucza — ten sam zestaw to ten sam wpis cache', async () => {
    await getCachedTasksForScope('folder-1', ['a', 'b'])
    await getCachedTasksForScope('folder-1', ['b', 'a'])

    const [, key1] = nextCache.unstable_cache.mock.calls[0]
    const [, key2] = nextCache.unstable_cache.mock.calls[1]
    assert.deepStrictEqual(key1, key2)
  })

  it('rozne foldery z tym samym (pustym) zakresem NIE dziela klucza', async () => {
    await getCachedTasksForScope('folder-X', [])
    await getCachedTasksForScope('folder-Y', [])

    const [, keyX] = nextCache.unstable_cache.mock.calls[0]
    const [, keyY] = nextCache.unstable_cache.mock.calls[1]
    assert.notDeepStrictEqual(keyX, keyY)
  })

  it('tag i TTL trafiaja do opcji unstable_cache', async () => {
    await getCachedTasksForScope('folder-9', [])

    const [, , opts] = nextCache.unstable_cache.mock.calls[0]
    assert.deepStrictEqual(opts, {
      revalidate: FOLDER_TASKS_TTL_SECONDS,
      tags: [folderTasksTag('folder-9')],
    })
  })
})

describe('getCachedTasksForScope — wybor zrodla danych', () => {
  it('przy pustym zakresie pobiera CALY folder, nie pojedyncze listy', async () => {
    await getCachedTasksForScope('folder-1', [])

    assert.strictEqual(clickup.getAllTasksForFolder.mock.calls.length, 1)
    assert.strictEqual(clickup.getAllTasksForFolder.mock.calls[0][0], 'folder-1')
    assert.strictEqual(clickup.getAllTasksForLists.mock.calls.length, 0)
  })

  it('przy zawezonym zakresie pobiera TYLKO wybrane listy, nie caly folder', async () => {
    await getCachedTasksForScope('folder-1', ['lista-a', 'lista-b'])

    assert.strictEqual(clickup.getAllTasksForLists.mock.calls.length, 1)
    assert.deepStrictEqual(clickup.getAllTasksForLists.mock.calls[0][0], ['lista-a', 'lista-b'])
    assert.strictEqual(clickup.getAllTasksForFolder.mock.calls.length, 0)
  })

  it('zwraca dokladnie to, co odda ClickUp', async () => {
    const zadania = [{ id: 't1' }]
    clickup.getAllTasksForFolder.mockResolvedValue(zadania)

    const wynik = await getCachedTasksForScope('folder-1', [])

    assert.deepStrictEqual(wynik, zadania)
  })
})

describe('invalidateFolderTasks', () => {
  it('uniewaznia znacznik WLASCIWEGO folderu, z natychmiastowym wygasnieciem (nie stale-while-revalidate)', async () => {
    await invalidateFolderTasks('folder-1')

    assert.deepStrictEqual(nextCache.revalidateTag.mock.calls[0], [
      folderTasksTag('folder-1'),
      { expire: 0 },
    ])
  })

  it('foldery roznych klientow dostaja rozne znaczniki', async () => {
    await invalidateFolderTasks('folder-A')
    await invalidateFolderTasks('folder-B')

    assert.notStrictEqual(nextCache.revalidateTag.mock.calls[0][0], nextCache.revalidateTag.mock.calls[1][0])
  })

  it('NIE rzuca wyjatkiem, gdy revalidateTag padnie — uniewaznienie jest wtorne wobec operacji, ktora juz sie udala', async () => {
    nextCache.revalidateTag.mockImplementation(() => {
      throw new Error('cache padl')
    })

    await assert.doesNotReject(() => invalidateFolderTasks('folder-1'))
  })

  it('loguje blad, gdy revalidateTag padnie, zeby awaria nie byla cicha', async () => {
    nextCache.revalidateTag.mockImplementation(() => {
      throw new Error('cache padl')
    })
    const errorSpy = vi.spyOn(console, 'error').mockImplementation(() => {})

    await invalidateFolderTasks('folder-1')

    assert.strictEqual(errorSpy.mock.calls.length, 1)
    errorSpy.mockRestore()
  })
})
