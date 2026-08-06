import { describe, it, beforeEach, vi } from 'vitest'
import assert from 'node:assert'

/**
 * Jednostkowe testy mapowania i logiki taskIndex.ts.
 *
 * Zapytania SQL (queryHistory, getHistoryFacets, getRecentlyClosed, IS_ROOT_TASK)
 * sa juz pokryte integracyjnie w tests/integration/history.test.ts na prawdziwym
 * Postgresie i CELOWO nie sa tu dublowane.
 *
 * Ten plik skupia sie na tym, czego integracja NIE lapie: mapowaniu zadania
 * ClickUpa na wiersz indeksu (pola opcjonalne, daty jako stringi w milisekundach),
 * liczeniu podzadan, granicy zakresu portalu i na udokumentowanym w komentarzach
 * niezmienniku "upsert podstawowy NIE nadpisuje kolumn tresci".
 *
 * `db`, ClickUp i portalScopeStore sa podstawione (`vi.mock`) — to granice
 * wychodzace. `portalScope`, `publicComments`, `textSearch` chodza prawdziwe,
 * bo sa czyste i maja juz wlasne testy; tutaj sprawdzamy ich ZLOZENIE z
 * taskIndex, nie reimplementujemy ich testow.
 */

const { db, clickup, portalScopeStore } = vi.hoisted(() => {
  // Musi byc ustawione PRZED zaimportowaniem taskIndex.ts, bo modul czyta
  // env raz, przy imporcie, do stalej modulowej SYNC_DELAY_MS. Bez tego
  // kazdy test przebiegu tresci czekalby 800ms na zadanie.
  process.env.CLICKUP_SYNC_DELAY_MS = '0'
  return {
    db: {
      insert: vi.fn(),
      select: vi.fn(),
      delete: vi.fn(),
      update: vi.fn(),
    },
    clickup: {
      getFolderTaskHistory: vi.fn(),
      getTask: vi.fn(),
      getTaskComments: vi.fn(),
    },
    portalScopeStore: {
      getPortalScope: vi.fn(),
    },
  }
})

vi.mock('@/lib/db', () => ({ db }))
vi.mock('@/lib/clickup', () => clickup)
vi.mock('@/lib/portalScopeStore', () => portalScopeStore)

import { syncPortalIndex, indexSingleTask } from '@/lib/taskIndex'
import type { ClickUpTask, ClickUpComment } from '@/lib/types'

// ---------------------------------------------------------------------------
// Fixtures
// ---------------------------------------------------------------------------

function clickUpTask(overrides: Partial<ClickUpTask> = {}): ClickUpTask {
  return {
    id: 't-1',
    name: 'Zadanie testowe',
    description: null,
    status: { status: 'do zrobienia', color: '#000', type: 'open', orderindex: 1 },
    priority: null,
    assignees: [],
    date_created: '1700000000000',
    date_updated: '1700000001000',
    date_due: null,
    date_start: null,
    list: { id: 'list-1', name: 'Lista' },
    folder: { id: 'folder-1', name: 'Folder' },
    parent: null,
    time_estimate: null,
    time_spent: null,
    url: 'https://app.clickup.com/t/t-1',
    ...overrides,
  }
}

function comment(text: string): ClickUpComment {
  return { id: 'c', comment: [{ text }], comment_text: text, user: null, resolved: false, date: '0' }
}

/** Zapytanie drizzle udajace zarowno thenable, jak i lancuch .from/.where/.orderBy. */
function chain(result: unknown) {
  const obj: Record<string, unknown> = {}
  obj.from = () => obj
  obj.where = () => obj
  obj.orderBy = () => obj
  obj.then = (resolve: (v: unknown) => unknown, reject: (e: unknown) => unknown) =>
    Promise.resolve(result).then(resolve, reject)
  return obj
}

let insertCalls: unknown[][]
let onConflictCalls: Record<string, unknown>[]
let updateCalls: Record<string, unknown>[]
let deleteCalls: unknown[]

