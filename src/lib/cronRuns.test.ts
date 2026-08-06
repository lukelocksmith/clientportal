/**
 * cronRuns: rejestr uruchomien zadan cyklicznych + alarm na Discordzie przy
 * porazce.
 *
 * `./db` i `drizzle-orm` (eq/and/desc) sa podstawione, zeby test nie wymagal
 * prawdziwego Postgresa i zeby dalo sie zobaczyc DOKLADNIE jakie warunki i
 * wartosci modul buduje, zamiast zgadywac po wewnetrznej strukturze obiektow
 * SQL drizzle. `fetch` jest podstawiony globalnie, bo to wyjscie do Discorda.
 *
 * PULAPKA: `DISCORD_WEBHOOK` jest stala modulu, czytana z `process.env` RAZ,
 * przy pierwszym imporcie. Testy, ktore musza porownac zachowanie "webhook
 * ustawiony" / "webhook brak", nie moga polegac na jednym statycznym imporcie
 * — uzywaja `freshCronRuns()`, ktora ustawia zmienna srodowiskowa, robi
 * `vi.resetModules()` i importuje modul od nowa. Podstawione moduly (`./db`,
 * `drizzle-orm`) zostaja te same (fabryki `vi.mock` zwracaja stale obiekty
 * z `vi.hoisted`), wiec szpiegi zbieraja wywolania niezaleznie od tego, ktora
 * "generacja" modulu je wywolala.
 *
 *   npx vitest run src/lib/cronRuns.test.ts
 */
import { describe, it, beforeEach, afterEach, vi } from 'vitest'
import assert from 'node:assert'

// `vi.hoisted`, bo `vi.mock` jest wynoszony na sam poczatek pliku — patrz
// wyjasnienie w store.test.ts, pierwszym pliku w repo z tym wzorcem.
// Fabryki bez wbudowanej implementacji (samo `vi.fn()`), zeby TS nie zawezal
// typu wywolan do sygnatury podanej inline — implementacje sa dowiazywane
// nizej, na zwyklych zmiennych, dzieki czemu `mock.calls[i][j]` zostaje `any`.
const { db, drizzleOrm } = vi.hoisted(() => ({
  db: { insert: vi.fn(), select: vi.fn() },
  drizzleOrm: { eq: vi.fn(), and: vi.fn(), desc: vi.fn() },
}))

vi.mock('./db', () => ({ db }))
vi.mock('drizzle-orm', () => drizzleOrm)

import { cronRuns } from './db/schema'
import { listCronRuns, getLastSuccessfulRun, CRON_JOB_LABELS } from './cronRuns'

// Lancuch zapytan drizzle: kazdy krok ignoruje argumenty i zwraca nastepny
// etap, az do `limitFn`, ktorego wynik faktycznie sterujemy w testach.
const insertValues = vi.fn(async (..._args: unknown[]) => undefined)
const limitFn = vi.fn(async (..._args: unknown[]) => [] as unknown[])
const orderByFn = vi.fn(() => ({ limit: limitFn }))
const whereFn = vi.fn(() => ({ orderBy: orderByFn }))
const fromFn = vi.fn(() => ({ where: whereFn }))
db.insert.mockImplementation(() => ({ values: insertValues }))
db.select.mockImplementation(() => ({ from: fromFn }))

drizzleOrm.eq.mockImplementation((col: unknown, val: unknown) => ({ op: 'eq', col, val }))
drizzleOrm.and.mockImplementation((...conds: unknown[]) => ({ op: 'and', conds }))
drizzleOrm.desc.mockImplementation((col: unknown) => ({ op: 'desc', col }))

const ORIGINAL_WEBHOOK = process.env.PANIC_DISCORD_WEBHOOK_URL

/**
 * Reimportuje `cronRuns.ts` od zera z zadana wartoscia zmiennej srodowiskowej,
 * zeby stala modulu `DISCORD_WEBHOOK` zlapala WLASNIE ta wartosc.
 */
async function freshCronRuns(webhookUrl?: string) {
  vi.resetModules()
  if (webhookUrl) process.env.PANIC_DISCORD_WEBHOOK_URL = webhookUrl
  else delete process.env.PANIC_DISCORD_WEBHOOK_URL
  return import('./cronRuns')
}

beforeEach(() => {
  vi.clearAllMocks()
  vi.unstubAllGlobals()
  insertValues.mockResolvedValue(undefined)
  limitFn.mockResolvedValue([])
})

