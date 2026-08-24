import { describe, it, beforeAll, afterAll, beforeEach, vi } from 'vitest'
import assert from 'node:assert'
import { isDbReachable, createTestPortal, dropTestPortal, createTestList } from './helpers'

/**
 * TRASY CRONOWE: zamrazanie godzin i synchronizacja indeksu Historii.
 *
 * Obie chodza W PETLI PO WSZYSTKICH aktywnych portalach i obie zwracaja wynik
 * wylacznie w tresci odpowiedzi HTTP, ktora wpis w crontabie kieruje do
 * /dev/null. Znaczy to, ze awaria jednego projektu jest tu z natury cicha —
 * dlatego najwazniejszy test w tym pliku sprawdza, ze porazka JEDNEGO portalu
 * nie przerywa przetwarzania pozostalych.
 *
 * UWAGA, dlaczego tu podstawione jest wiecej niz zwykle: w tej bazie siedza
 * PRAWDZIWE portale (Onyx, WDF, EFF), a te trasy przechodza po wszystkich
 * aktywnych. Gdyby `writeSnapshots`, `syncPortalIndex` albo `recordCronRun`
 * byly prawdziwe, test dopisywalby wiersze do danych klientow i do dziennika
 * synchronizacji widocznego w panelu. Podstawiamy wiec wszystko, co ZAPISUJE,
 * a sprawdzamy to, co jest tu wlasciwym przedmiotem testu: uprawnienia, wybor
 * portali, odpornosc petli i to, ze kazdy przebieg zostaje odnotowany.
 *
 * Sama ochrona zapisu do rejestru (`recordCronRun` nie moze przewrocic crona)
 * ma wlasne testy w src/lib/cronRuns.test.ts, na poziomie tamtego modulu.
 *
 *   docker start cp-test-pg && npm run test:integration
 */
const { clickup, taskIndex, timeSnapshots, cronRuns, scopeStore, store } = vi.hoisted(() => ({
  clickup: { getAllTasksForFolder: vi.fn(), getAllTasksForLists: vi.fn() },
  taskIndex: { syncPortalIndex: vi.fn() },
  timeSnapshots: { writeSnapshots: vi.fn() },
  cronRuns: { recordCronRun: vi.fn() },
  scopeStore: { getPortalScope: vi.fn() },
  store: { purgeOldRead: vi.fn(async () => 0) },
}))

vi.mock('@/lib/clickup', () => clickup)
vi.mock('@/lib/taskIndex', () => taskIndex)
vi.mock('@/lib/timeSnapshots', () => timeSnapshots)
vi.mock('@/lib/cronRuns', () => cronRuns)
vi.mock('@/lib/portalScopeStore', () => scopeStore)
vi.mock('@/lib/notificationStore', () => store)

import { NextRequest } from 'next/server'
import { GET as indexGET, POST as indexPOST } from '@/app/api/cron/task-index/route'
import { GET as snapshotGET } from '@/app/api/cron/time-snapshot/route'

const dbUp = await isDbReachable()
const maSekret = !!process.env.CRON_SECRET

const req = (url: string, init?: RequestInit) =>
  new NextRequest(`http://localhost${url}`, init as ConstructorParameters<typeof NextRequest>[1])

const zTokenem = (url: string) =>
  req(url, { headers: { authorization: `Bearer ${process.env.CRON_SECRET}` } })

const WYNIK_SYNC = {
  fetched: 10, upserted: 10, deleted: 0, contentSynced: 3, contentPending: 0, truncated: false,
}