/** Podklada db.select() z kolejnymi wynikami, w kolejnosci wywolan w kodzie. */
function queueSelects(...results: unknown[][]) {
  const fn = vi.fn()
  for (const r of results) fn.mockReturnValueOnce(chain(r))
  db.select = fn
}

beforeEach(() => {
  vi.clearAllMocks()
  portalScopeStore.getPortalScope.mockResolvedValue([])

  insertCalls = []
  onConflictCalls = []
  updateCalls = []
  deleteCalls = []

  db.insert = vi.fn(() => ({
    values: (rows: unknown) => {
      insertCalls.push(Array.isArray(rows) ? rows : [rows])
      return {
        onConflictDoUpdate: (opts: Record<string, unknown>) => {
          onConflictCalls.push(opts.set as Record<string, unknown>)
          return Promise.resolve()
        },
      }
    },
  }))

  db.update = vi.fn(() => ({
    set: (patch: Record<string, unknown>) => {
      updateCalls.push(patch)
      return { where: () => Promise.resolve() }
    },
  }))

  db.delete = vi.fn(() => ({
    where: (cond: unknown) => {
      deleteCalls.push(cond)
      return Promise.resolve()
    },
  }))

  // Domyslnie pusty przebieg tresci, zeby testy nieskupione na tym watku nie
  // musialy go osobno konfigurowac.
  queueSelects([], [])
})

const PORTAL = { id: 'portal-1', clickupFolderId: 'folder-1' }

// ---------------------------------------------------------------------------
// indexSingleTask — sciezka webhooka, pojedyncze zadanie
// ---------------------------------------------------------------------------