afterEach(() => {
  if (ORIGINAL_WEBHOOK === undefined) delete process.env.PANIC_DISCORD_WEBHOOK_URL
  else process.env.PANIC_DISCORD_WEBHOOK_URL = ORIGINAL_WEBHOOK
})

describe('recordCronRun — zapis wiersza', () => {
  it('dopelnia pominiete pola domyslnymi wartosciami (portalId null, itemsProcessed 0, detail null)', async () => {
    const { recordCronRun } = await freshCronRuns()
    const startedAt = new Date('2026-08-01T10:00:00Z')

    await recordCronRun({ job: 'task-index', ok: true, startedAt })

    assert.strictEqual(insertValues.mock.calls.length, 1)
    assert.deepStrictEqual(insertValues.mock.calls[0][0], {
      job: 'task-index',
      portalId: null,
      ok: true,
      itemsProcessed: 0,
      detail: null,
      startedAt,
    })
  })

  it('przekazuje wprost portalId, itemsProcessed i detail, gdy sa podane', async () => {
    const { recordCronRun } = await freshCronRuns()
    const startedAt = new Date('2026-08-01T10:00:00Z')

    await recordCronRun({
      job: 'time-snapshot',
      portalId: 'portal-1',
      ok: true,
      itemsProcessed: 42,
      detail: 'zadan: 42',
      startedAt,
    })

    assert.deepStrictEqual(insertValues.mock.calls[0][0], {
      job: 'time-snapshot',
      portalId: 'portal-1',
      ok: true,
      itemsProcessed: 42,
      detail: 'zadan: 42',
      startedAt,
    })
  })
})

describe('recordCronRun — alarm na Discordzie przy porazce', () => {
  it('NIE wysyla alarmu, gdy przebieg sie udal', async () => {
    const { recordCronRun } = await freshCronRuns('https://discord.test/webhook')
    const fetchMock = vi.fn(async (_url: string, _init: { method: string; headers: Record<string, string>; body: string }) => ({ ok: true }))
    vi.stubGlobal('fetch', fetchMock)

    await recordCronRun({ job: 'task-index', ok: true, startedAt: new Date() })

    assert.strictEqual(fetchMock.mock.calls.length, 0)
  })

  it('wysyla alarm z zadaniem, projektem i szczegolami, gdy przebieg sie nie udal', async () => {
    const { recordCronRun } = await freshCronRuns('https://discord.test/webhook')
    const fetchMock = vi.fn(async (_url: string, _init: { method: string; headers: Record<string, string>; body: string }) => ({ ok: true }))
    vi.stubGlobal('fetch', fetchMock)

    await recordCronRun({
      job: 'task-index',
      portalSlug: 'wdf',
      ok: false,
      detail: 'ClickUp padl',
      startedAt: new Date(),
    })

    assert.strictEqual(fetchMock.mock.calls.length, 1)
    const [url, init] = fetchMock.mock.calls[0]
    assert.strictEqual(url, 'https://discord.test/webhook')
    assert.strictEqual(init.method, 'POST')
    const body = JSON.parse(init.body) as { content: string }
    assert.match(body.content, /task-index/)
    assert.match(body.content, /wdf/)
    assert.match(body.content, /ClickUp padl/)
  })

  it('pomija wzmianke o projekcie w tresci alarmu, gdy portalSlug nie jest podany', async () => {
    const { recordCronRun } = await freshCronRuns('https://discord.test/webhook')
    const fetchMock = vi.fn(async (_url: string, _init: { method: string; headers: Record<string, string>; body: string }) => ({ ok: true }))
    vi.stubGlobal('fetch', fetchMock)

    await recordCronRun({ job: 'task-index', ok: false, detail: 'blad', startedAt: new Date() })

    const [, init] = fetchMock.mock.calls[0]
    const body = JSON.parse(init.body) as { content: string }
    assert.doesNotMatch(body.content, /projekt:/)
  })

  it('loguje ostrzezenie zamiast wolania sieciowego, gdy brak PANIC_DISCORD_WEBHOOK_URL', async () => {
    const { recordCronRun } = await freshCronRuns(undefined)
    const fetchMock = vi.fn(async (_url: string, _init: { method: string; headers: Record<string, string>; body: string }) => ({ ok: true }))
    vi.stubGlobal('fetch', fetchMock)
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {})

    await recordCronRun({ job: 'task-index', ok: false, detail: 'blad', startedAt: new Date() })

    assert.strictEqual(fetchMock.mock.calls.length, 0)
    assert.ok(warn.mock.calls.some(c => String(c[0]).includes('PANIC_DISCORD_WEBHOOK_URL')))
    warn.mockRestore()
  })

  it('nie przewraca zapisu, gdy wyslanie alarmu na Discorda sie nie uda (blad sieci)', async () => {
    const { recordCronRun } = await freshCronRuns('https://discord.test/webhook')
    vi.stubGlobal('fetch', vi.fn(async () => { throw new Error('ECONNRESET') }))
    const errorSpy = vi.spyOn(console, 'error').mockImplementation(() => {})

    await assert.doesNotReject(() =>
      recordCronRun({ job: 'task-index', ok: false, detail: 'blad', startedAt: new Date() })
    )

    assert.strictEqual(errorSpy.mock.calls.length, 1)
    errorSpy.mockRestore()
  })
})