describe.skipIf(!dbUp || !maSekret)('trasy cronowe na prawdziwej bazie', () => {
  let portalA: { id: string; slug: string }
  let portalB: { id: string; slug: string }

  beforeAll(async () => {
    portalA = await createTestPortal('cron-a')
    portalB = await createTestPortal('cron-b')
    await createTestList({ portalId: portalA.id, clickupListId: 'lista-crona', isDefault: true })
  })

  afterAll(async () => {
    if (portalA) await dropTestPortal(portalA.id)
    if (portalB) await dropTestPortal(portalB.id)
  })

  beforeEach(() => {
    vi.clearAllMocks()
    taskIndex.syncPortalIndex.mockResolvedValue(WYNIK_SYNC)
    timeSnapshots.writeSnapshots.mockResolvedValue(7)
    cronRuns.recordCronRun.mockResolvedValue(undefined)
    scopeStore.getPortalScope.mockResolvedValue([])
    clickup.getAllTasksForFolder.mockResolvedValue([])
    clickup.getAllTasksForLists.mockResolvedValue([])
  })

  /** Wpisy rejestru dotyczace KONKRETNEGO portalu. */
  const przebiegi = (portalId: string) =>
    cronRuns.recordCronRun.mock.calls.map(c => c[0]).filter(r => r.portalId === portalId)

  describe('uprawnienia', () => {
    const trasy: Array<[string, (r: NextRequest) => Promise<Response>]> = [
      ['task-index', indexGET],
      ['time-snapshot', snapshotGET],
    ]

    for (const [nazwa, wywolaj] of trasy) {
      it(`${nazwa} bez tokenu -> 401 i zadnej pracy`, async () => {
        const res = await wywolaj(req(`/api/cron/${nazwa}`))

        assert.strictEqual(res.status, 401)
        assert.strictEqual(taskIndex.syncPortalIndex.mock.calls.length, 0)
        assert.strictEqual(timeSnapshots.writeSnapshots.mock.calls.length, 0)
      })

      it(`${nazwa} ze zlym tokenem -> 401`, async () => {
        const res = await wywolaj(
          req(`/api/cron/${nazwa}`, { headers: { authorization: 'Bearer zgadywany' } })
        )
        assert.strictEqual(res.status, 401)
      })
    }

    it('token w parametrze adresu TEZ dziala (proste harmonogramy)', async () => {
      const res = await indexGET(
        req(`/api/cron/task-index?slug=${portalA.slug}&token=${process.env.CRON_SECRET}`)
      )
      assert.strictEqual(res.status, 200)
    })
  })

  describe('wybor portali', () => {
    it('?slug wskazuje DOKLADNIE jeden projekt', async () => {
      const res = await indexGET(zTokenem(`/api/cron/task-index?slug=${portalA.slug}`))
      const body = await res.json()

      assert.strictEqual(res.status, 200)
      assert.strictEqual(body.portals.length, 1)
      assert.strictEqual(body.portals[0].slug, portalA.slug)
      assert.strictEqual(taskIndex.syncPortalIndex.mock.calls.length, 1)
    })

    it('?slug nieistniejacego projektu -> 404, a nie ciche zero', async () => {
      const res = await indexGET(zTokenem('/api/cron/task-index?slug=nie-ma-takiego'))

      // Ciche `{portals: []}` wygladaloby w logu identycznie jak udany przebieg
      // projektu, ktory nie ma zadan. Literowka w crontabie byla by niewidoczna.
      assert.strictEqual(res.status, 404)
      assert.strictEqual(taskIndex.syncPortalIndex.mock.calls.length, 0)
    })

    it('bez ?slug przetwarza WIELE portali, w tym oba testowe', async () => {
      const res = await indexGET(zTokenem('/api/cron/task-index'))
      const body = await res.json()

      const slugi = body.portals.map((p: { slug: string }) => p.slug)
      assert.ok(slugi.includes(portalA.slug))
      assert.ok(slugi.includes(portalB.slug))
    })
  })

  /**
   * NAJWAZNIEJSZE W TYM PLIKU.
   *
   * Petla po portalach jest miejscem, w ktorym jeden padniety projekt moze
   * zabrac ze soba pozostale. Skutek jest cichy: crontab kieruje odpowiedz do
   * /dev/null, wiec „polowa klientow nie zsynchronizowana od tygodnia" nie ma
   * zadnego sygnalu poza pytaniem klienta, czemu widzi stare dane.
   */
  describe('porazka jednego projektu nie zabiera pozostalych', () => {
    it('task-index: projekt, ktory rzucil wyjatkiem, nie przerywa reszty', async () => {
      taskIndex.syncPortalIndex.mockImplementation(async (portal: { id: string }) => {
        if (portal.id === portalA.id) throw new Error('ClickUp nie odpowiada')
        return WYNIK_SYNC
      })

      const res = await indexGET(zTokenem('/api/cron/task-index'))
      const body = await res.json()

      assert.strictEqual(res.status, 200, 'cala trasa nie przewraca sie przez jeden projekt')

      const a = body.portals.find((p: { slug: string }) => p.slug === portalA.slug)
      const b = body.portals.find((p: { slug: string }) => p.slug === portalB.slug)
      assert.strictEqual(a.ok, false)
      assert.match(a.error, /ClickUp nie odpowiada/)
      assert.strictEqual(b.ok, true, 'kolejny projekt PRZESZEDL mimo porazki poprzedniego')

      // I jedno, i drugie musi zostac odnotowane, inaczej awaria jest cicha.
      assert.strictEqual(przebiegi(portalA.id)[0].ok, false)
      assert.strictEqual(przebiegi(portalB.id)[0].ok, true)
    })

    it('time-snapshot: to samo przy zamrazaniu godzin', async () => {
      timeSnapshots.writeSnapshots.mockImplementation(async (portalId: string) => {
        if (portalId === portalA.id) throw new Error('baza nie odpowiada')
        return 7
      })

      const res = await snapshotGET(zTokenem('/api/cron/time-snapshot'))
      const body = await res.json()

      const a = body.portals.find((p: { slug: string }) => p.slug === portalA.slug)
      const b = body.portals.find((p: { slug: string }) => p.slug === portalB.slug)
      assert.strictEqual(a.ok, false)
      assert.strictEqual(b.ok, true)
    })
  })

  describe('rejestr przebiegow', () => {
    it('udany przebieg zostaje odnotowany z liczba zadan', async () => {
      await indexGET(zTokenem(`/api/cron/task-index?slug=${portalA.slug}`))

      const [wpis] = przebiegi(portalA.id)
      assert.strictEqual(wpis.job, 'task-index')
      assert.strictEqual(wpis.ok, true)
      assert.strictEqual(wpis.itemsProcessed, WYNIK_SYNC.upserted)
      assert.ok(wpis.startedAt instanceof Date, 'czas rozpoczecia mierzony PRZED praca')
    })

    it('UCIETY pobor jest odnotowany jako NIEUDANY, mimo braku wyjatku', async () => {
      taskIndex.syncPortalIndex.mockResolvedValue({ ...WYNIK_SYNC, truncated: true })

      const res = await indexGET(zTokenem(`/api/cron/task-index?slug=${portalA.slug}`))
      const body = await res.json()

      // Trasa oddaje 200 i `ok: true` dla samego pobrania, ale rekoncyliacja
      // sie NIE wykonala, wiec z indeksu nie wypadly zadania usuniete
      // w ClickUpie. Zespol musi o tym wiedziec, dlatego przebieg jest
      // nieudany, choc nic nie rzucilo wyjatkiem.
      assert.strictEqual(res.status, 200)
      assert.strictEqual(body.portals[0].truncated, true)
      const [wpis] = przebiegi(portalA.id)
      assert.strictEqual(wpis.ok, false)
      assert.match(wpis.detail, /UCI/i)
    })

    it('zamrazanie godzin odnotowuje liczbe zamrozonych zadan', async () => {
      await snapshotGET(zTokenem(`/api/cron/time-snapshot?slug=${portalA.slug}`))

      const [wpis] = przebiegi(portalA.id)
      assert.strictEqual(wpis.job, 'time-snapshot')
      assert.strictEqual(wpis.ok, true)
      assert.strictEqual(wpis.itemsProcessed, 7)
    })
  })

  describe('parametry', () => {
    it('budzet z adresu dochodzi do synchronizacji, z gornym ograniczeniem', async () => {
      await indexGET(zTokenem(`/api/cron/task-index?slug=${portalA.slug}&budget=9999`))

      const opcje = taskIndex.syncPortalIndex.mock.calls[0][1]
      // Bez ograniczenia jedno wywolanie probowaloby doczytac tresc setek zadan
      // i przekroczylo by limit czasu zadania, nie konczac niczego.
      assert.ok(opcje.budget <= 500, `budzet ograniczony, dostal ${opcje.budget}`)
    })

    it('bezsensowny budzet spada do wartosci domyslnej', async () => {
      await indexGET(zTokenem(`/api/cron/task-index?slug=${portalA.slug}&budget=abc`))

      assert.strictEqual(taskIndex.syncPortalIndex.mock.calls[0][1].budget, 40)
    })

    it('force=1 wymusza przebudowe tresci', async () => {
      await indexGET(zTokenem(`/api/cron/task-index?slug=${portalA.slug}&force=1`))

      // Przebieg przyrostowy przeoczylby zdjecie prefiksu [PUBLIC], bo to nie
      // musi ruszyc `date_updated` zadania. Ten parametr jest siatka.
      assert.strictEqual(taskIndex.syncPortalIndex.mock.calls[0][1].forceContent, true)
    })

    it('POST dziala tak samo jak GET', async () => {
      const res = await indexPOST(
        req(`/api/cron/task-index?slug=${portalA.slug}`, {
          method: 'POST',
          headers: { authorization: `Bearer ${process.env.CRON_SECRET}` },
        })
      )

      assert.strictEqual(res.status, 200)
      assert.strictEqual(taskIndex.syncPortalIndex.mock.calls.length, 1)
    })
  })

  describe('zakres list', () => {
    it('zamrazanie godzin bierze TEN SAM zakres, co tablica', async () => {
      scopeStore.getPortalScope.mockResolvedValue(['lista-crona'])

      await snapshotGET(zTokenem(`/api/cron/time-snapshot?slug=${portalA.slug}`))

      // Inaczej zamrozilibysmy godziny zadan, ktorych klient w portalu nie
      // widzi, a raport czasu jest podstawa rozliczenia.
      assert.deepStrictEqual(clickup.getAllTasksForLists.mock.calls[0][0], ['lista-crona'])
      assert.strictEqual(clickup.getAllTasksForFolder.mock.calls.length, 0)
    })

    it('pusty zakres znaczy caly folder', async () => {
      scopeStore.getPortalScope.mockResolvedValue([])

      await snapshotGET(zTokenem(`/api/cron/time-snapshot?slug=${portalA.slug}`))

      assert.strictEqual(clickup.getAllTasksForFolder.mock.calls.length, 1)
      assert.strictEqual(clickup.getAllTasksForLists.mock.calls.length, 0)
    })
  })

  /**
   * RETENCJA POWIADOMIEN.
   *
   * Spec przewidywal ja przy cronie zbiorczych maili, ktorego nie budujemy, wiec
   * `purgeOldRead` zostalo bez wywolania i tabela `notifications` roslaby bez
   * konca. To NIE byla decyzja, tylko skutek uboczny — stad ten test.
   */
  describe('sprzatanie starych powiadomien', () => {
    it('dzienny przebieg indeksu kasuje PRZECZYTANE starsze niz 90 dni', async () => {
      taskIndex.syncPortalIndex.mockResolvedValue({
        fetched: 0, upserted: 0, deleted: 0, contentSynced: 0, contentPending: 0, truncated: false,
      })
      store.purgeOldRead.mockResolvedValue(3)

      const res = await indexGET(req(`/api/cron/task-index?token=${process.env.CRON_SECRET}&slug=${portalA.slug}`))
      const body = await res.json()

      assert.strictEqual(res.status, 200)
      assert.deepStrictEqual(store.purgeOldRead.mock.calls[0], [90])
      assert.strictEqual(body.purgedNotifications, 3, 'wynik ma byc widoczny w odpowiedzi')
    })

    it('awaria sprzatania NIE psuje indeksowania', async () => {
      // Indeks Historii jest wazniejszy niz porzadek w tabeli powiadomien.
      taskIndex.syncPortalIndex.mockResolvedValue({
        fetched: 0, upserted: 0, deleted: 0, contentSynced: 0, contentPending: 0, truncated: false,
      })
      store.purgeOldRead.mockRejectedValue(new Error('baza padla'))
      const errorSpy = vi.spyOn(console, 'error').mockImplementation(() => {})

      const res = await indexGET(req(`/api/cron/task-index?token=${process.env.CRON_SECRET}&slug=${portalA.slug}`))

      assert.strictEqual(res.status, 200)
      assert.strictEqual(taskIndex.syncPortalIndex.mock.calls.length, 1)
      errorSpy.mockRestore()
    })
  })
})