describe('indexSingleTask — mapowanie pol', () => {
  it('mapuje pelne zadanie: daty ze stringow ms, opis z text_content', async () => {
    clickup.getTask.mockResolvedValue(
      clickUpTask({
        text_content: 'Opis bez markdown',
        date_created: '1700000000000',
        date_updated: '1700000005000',
        date_closed: '1700000009000',
        priority: { id: 'p1', priority: 'high', color: '#f00', orderindex: '1' },
        list: { id: 'list-9', name: 'Bugi' },
        parent: 'parent-1',
        attachments: [{ id: 'a1', url: 'u', title: 'zrzut.png', date: '0', type: 1, source: 1, user_id: 'u1' }],
      })
    )
    clickup.getTaskComments.mockResolvedValue([comment('[P] odpowiedz publiczna')])

    const ok = await indexSingleTask('portal-1', 't-1')

    assert.strictEqual(ok, true)
    const row = insertCalls[0][0] as Record<string, unknown>
    assert.strictEqual(row.description, 'Opis bez markdown')
    assert.strictEqual(row.dateCreated, 1700000000000)
    assert.strictEqual(row.dateUpdated, 1700000005000)
    assert.strictEqual(row.dateClosed, 1700000009000)
    assert.strictEqual(row.priority, 'high')
    assert.strictEqual(row.listName, 'Bugi')
    assert.strictEqual(row.parentId, 'parent-1')
    assert.strictEqual(row.attachmentCount, 1)
    assert.strictEqual(row.publicCommentCount, 1)
  })

  it('brakujace pola opcjonalne dostaja bezpieczne domyslne, nie undefined/wyjatek', async () => {
    clickup.getTask.mockResolvedValue(
      clickUpTask({
        status: { status: 'nieznany', color: '#000', type: 'open', orderindex: 0 },
        priority: null,
        parent: null,
        date_closed: null,
      })
    )
    clickup.getTaskComments.mockResolvedValue([])

    const ok = await indexSingleTask('portal-1', 't-1')

    assert.strictEqual(ok, true)
    const row = insertCalls[0][0] as Record<string, unknown>
    assert.strictEqual(row.priority, null)
    assert.strictEqual(row.listName, 'Lista')
    assert.strictEqual(row.parentId, null)
    assert.strictEqual(row.dateClosed, null)
    assert.strictEqual(row.attachmentCount, 0)
    assert.strictEqual(row.publicCommentCount, 0)
  })

  it('data jako pusty string albo smieciowy tekst staje sie null, nie NaN', async () => {
    clickup.getTask.mockResolvedValue(
      clickUpTask({ date_closed: '', date_updated: 'nie-liczba' as unknown as string })
    )
    clickup.getTaskComments.mockResolvedValue([])

    await indexSingleTask('portal-1', 't-1')

    const row = insertCalls[0][0] as Record<string, unknown>
    // dateClosed NIE ma fallbacku — zostaje null (zadanie moze byc otwarte).
    assert.strictEqual(row.dateClosed, null)
    // dateCreated i dateUpdated MAJA fallback na 0 (kolumny NOT NULL bez
    // defaultu w bazie), wiec smieciowa wartosc nie trafia jako null/NaN.
    assert.strictEqual(row.dateUpdated, 0)
  })

  it('filtruje zalaczniki bez tytulu, komentarze wewnetrzne nie licza sie do publicCommentCount', async () => {
    clickup.getTask.mockResolvedValue(
      clickUpTask({
        attachments: [
          { id: 'a1', url: 'u', title: '', date: '0', type: 1, source: 1, user_id: 'u1' },
          { id: 'a2', url: 'u', title: 'plik.pdf', date: '0', type: 1, source: 1, user_id: 'u1' },
        ],
      })
    )
    clickup.getTaskComments.mockResolvedValue([
      comment('UWAGA WEWNETRZNA, nie dla klienta'),
      comment('[PUBLIC] tresc dla klienta'),
    ])

    await indexSingleTask('portal-1', 't-1')

    const row = insertCalls[0][0] as Record<string, unknown>
    assert.strictEqual(row.attachmentCount, 1)
    assert.strictEqual(row.publicCommentCount, 1)
    assert.match(row.searchText as string, /plik\.pdf/)
    assert.doesNotMatch(row.searchText as string, /wewnetrzna/)
  })

  it('przy konflikcie NADPISUJE tez searchText i contentSyncedAt (w odroznieniu od bulk-syncu)', async () => {
    clickup.getTask.mockResolvedValue(clickUpTask())
    clickup.getTaskComments.mockResolvedValue([])

    await indexSingleTask('portal-1', 't-1')

    const setKeys = Object.keys(onConflictCalls[0])
    assert.ok(setKeys.includes('searchText'), 'indexSingleTask musi odswiezac searchText na konflikcie')
    assert.ok(setKeys.includes('contentSyncedAt'))
    assert.ok(setKeys.includes('attachmentCount'))
    assert.ok(!setKeys.includes('dateCreated'), 'dateCreated nie powinno byc nadpisywane przy update')
  })

  it('zwraca false i NIE zapisuje niczego, gdy ClickUp padnie', async () => {
    clickup.getTask.mockRejectedValue(new Error('ClickUp 500'))
    clickup.getTaskComments.mockResolvedValue([])
    const errSpy = vi.spyOn(console, 'error').mockImplementation(() => {})

    const ok = await indexSingleTask('portal-1', 't-1')

    assert.strictEqual(ok, false)
    assert.strictEqual(insertCalls.length, 0)
    errSpy.mockRestore()
  })
})

// ---------------------------------------------------------------------------
// syncPortalIndex — mapowanie wierszy podstawowych
// ---------------------------------------------------------------------------