/**
 * Padnięty zapis do rejestru NIE MOŻE przewrócić crona.
 *
 * Obie trasy cronowe (`task-index`, `time-snapshot`) wołają `recordCronRun` w
 * pętli po portalach i NIE otaczają go własnym try/catch. Zanim ta ochrona
 * powstała, jedno odrzucenie przerywało pętlę: pozostałe projekty zostawały
 * niezsynchronizowane, a przy porażce zapisu w gałęzi `try` trasy wchodził
 * jeszcze jej `catch` i zapisywał UDANY przebieg jako nieudany.
 */
describe('recordCronRun — blad zapisu do rejestru', () => {
  it('padniety insert nie przerywa crona (obietnica sie nie odrzuca)', async () => {
    const { recordCronRun } = await freshCronRuns('https://discord.test/webhook')
    insertValues.mockRejectedValueOnce(new Error('baza niedostepna'))
    const errorSpy = vi.spyOn(console, 'error').mockImplementation(() => {})
    vi.stubGlobal('fetch', vi.fn(async () => ({ ok: true })))

    await assert.doesNotReject(() =>
      recordCronRun({ job: 'task-index', ok: false, detail: 'x', startedAt: new Date() })
    )

    // Cisza jest gorsza od awarii: awaria rejestru ma zostawic slad w logach.
    assert.strictEqual(errorSpy.mock.calls.length, 1)
    errorSpy.mockRestore()
  })

  it('alarm o porazce wychodzi MIMO padnietego zapisu do rejestru', async () => {
    const { recordCronRun } = await freshCronRuns('https://discord.test/webhook')
    insertValues.mockRejectedValueOnce(new Error('baza niedostepna'))
    vi.spyOn(console, 'error').mockImplementation(() => {})
    const fetchMock = vi.fn(async () => ({ ok: true }))
    vi.stubGlobal('fetch', fetchMock)

    await recordCronRun({ job: 'task-index', ok: false, detail: 'x', startedAt: new Date() })

    // Wczesniej insert wywalal sie PRZED sprawdzeniem `result.ok`, wiec awaria
    // samego rejestru byla CICHSZA niz awaria, ktora rejestr mial naglasniac.
    assert.strictEqual(fetchMock.mock.calls.length, 1)
    vi.mocked(console.error).mockRestore()
  })

  it('udany przebieg z padnietym zapisem nie wysyla falszywego alarmu', async () => {
    const { recordCronRun } = await freshCronRuns('https://discord.test/webhook')
    insertValues.mockRejectedValueOnce(new Error('baza niedostepna'))
    vi.spyOn(console, 'error').mockImplementation(() => {})
    const fetchMock = vi.fn(async () => ({ ok: true }))
    vi.stubGlobal('fetch', fetchMock)

    await recordCronRun({ job: 'task-index', ok: true, startedAt: new Date() })

    assert.strictEqual(fetchMock.mock.calls.length, 0)
    vi.mocked(console.error).mockRestore()
  })
})

describe('listCronRuns — limit', () => {
  const przypadki: Array<[number | undefined, number]> = [
    [undefined, 50],
    [0, 1],
    [-10, 1],
    [500, 200],
    [150, 150],
  ]

  for (const [podany, oczekiwany] of przypadki) {
    it(`limit ${String(podany)} -> ${oczekiwany}`, async () => {
      await listCronRuns({ portalId: 'p1', limit: podany })

      assert.strictEqual(limitFn.mock.calls[0][0], oczekiwany)
    })
  }
})

describe('listCronRuns — filtry', () => {
  it('filtruje zawsze po portalId, warunek job TYLKO gdy podany', async () => {
    await listCronRuns({ portalId: 'p1' })

    assert.strictEqual(drizzleOrm.and.mock.calls[0].length, 1)
    assert.deepStrictEqual(drizzleOrm.eq.mock.calls[0], [cronRuns.portalId, 'p1'])
  })

  it('dodaje drugi warunek dla joba, gdy jest podany', async () => {
    await listCronRuns({ portalId: 'p1', job: 'time-snapshot' })

    assert.strictEqual(drizzleOrm.and.mock.calls[0].length, 2)
    assert.deepStrictEqual(drizzleOrm.eq.mock.calls[0], [cronRuns.portalId, 'p1'])
    assert.deepStrictEqual(drizzleOrm.eq.mock.calls[1], [cronRuns.job, 'time-snapshot'])
  })
})

describe('listCronRuns — mapowanie wierszy', () => {
  it('liczy durationMs z roznicy finishedAt - startedAt i podpisuje etykieta zadania', async () => {
    const startedAt = new Date('2026-08-01T10:00:00Z')
    const finishedAt = new Date('2026-08-01T10:00:02Z')
    limitFn.mockResolvedValueOnce([
      {
        id: 'r1',
        job: 'task-index',
        portalId: 'p1',
        ok: true,
        itemsProcessed: 5,
        detail: null,
        startedAt,
        finishedAt,
      },
    ])

    const rows = await listCronRuns({ portalId: 'p1' })

    assert.strictEqual(rows[0].durationMs, 2000)
    assert.strictEqual(rows[0].jobLabel, CRON_JOB_LABELS['task-index'])
  })

  it('podaje surowa nazwe zadania jako etykiete, gdy zadanie nie jest znane', async () => {
    limitFn.mockResolvedValueOnce([
      {
        id: 'r1',
        job: 'jakies-nieznane-zadanie',
        portalId: 'p1',
        ok: true,
        itemsProcessed: 0,
        detail: null,
        startedAt: new Date(),
        finishedAt: new Date(),
      },
    ])

    const rows = await listCronRuns({ portalId: 'p1' })

    assert.strictEqual(rows[0].jobLabel, 'jakies-nieznane-zadanie')
  })

  it('durationMs nie schodzi ponizej zera, gdy finishedAt jest wczesniejszy niz startedAt', async () => {
    limitFn.mockResolvedValueOnce([
      {
        id: 'r1',
        job: 'task-index',
        portalId: 'p1',
        ok: true,
        itemsProcessed: 0,
        detail: null,
        startedAt: new Date('2026-08-01T10:00:05Z'),
        finishedAt: new Date('2026-08-01T10:00:00Z'),
      },
    ])

    const rows = await listCronRuns({ portalId: 'p1' })

    assert.strictEqual(rows[0].durationMs, 0)
  })
})

describe('getLastSuccessfulRun', () => {
  it('zwraca null, gdy nie ma zadnego udanego przebiegu', async () => {
    limitFn.mockResolvedValueOnce([])

    const wynik = await getLastSuccessfulRun('task-index', 'p1')

    assert.strictEqual(wynik, null)
  })

  it('zwraca date ostatniego udanego przebiegu', async () => {
    const finishedAt = new Date('2026-08-01T10:00:00Z')
    limitFn.mockResolvedValueOnce([{ finishedAt }])

    const wynik = await getLastSuccessfulRun('task-index', 'p1')

    assert.strictEqual(wynik, finishedAt)
  })

  it('filtruje po zadaniu, portalu ORAZ sukcesie (ok=true) — nieudany przebieg nie liczy sie jako "ostatnie dane"', async () => {
    await getLastSuccessfulRun('time-snapshot', 'p1')

    assert.strictEqual(drizzleOrm.and.mock.calls[0].length, 3)
    assert.deepStrictEqual(drizzleOrm.eq.mock.calls[0], [cronRuns.job, 'time-snapshot'])
    assert.deepStrictEqual(drizzleOrm.eq.mock.calls[1], [cronRuns.portalId, 'p1'])
    assert.deepStrictEqual(drizzleOrm.eq.mock.calls[2], [cronRuns.ok, true])
  })
})