describe('syncPortalIndex — mapowanie wierszy podstawowych', () => {
  it('mapuje pola i domyka brakujace na bezpieczne wartosci domyslne', async () => {
    clickup.getFolderTaskHistory.mockResolvedValue({
      tasks: [
        clickUpTask({
          id: 'a',
          status: undefined as unknown as ClickUpTask['status'],
          priority: null,
          date_created: '',
          date_updated: 'zle-dane' as unknown as string,
        }),
      ],
      truncated: false,
    })
    queueSelects([], [])

    const result = await syncPortalIndex(PORTAL)

    assert.strictEqual(result.upserted, 1)
    const row = insertCalls[0][0] as Record<string, unknown>
    assert.strictEqual(row.status, 'nieznany')
    assert.strictEqual(row.statusType, 'open')
    assert.strictEqual(row.priority, null)
    // W syncPortalIndex, w odroznieniu od indexSingleTask, dateCreated i
    // dateUpdated MAJA fallback na 0 (kolumny sa NOT NULL bez defaultu w bazie).
    assert.strictEqual(row.dateCreated, 0)
    assert.strictEqual(row.dateUpdated, 0)
  })

  it('dateClosed zostaje null, gdy zadanie jest otwarte (bez fallbacku na 0)', async () => {
    clickup.getFolderTaskHistory.mockResolvedValue({
      tasks: [clickUpTask({ id: 'a', date_closed: null })],
      truncated: false,
    })
    queueSelects([], [])

    await syncPortalIndex(PORTAL)

    const row = insertCalls[0][0] as Record<string, unknown>
    assert.strictEqual(row.dateClosed, null)
  })

  it('liczy subtaskCount po rodzicu, zadania bez dzieci maja 0', async () => {
    clickup.getFolderTaskHistory.mockResolvedValue({
      tasks: [
        clickUpTask({ id: 'rodzic', parent: null }),
        clickUpTask({ id: 'dziecko-1', parent: 'rodzic' }),
        clickUpTask({ id: 'dziecko-2', parent: 'rodzic' }),
        clickUpTask({ id: 'samotne', parent: null }),
      ],
      truncated: false,
    })
    queueSelects([], [])

    await syncPortalIndex(PORTAL)

    const rows = insertCalls[0] as Record<string, unknown>[]
    const byId = new Map(rows.map(r => [r.clickupTaskId, r]))
    assert.strictEqual(byId.get('rodzic')?.subtaskCount, 2)
    assert.strictEqual(byId.get('dziecko-1')?.subtaskCount, 0)
    assert.strictEqual(byId.get('samotne')?.subtaskCount, 0)
  })

  it('zawezenie do zakresu portalu odsiewa zadania spoza wybranych list PRZED zapisem', async () => {
    portalScopeStore.getPortalScope.mockResolvedValue(['list-in'])
    clickup.getFolderTaskHistory.mockResolvedValue({
      tasks: [
        clickUpTask({ id: 'w-zakresie', list: { id: 'list-in', name: 'W zakresie' } }),
        clickUpTask({ id: 'poza-zakresem', list: { id: 'list-out', name: 'Poza' } }),
      ],
      truncated: false,
    })
    queueSelects([], [])

    const result = await syncPortalIndex(PORTAL)

    assert.strictEqual(result.fetched, 1, 'fetched liczy PO filtrowaniu do zakresu')
    const ids = (insertCalls[0] as Record<string, unknown>[]).map(r => r.clickupTaskId)
    assert.deepStrictEqual(ids, ['w-zakresie'])
  })

  it('upsert podstawowy NIE nadpisuje kolumn tresci przy konflikcie (regresja)', async () => {
    clickup.getFolderTaskHistory.mockResolvedValue({ tasks: [clickUpTask()], truncated: false })
    queueSelects([], [])

    await syncPortalIndex(PORTAL)

    const setKeys = Object.keys(onConflictCalls[0])
    for (const zakazane of ['searchText', 'contentSyncedAt', 'attachmentCount', 'publicCommentCount']) {
      assert.ok(
        !setKeys.includes(zakazane),
        `bulk upsert nie powinien nadpisywac "${zakazane}" — wymazaloby to zindeksowana tresc`
      )
    }
    assert.ok(setKeys.includes('name'))
    assert.ok(setKeys.includes('status'))
  })
})

describe('syncPortalIndex — rekoncyliacja i truncated', () => {
  it('gdy pobor jest UCIETY, nic nie kasuje, choc lokalne wiersze wygladaja na osierocone', async () => {
    clickup.getFolderTaskHistory.mockResolvedValue({
      tasks: [clickUpTask({ id: 'zywe' })],
      truncated: true,
    })
    // Gdyby rekoncyliacja sie odpalila, ten select zwrocilby "martwe" wiersze.
    queueSelects([])

    const result = await syncPortalIndex(PORTAL)

    assert.strictEqual(result.truncated, true)
    assert.strictEqual(result.deleted, 0)
    assert.strictEqual(deleteCalls.length, 0)
  })

  it('gdy pobor jest KOMPLETNY, kasuje wiersze nieobecne juz w folderze', async () => {
    clickup.getFolderTaskHistory.mockResolvedValue({
      tasks: [clickUpTask({ id: 'zywe' })],
      truncated: false,
    })
    queueSelects(
      [
        { id: 'row-uuid-1', clickupTaskId: 'zywe' },
        { id: 'row-uuid-2', clickupTaskId: 'martwe' },
      ],
      []
    )

    const result = await syncPortalIndex(PORTAL)

    assert.strictEqual(result.deleted, 1)
    assert.strictEqual(deleteCalls.length, 1)
  })
})

describe('syncPortalIndex — przebieg tresci (komentarze i zalaczniki)', () => {
  it('budzet ogranicza liczbe doczytanych zadan, reszta wraca jako contentPending', async () => {
    clickup.getFolderTaskHistory.mockResolvedValue({ tasks: [], truncated: false })
    queueSelects(
      [],
      [
        { clickupTaskId: 'x1', name: 'X1', description: null },
        { clickupTaskId: 'x2', name: 'X2', description: null },
      ]
    )
    clickup.getTask.mockResolvedValue(clickUpTask({ id: 'x1' }))
    clickup.getTaskComments.mockResolvedValue([])

    const result = await syncPortalIndex(PORTAL, { budget: 1 })

    assert.strictEqual(result.contentSynced, 1)
    assert.strictEqual(result.contentPending, 1)
    assert.strictEqual(clickup.getTask.mock.calls.length, 1)
  })

  it('gdy doczytanie jednego zadania padnie, reszta przebiegu nie jest przerywana', async () => {
    clickup.getFolderTaskHistory.mockResolvedValue({ tasks: [], truncated: false })
    queueSelects(
      [],
      [
        { clickupTaskId: 'x1', name: 'X1', description: null },
        { clickupTaskId: 'x2', name: 'X2', description: null },
      ]
    )
    clickup.getTask
      .mockRejectedValueOnce(new Error('timeout'))
      .mockResolvedValueOnce(clickUpTask({ id: 'x2' }))
    clickup.getTaskComments.mockResolvedValue([])
    const errSpy = vi.spyOn(console, 'error').mockImplementation(() => {})

    const result = await syncPortalIndex(PORTAL, { budget: 10 })

    assert.strictEqual(result.contentSynced, 1)
    assert.strictEqual(updateCalls.length, 1)
    errSpy.mockRestore()
  })

  it('gdy GET /task nie zwroci text_content, zachowuje OPIS juz zaindeksowany, nie kasuje go', async () => {
    clickup.getFolderTaskHistory.mockResolvedValue({ tasks: [], truncated: false })
    queueSelects(
      [],
      [{ clickupTaskId: 'x1', name: 'Stara nazwa', description: 'Stary opis z pierwszego przebiegu' }]
    )
    // GET /task/{id} realnie nie zwraca text_content — pole zostaje undefined.
    clickup.getTask.mockResolvedValue(clickUpTask({ id: 'x1', text_content: undefined }))
    clickup.getTaskComments.mockResolvedValue([])

    await syncPortalIndex(PORTAL, { budget: 10 })

    assert.match(updateCalls[0].searchText as string, /stary opis z pierwszego przebiegu/)
  })
})
