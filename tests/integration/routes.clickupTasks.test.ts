import { describe, it, beforeAll, afterAll, beforeEach, vi } from 'vitest'
import assert from 'node:assert'
import { createHmac } from 'node:crypto'
import { and, eq } from 'drizzle-orm'
import { db } from '@/lib/db'
import { auditLog, portals } from '@/lib/db/schema'
import {
  isDbReachable,
  createTestPortal,
  dropTestPortal,
  createTestUser,
  createTestList,
  insertIndexedTask,
} from './helpers'

/**
 * TRASY ClickUpa wywolane wprost, jako funkcje, na prawdziwej bazie.
 *
 * PO CO, skoro brama ma juz wlasne testy: brama dowodzi tylko tego, ze potrafi
 * wpuscic i odmowic. Nie dowodzi, ze KAZDA trasa jej uzywa i ze uzywa jej PRZED
 * dotknieciem ClickUpa. To sa dwie rozne rzeczy i tylko ta druga chroni dane
 * klienta. Klikanie po przegladarce tego nie pokaze, bo sprawdza jedna sciezke
 * naraz i tylko te, do ktorej da sie dojsc mysza.
 *
 * ClickUp jest PODSTAWIONY, bo to siec i cudze dane. Wszystko inne jest
 * prawdziwe: Postgres, sesje, ciasteczka, HMAC admina, zapis do audit_log.
 * Dzieki temu test odpowiada na pytanie "czy klient A dosiegnie zadania klienta
 * B", a nie na pytanie "czy atrapa zwrocila to, co jej kazalem".
 *
 * KAZDY test odmowy ma pare dowodzaca, ze ta sama konfiguracja dziala dla
 * uprawnionego. Odmowa z powodu awarii wyglada tak samo jak odmowa z reguly.
 *
 *   docker start cp-test-pg && npm run test:integration
 */
const { cookieJar, clickup, cache } = vi.hoisted(() => ({
  cookieJar: new Map<string, string>(),
  clickup: {
    getTask: vi.fn(),
    getTaskComments: vi.fn(),
    addComment: vi.fn(),
    updateComment: vi.fn(),
    deleteComment: vi.fn(),
    verifyTaskBelongsToFolder: vi.fn(),
    updateTask: vi.fn(),
    createTask: vi.fn(),
    addTaskAttachment: vi.fn(),
    getAllTasksForFolder: vi.fn(),
    getAllTasksForLists: vi.fn(),
    getRecentlyClosedTasksForFolder: vi.fn(),
    getRecentlyClosedTasksForLists: vi.fn(),
  },
  cache: { invalidateFolderTasks: vi.fn(async () => {}) },
}))

vi.mock('next/headers', () => ({
  cookies: vi.fn(async () => ({
    get: (name: string) => (cookieJar.has(name) ? { value: cookieJar.get(name)! } : undefined),
    set: (name: string, value: string) => { cookieJar.set(name, value) },
    delete: (name: string) => { cookieJar.delete(name) },
  })),
}))
vi.mock('@/lib/clickup', () => clickup)
vi.mock('@/lib/clickupCache', () => ({
  ...cache,
  getCachedTasksForScope: vi.fn(),
  folderTasksTag: (id: string) => `folder-${id}`,
}))

import { NextRequest } from 'next/server'
import { createSession, setSessionCookie } from '@/lib/auth'
import { GET as tasksGET, POST as tasksPOST } from '@/app/api/clickup/tasks/route'
import { GET as taskGET, PATCH as taskPATCH } from '@/app/api/clickup/tasks/[taskId]/route'
import { GET as commentsGET, POST as commentsPOST } from '@/app/api/clickup/tasks/[taskId]/comments/route'
import { PUT as commentPUT, DELETE as commentDELETE } from '@/app/api/clickup/tasks/[taskId]/comments/[commentId]/route'

const dbUp = await isDbReachable()

const req = (url: string, init?: RequestInit) =>
  new NextRequest(`http://localhost${url}`, init as ConstructorParameters<typeof NextRequest>[1])

const jsonReq = (url: string, body: unknown) =>
  req(url, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) })

const params = (taskId: string) => ({ params: Promise.resolve({ taskId }) })

describe.skipIf(!dbUp)('trasy ClickUpa na prawdziwej bazie', () => {
  let portalA: { id: string; slug: string }
  let portalB: { id: string; slug: string }
  let userA: string

  beforeAll(async () => {
    portalA = await createTestPortal('rt-a')
    portalB = await createTestPortal('rt-b')
    userA = await createTestUser(portalA.id, `user-${portalA.slug}@example.com`)
    // Portal A ma JEDNA liste w zakresie. Bez tego zakres bylby pusty, czyli
    // "caly folder", i testy granicy list nie sprawdzalyby niczego.
    await createTestList({ portalId: portalA.id, clickupListId: 'lista-portalu', isDefault: true })
  })

  afterAll(async () => {
    if (portalA) await dropTestPortal(portalA.id)
    if (portalB) await dropTestPortal(portalB.id)
  })

  beforeEach(async () => {
    cookieJar.clear()
    vi.clearAllMocks()
    cache.invalidateFolderTasks.mockResolvedValue(undefined)
    clickup.getRecentlyClosedTasksForFolder.mockResolvedValue([])
    clickup.getRecentlyClosedTasksForLists.mockResolvedValue([])
  })

  async function loginClient(): Promise<void> {
    await setSessionCookie(await createSession(userA, '127.0.0.1', 'vitest'))
  }

  function loginAdmin(): void {
    cookieJar.set(
      'admin_session',
      createHmac('sha256', process.env.ADMIN_SECRET!).update('admin-session').digest('hex')
    )
  }

  /** Zadanie, ktore NALEZY do portalu A: wlasciwy folder i lista w zakresie. */
  const zadanieWlasne = (id = 'task-1') => ({
    id,
    name: 'Zadanie',
    folder: { id: `fake-${portalA.slug}` },
    list: { id: 'lista-portalu' },
    attachments: [{ id: 'att-1', url: 'https://example.test/a.png' }],
  })

  describe('GET /api/clickup/tasks (lista)', () => {
    it('bez sesji nie woła ClickUpa W OGOLE, nie tylko odmawia', async () => {
      const res = await tasksGET(req(`/api/clickup/tasks?slug=${portalA.slug}`))

      assert.strictEqual(res.status, 401)
      // To jest istota: gdyby brama byla PO pobraniu, dane juz by wyciekly do
      // procesu, a limit zapytan ClickUpa zjadalby kazdy nieuprawniony strzal.
      assert.strictEqual(clickup.getAllTasksForLists.mock.calls.length, 0)
      assert.strictEqual(clickup.getAllTasksForFolder.mock.calls.length, 0)
    })

    it('zalogowany klient dostaje zadania SWOJEGO zakresu list', async () => {
      await loginClient()
      clickup.getAllTasksForLists.mockResolvedValue([{ id: 't1', name: 'A', list: { id: 'lista-portalu' } }])

      const res = await tasksGET(req(`/api/clickup/tasks?slug=${portalA.slug}`))
      const body = await res.json()

      assert.strictEqual(res.status, 200)
      assert.strictEqual(body.tasks.length, 1)
      // Zakres zawezony, wiec pobranie idzie po listach, nie po calym folderze.
      assert.deepStrictEqual(clickup.getAllTasksForLists.mock.calls[0][0], ['lista-portalu'])
      assert.strictEqual(clickup.getAllTasksForFolder.mock.calls.length, 0)
    })

    it('klient portalu A nie pobierze zadan portalu B', async () => {
      await loginClient()

      const res = await tasksGET(req(`/api/clickup/tasks?slug=${portalB.slug}`))

      assert.strictEqual(res.status, 401)
      assert.strictEqual(clickup.getAllTasksForLists.mock.calls.length, 0)
    })

    it('bez sluga -> 400', async () => {
      await loginClient()
      const res = await tasksGET(req('/api/clickup/tasks'))
      assert.strictEqual(res.status, 400)
    })

    describe('niedawno zamkniete (statusControlsEnabled)', () => {
      it('flaga WYLACZONA -> nie dociaga zamknietych, zero wywolania', async () => {
        await loginClient()
        clickup.getAllTasksForLists.mockResolvedValue([])

        await tasksGET(req(`/api/clickup/tasks?slug=${portalA.slug}`))

        assert.strictEqual(clickup.getRecentlyClosedTasksForLists.mock.calls.length, 0)
        assert.strictEqual(clickup.getRecentlyClosedTasksForFolder.mock.calls.length, 0)
      })

      it('flaga WLACZONA -> zamkniete zadania trafiaja do odpowiedzi', async () => {
        await db.update(portals).set({ statusControlsEnabled: true }).where(eq(portals.id, portalA.id))
        await loginClient()
        clickup.getAllTasksForLists.mockResolvedValue([{ id: 'otwarte-1', name: 'Otwarte' }])
        clickup.getRecentlyClosedTasksForLists.mockResolvedValue([{ id: 'zamkniete-1', name: 'Zamkniete' }])

        const res = await tasksGET(req(`/api/clickup/tasks?slug=${portalA.slug}`))
        const { tasks } = await res.json()

        assert.deepStrictEqual(tasks.map((t: { id: string }) => t.id).sort(), ['otwarte-1', 'zamkniete-1'])
        // Portal A ma liste w zakresie (beforeAll), wiec droga to "...ForLists".
        assert.strictEqual(clickup.getRecentlyClosedTasksForLists.mock.calls.length, 1)
        assert.deepStrictEqual(clickup.getRecentlyClosedTasksForLists.mock.calls[0][0], ['lista-portalu'])

        await db.update(portals).set({ statusControlsEnabled: false }).where(eq(portals.id, portalA.id))
      })
    })
  })

  describe('POST /api/clickup/tasks (nowe zadanie)', () => {
    it('tworzy zadanie na domyslnej liscie i zapisuje zdarzenie do historii', async () => {
      await loginClient()
      clickup.createTask.mockResolvedValue({ id: 'nowe-1', name: 'Z formularza', url: 'https://cu.test/1' })

      const res = await tasksPOST(
        jsonReq('/api/clickup/tasks', { slug: portalA.slug, name: 'Z formularza', description: 'opis' })
      )
      const body = await res.json()

      assert.strictEqual(res.status, 200)
      assert.strictEqual(body.task.id, 'nowe-1')
      assert.strictEqual(clickup.createTask.mock.calls[0][0], 'lista-portalu')

      // Stopka z autorem jest doklejana po stronie serwera, nie przez klienta.
      const opis = clickup.createTask.mock.calls[0][1].description as string
      assert.ok(opis.includes('opis'), 'tresc klienta zostaje')
      assert.ok(opis.includes(`user-${portalA.slug}@example.com`), 'stopka niesie autora')

      const wpisy = await db
        .select()
        .from(auditLog)
        .where(and(eq(auditLog.portalId, portalA.id), eq(auditLog.resourceId, 'nowe-1')))
      assert.strictEqual(wpisy.length, 1, 'zdarzenie trafilo do historii')
    })

    it('cudzy slug w CIELE zadania nie tworzy zadania', async () => {
      await loginClient()

      const res = await tasksPOST(jsonReq('/api/clickup/tasks', { slug: portalB.slug, name: 'Podszywka' }))

      assert.strictEqual(res.status, 401)
      assert.strictEqual(clickup.createTask.mock.calls.length, 0)
    })
  })

  describe('GET /api/clickup/tasks/[taskId] (szczegoly)', () => {
    it('zadanie z WLASNEGO folderu i zakresu przechodzi', async () => {
      await loginClient()
      clickup.getTask.mockResolvedValue(zadanieWlasne())

      const res = await taskGET(req(`/api/clickup/tasks/task-1?slug=${portalA.slug}`), params('task-1'))
      const body = await res.json()

      assert.strictEqual(res.status, 200)
      assert.strictEqual(body.task.id, 'task-1')
      assert.strictEqual(body.attachments.length, 1)
    })

    it('zadanie z CUDZEGO folderu -> 403', async () => {
      await loginClient()
      clickup.getTask.mockResolvedValue({ ...zadanieWlasne(), folder: { id: 'folder-obcego-klienta' } })

      const res = await taskGET(req(`/api/clickup/tasks/task-x?slug=${portalA.slug}`), params('task-x'))

      assert.strictEqual(res.status, 403)
    })

    it('zadanie z wlasnego folderu, ale z listy POZA zakresem -> 403', async () => {
      await loginClient()
      clickup.getTask.mockResolvedValue({ ...zadanieWlasne(), list: { id: 'lista-nieudostepniona' } })

      // To jest luka z EFF: folder sie zgadza, a lista nigdy nie zostala do
      // portalu wybrana. Samo sprawdzenie folderu by to przepuscilo.
      const res = await taskGET(req(`/api/clickup/tasks/task-x?slug=${portalA.slug}`), params('task-x'))

      assert.strictEqual(res.status, 403)
    })

    it('szczegoly pobieraja zadanie RAZ, nie dwa razy', async () => {
      await loginClient()
      clickup.getTask.mockResolvedValue(zadanieWlasne())

      await taskGET(req(`/api/clickup/tasks/task-1?slug=${portalA.slug}`), params('task-1'))

      // Sprawdzenie przynaleznosci idzie na JUZ POBRANYM zadaniu. Drugie
      // pobranie byloby zmarnowanym wywolaniem wspolnego tokenu ClickUpa.
      assert.strictEqual(clickup.getTask.mock.calls.length, 1)
      assert.strictEqual(clickup.verifyTaskBelongsToFolder.mock.calls.length, 0)
    })
  })

  describe('PATCH /api/clickup/tasks/[taskId] (zmiana statusu)', () => {
    it('zmienia zadanie wlasnego portalu i unieważnia bufor folderu', async () => {
      await loginClient()
      clickup.verifyTaskBelongsToFolder.mockResolvedValue(true)
      clickup.updateTask.mockResolvedValue({ id: 'task-1', status: { status: 'w trakcie' } })

      const res = await taskPATCH(
        req(`/api/clickup/tasks/task-1?slug=${portalA.slug}`, {
          method: 'PATCH',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ status: 'w trakcie' }),
        }),
        params('task-1')
      )

      assert.strictEqual(res.status, 200)
      assert.deepStrictEqual(clickup.updateTask.mock.calls[0][1], { status: 'w trakcie' })
      // Bez tego karta wracalaby do starej kolumny po odswiezeniu.
      assert.strictEqual(cache.invalidateFolderTasks.mock.calls.length, 1)
    })

    it('cudze zadanie NIE jest modyfikowane', async () => {
      await loginClient()
      clickup.verifyTaskBelongsToFolder.mockResolvedValue(false)

      const res = await taskPATCH(
        req(`/api/clickup/tasks/obce?slug=${portalA.slug}`, {
          method: 'PATCH',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ status: 'zamkniete' }),
        }),
        params('obce')
      )

      assert.strictEqual(res.status, 403)
      assert.strictEqual(clickup.updateTask.mock.calls.length, 0)
    })

    it('pole spoza schematu odrzucone przed dotknieciem ClickUpa', async () => {
      await loginClient()
      clickup.verifyTaskBelongsToFolder.mockResolvedValue(true)

      const res = await taskPATCH(
        req(`/api/clickup/tasks/task-1?slug=${portalA.slug}`, {
          method: 'PATCH',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ assignees: ['ktos'] }),
        }),
        params('task-1')
      )

      assert.strictEqual(res.status, 400)
      assert.strictEqual(clickup.updateTask.mock.calls.length, 0)
    })
  })

  /**
   * KOMENTARZE — tu siedzial blad widoczny dla uzytkownika.
   *
   * `TaskDrawer` wolal te trase BEZ `?slug=`, a obejscie admina dziala wylacznie
   * dla nazwanego portalu. Admin ogladajacy portal klienta widzial pusty watek
   * i formularz odpowiedzi, ktory cicho odbijal sie o 401, podczas gdy zalaczniki
   * w tej samej szufladzie dzialaly, bo tamto wywolanie slug mialo.
   */
  describe('komentarze', () => {
    it('klient czyta TYLKO komentarze oznaczone jako publiczne', async () => {
      await loginClient()
      clickup.verifyTaskBelongsToFolder.mockResolvedValue(true)
      clickup.getTaskComments.mockResolvedValue([
        { id: 'c1', comment_text: '[P] widoczny dla klienta', date: '2000' },
        { id: 'c2', comment_text: 'wewnetrzna notatka zespolu', date: '1000' },
      ])

      const res = await commentsGET(
        req(`/api/clickup/tasks/task-1/comments?slug=${portalA.slug}`),
        params('task-1')
      )
      const body = await res.json()

      assert.strictEqual(res.status, 200)
      assert.strictEqual(body.comments.length, 1, 'notatka wewnetrzna NIE wychodzi do klienta')
      assert.strictEqual(body.comments[0].id, 'c1')
    })

    it('watek idzie od NAJSTARSZEGO', async () => {
      await loginClient()
      clickup.verifyTaskBelongsToFolder.mockResolvedValue(true)
      clickup.getTaskComments.mockResolvedValue([
        { id: 'nowy', comment_text: '[P] drugi', date: '2000' },
        { id: 'stary', comment_text: '[P] pierwszy', date: '1000' },
      ])

      const res = await commentsGET(
        req(`/api/clickup/tasks/task-1/comments?slug=${portalA.slug}`),
        params('task-1')
      )
      const body = await res.json()

      // Kolejnosc musi zgadzac sie z dopisywaniem na koniec po stronie UI,
      // inaczej swiezy komentarz laduje pod najstarszym i watek klamie.
      assert.deepStrictEqual(body.comments.map((c: { id: string }) => c.id), ['stary', 'nowy'])
    })

    it('komentarz klienta dostaje prefiks publiczny i podpis', async () => {
      await loginClient()
      clickup.verifyTaskBelongsToFolder.mockResolvedValue(true)
      clickup.addComment.mockResolvedValue({ id: 'c-nowy' })

      const res = await commentsPOST(
        jsonReq(`/api/clickup/tasks/task-1/comments?slug=${portalA.slug}`, { text: 'prosze o poprawke' }),
        params('task-1')
      )

      assert.strictEqual(res.status, 200)
      const tresc = clickup.addComment.mock.calls[0][1] as string
      assert.ok(tresc.startsWith('[P]'), 'bez prefiksu klient nie zobaczylby wlasnego komentarza')
      assert.ok(tresc.includes('prosze o poprawke'))
    })

    it('pusty komentarz nie leci do ClickUpa', async () => {
      await loginClient()
      clickup.verifyTaskBelongsToFolder.mockResolvedValue(true)

      const res = await commentsPOST(
        jsonReq(`/api/clickup/tasks/task-1/comments?slug=${portalA.slug}`, { text: '   ' }),
        params('task-1')
      )

      assert.strictEqual(res.status, 400)
      assert.strictEqual(clickup.addComment.mock.calls.length, 0)
    })

    it('komentarze zadania spoza portalu -> 403', async () => {
      await loginClient()
      clickup.verifyTaskBelongsToFolder.mockResolvedValue(false)

      const res = await commentsGET(
        req(`/api/clickup/tasks/obce/comments?slug=${portalA.slug}`),
        params('obce')
      )

      assert.strictEqual(res.status, 403)
      assert.strictEqual(clickup.getTaskComments.mock.calls.length, 0)
    })

    it.skipIf(!process.env.ADMIN_SECRET)(
      'REGRESJA: admin ze slugiem CZYTA komentarze, bez sluga dostaje 400',
      async () => {
        loginAdmin()
        clickup.verifyTaskBelongsToFolder.mockResolvedValue(true)
        clickup.getTaskComments.mockResolvedValue([{ id: 'c1', comment_text: '[P] tresc', date: '1' }])

        const zeSlugiem = await commentsGET(
          req(`/api/clickup/tasks/task-1/comments?slug=${portalA.slug}`),
          params('task-1')
        )
        assert.strictEqual(zeSlugiem.status, 200, 'admin ze slugiem widzi watek')
        assert.strictEqual((await zeSlugiem.json()).comments.length, 1)

        // Tak wygladal blad: to samo ciasteczko, brak sluga. Wczesniej konczylo
        // sie cichym 401 i pustym watkiem, teraz mowi wprost, czego brakuje.
        const bezSluga = await commentsGET(req('/api/clickup/tasks/task-1/comments'), params('task-1'))
        assert.strictEqual(bezSluga.status, 400)
      }
    )

    it.skipIf(!process.env.ADMIN_SECRET)('admin ze slugiem MOZE odpowiedziec klientowi', async () => {
      loginAdmin()
      clickup.verifyTaskBelongsToFolder.mockResolvedValue(true)
      clickup.addComment.mockResolvedValue({ id: 'c-admin' })

      const res = await commentsPOST(
        jsonReq(`/api/clickup/tasks/task-1/comments?slug=${portalA.slug}`, { text: 'juz sie tym zajmujemy' }),
        params('task-1')
      )

      assert.strictEqual(res.status, 200)
      assert.strictEqual(clickup.addComment.mock.calls.length, 1)
    })
  })

  describe('PUT/DELETE /api/clickup/tasks/[taskId]/comments/[commentId] (edycja/usuniecie wlasnego)', () => {
    const commentParams = (taskId: string, commentId: string) => ({
      params: Promise.resolve({ taskId, commentId }),
    })
    const putReq = (url: string, body: unknown) =>
      req(url, { method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) })
    const deleteReq = (url: string) => req(url, { method: 'DELETE' })

    /** Dodaje komentarz jako userA i zwraca jego id — ten sam sposob, w jaki portal go tworzy. */
    async function wlasnyKomentarz(): Promise<string> {
      await loginClient()
      clickup.verifyTaskBelongsToFolder.mockResolvedValue(true)
      clickup.addComment.mockResolvedValue({ id: 'c-wlasny' })
      await commentsPOST(
        jsonReq(`/api/clickup/tasks/task-1/comments?slug=${portalA.slug}`, { text: 'oryginal' }),
        params('task-1')
      )
      return 'c-wlasny'
    }

    it('wlasciciel MOZE edytowac wlasny komentarz, z zachowaniem prefiksu i podpisu', async () => {
      const commentId = await wlasnyKomentarz()

      const res = await commentPUT(
        putReq(`/api/clickup/tasks/task-1/comments/${commentId}?slug=${portalA.slug}`, { text: 'poprawiony' }),
        commentParams('task-1', commentId)
      )

      assert.strictEqual(res.status, 200)
      assert.strictEqual(clickup.updateComment.mock.calls.length, 1)
      const [id, tresc] = clickup.updateComment.mock.calls[0] as [string, string]
      assert.strictEqual(id, commentId)
      assert.ok(tresc.startsWith('[P]'), 'edycja nie moze zgubic prefiksu publicznego')
      assert.ok(tresc.includes('poprawiony'))
    })

    it('wlasciciel MOZE usunac wlasny komentarz', async () => {
      const commentId = await wlasnyKomentarz()

      const res = await commentDELETE(
        deleteReq(`/api/clickup/tasks/task-1/comments/${commentId}?slug=${portalA.slug}`),
        commentParams('task-1', commentId)
      )

      assert.strictEqual(res.status, 200)
      assert.deepStrictEqual(clickup.deleteComment.mock.calls[0], [commentId])
    })

    it('REGRESJA: inny uzytkownik TEGO SAMEGO portalu nie edytuje ani nie usunie cudzego komentarza', async () => {
      const commentId = await wlasnyKomentarz()
      const userB = await createTestUser(portalA.id, `inny-${portalA.slug}@example.com`)
      await setSessionCookie(await createSession(userB, '127.0.0.1', 'vitest'))

      const edycja = await commentPUT(
        putReq(`/api/clickup/tasks/task-1/comments/${commentId}?slug=${portalA.slug}`, { text: 'podmiana' }),
        commentParams('task-1', commentId)
      )
      assert.strictEqual(edycja.status, 403)
      assert.strictEqual(clickup.updateComment.mock.calls.length, 0)

      const usuniecie = await commentDELETE(
        deleteReq(`/api/clickup/tasks/task-1/comments/${commentId}?slug=${portalA.slug}`),
        commentParams('task-1', commentId)
      )
      assert.strictEqual(usuniecie.status, 403)
      assert.strictEqual(clickup.deleteComment.mock.calls.length, 0)
    })

    it('pusta tresc edycji -> 400, ClickUp nietkniety', async () => {
      const commentId = await wlasnyKomentarz()

      const res = await commentPUT(
        putReq(`/api/clickup/tasks/task-1/comments/${commentId}?slug=${portalA.slug}`, { text: '   ' }),
        commentParams('task-1', commentId)
      )

      assert.strictEqual(res.status, 400)
      assert.strictEqual(clickup.updateComment.mock.calls.length, 0)
    })

    it('zadanie spoza portalu -> 403, tak samo jak przy odczycie', async () => {
      const commentId = await wlasnyKomentarz()
      clickup.verifyTaskBelongsToFolder.mockResolvedValue(false)

      const res = await commentDELETE(
        deleteReq(`/api/clickup/tasks/obce/comments/${commentId}?slug=${portalA.slug}`),
        commentParams('obce', commentId)
      )

      assert.strictEqual(res.status, 403)
      assert.strictEqual(clickup.deleteComment.mock.calls.length, 0)
    })
  })

  /**
   * WZMIANKI O ZADANIACH w komentarzach.
   *
   * Zgloszenie z 2026-08-24: wzmianka docierala do klienta jako goly
   * identyfikator `869enjjkr`. Naprawa dokleja nazwe, ale nazwa zadania jest
   * DANA KLIENTA, wiec wolno ja pokazac tylko wtedy, gdy zadanie nalezy do
   * TEGO portalu. Te testy sprawdzaja jedno i drugie na prawdziwej bazie,
   * przez prawdziwa trase, bo tylko tak widac, ze brama zakresu naprawde
   * stoi przed dokleceniem nazwy.
   */
  describe('wzmianki o zadaniach w komentarzach', () => {
    /** Komentarz publiczny, ktory wspomina zadanie o podanym identyfikatorze. */
    const komentarzZeWzmianka = (taskId: string) => [
      {
        id: 'c-wzmianka',
        date: '1000',
        comment_text: `[P] poprawione w ${taskId}`,
        comment: [
          { text: '[P] poprawione w ' },
          { text: taskId, type: 'task_mention', task_mention: { task_id: taskId } },
        ],
      },
    ]

    const wzmianka = (body: { comments: Array<{ blocks?: unknown[] }> }) => {
      const blocks = (body.comments[0]?.blocks ?? []) as Array<{ inline?: Array<Record<string, unknown>> }>
      return blocks.flatMap(b => b.inline ?? []).find(n => n.kind === 'taskMention')
    }

    it('zadanie Z PORTALU dostaje nazwe z indeksu, bez pytania ClickUpa', async () => {
      await loginClient()
      await insertIndexedTask({
        portalId: portalA.id,
        clickupTaskId: 'zad-wspomniane',
        name: 'Drobne poprawki',
        searchText: 'drobne poprawki',
        dateCreated: 1,
      })
      clickup.verifyTaskBelongsToFolder.mockResolvedValue(true)
      clickup.getTaskComments.mockResolvedValue(komentarzZeWzmianka('zad-wspomniane'))

      const res = await commentsGET(
        req(`/api/clickup/tasks/task-1/comments?slug=${portalA.slug}`),
        params('task-1')
      )
      const body = await res.json()

      assert.deepStrictEqual(wzmianka(body), {
        kind: 'taskMention',
        taskId: 'zad-wspomniane',
        name: 'Drobne poprawki',
      })
      // Indeks wystarczyl. Gdyby trasa i tak pytala ClickUpa, kazdy komentarz
      // ze wzmianka kosztowalby dodatkowy strzal do sieci.
      assert.strictEqual(clickup.getTask.mock.calls.length, 0)
    })

    it('WYCIEK: zadanie z INNEGO portalu nie dostaje nazwy', async () => {
      await loginClient()
      await insertIndexedTask({
        portalId: portalB.id,
        clickupTaskId: 'zad-obcego-klienta',
        name: 'Tajny projekt konkurencji',
        searchText: 'tajny projekt konkurencji',
        dateCreated: 1,
      })
      clickup.verifyTaskBelongsToFolder.mockResolvedValue(true)
      clickup.getTaskComments.mockResolvedValue(komentarzZeWzmianka('zad-obcego-klienta'))
      // Indeks portalu A go nie zna, wiec trasa pyta ClickUpa — a tam zadanie
      // siedzi w folderze DRUGIEGO portalu.
      clickup.getTask.mockResolvedValue({
        id: 'zad-obcego-klienta',
        name: 'Tajny projekt konkurencji',
        folder: { id: `fake-${portalB.slug}` },
        list: { id: 'lista-obca' },
      })

      const res = await commentsGET(
        req(`/api/clickup/tasks/task-1/comments?slug=${portalA.slug}`),
        params('task-1')
      )
      const body = await res.json()

      assert.deepStrictEqual(wzmianka(body), { kind: 'taskMention', taskId: 'zad-obcego-klienta' })
      // Najwazniejsza asercja: nazwa nie pojawia sie NIGDZIE w odpowiedzi,
      // takze w polach, o ktorych nie pomyslelismy.
      assert.ok(
        !JSON.stringify(body).includes('Tajny projekt'),
        'WYCIEK nazwy zadania innego klienta'
      )
    })

    it('zadanie z portalu, ale poza ZAWEZONYM zakresem list, tez bez nazwy', async () => {
      await loginClient()
      clickup.verifyTaskBelongsToFolder.mockResolvedValue(true)
      clickup.getTaskComments.mockResolvedValue(komentarzZeWzmianka('zad-poza-zakresem'))
      // Wlasciwy folder, ale lista NIE jest w zakresie portalu A.
      clickup.getTask.mockResolvedValue({
        id: 'zad-poza-zakresem',
        name: 'Zadanie z listy poza zakresem',
        folder: { id: `fake-${portalA.slug}` },
        list: { id: 'lista-poza-zakresem' },
      })

      const res = await commentsGET(
        req(`/api/clickup/tasks/task-1/comments?slug=${portalA.slug}`),
        params('task-1')
      )
      const body = await res.json()

      assert.deepStrictEqual(wzmianka(body), { kind: 'taskMention', taskId: 'zad-poza-zakresem' })
      assert.ok(!JSON.stringify(body).includes('poza zakresem"'), 'nazwa nie ma prawa wyjsc')
    })

    it('zadanie jeszcze NIEINDEKSOWANE dostaje nazwe z ClickUpa', async () => {
      await loginClient()
      clickup.verifyTaskBelongsToFolder.mockResolvedValue(true)
      clickup.getTaskComments.mockResolvedValue(komentarzZeWzmianka('zad-swieze'))
      clickup.getTask.mockResolvedValue({
        id: 'zad-swieze',
        name: 'Zadanie zalozone przed chwila',
        folder: { id: `fake-${portalA.slug}` },
        list: { id: 'lista-portalu' },
      })

      const res = await commentsGET(
        req(`/api/clickup/tasks/task-1/comments?slug=${portalA.slug}`),
        params('task-1')
      )
      const body = await res.json()

      assert.deepStrictEqual(wzmianka(body), {
        kind: 'taskMention',
        taskId: 'zad-swieze',
        name: 'Zadanie zalozone przed chwila',
      })
    })

    it('awaria ClickUpa przy wzmiance nie zabiera klientowi komentarza', async () => {
      await loginClient()
      clickup.verifyTaskBelongsToFolder.mockResolvedValue(true)
      clickup.getTaskComments.mockResolvedValue(komentarzZeWzmianka('zad-nieznane'))
      clickup.getTask.mockRejectedValue(new Error('ClickUp 500'))

      const res = await commentsGET(
        req(`/api/clickup/tasks/task-1/comments?slug=${portalA.slug}`),
        params('task-1')
      )
      const body = await res.json()

      assert.strictEqual(res.status, 200)
      assert.strictEqual(body.comments.length, 1, 'komentarz zostaje, tylko bez nazwy zadania')
      assert.deepStrictEqual(wzmianka(body), { kind: 'taskMention', taskId: 'zad-nieznane' })
    })

    it('obrazek z komentarza dociera jako blok obrazka, nie jako nazwa pliku', async () => {
      await loginClient()
      clickup.verifyTaskBelongsToFolder.mockResolvedValue(true)
      clickup.getTaskComments.mockResolvedValue([
        {
          id: 'c-obrazek',
          date: '1000',
          comment_text: '[P] zrzut\nimage.png',
          comment: [
            { text: '[P] zrzut' },
            { text: '\n', attributes: { 'block-id': 'b1' } },
            {
              text: 'image.png',
              type: 'image',
              image: { url: 'https://cdn.clickup.test/zrzut.png', title: 'zrzut.png', width: 940, height: 842 },
            },
          ],
        },
      ])

      const res = await commentsGET(
        req(`/api/clickup/tasks/task-1/comments?slug=${portalA.slug}`),
        params('task-1')
      )
      const body = await res.json()

      assert.deepStrictEqual(body.comments[0].blocks, [
        { kind: 'paragraph', inline: [{ kind: 'text', text: 'zrzut' }] },
        {
          kind: 'image',
          url: 'https://cdn.clickup.test/zrzut.png',
          name: 'zrzut.png',
          width: 940,
          height: 842,
        },
      ])
    })

    it('znacznik [P] nie wychodzi w blokach, tak samo jak nie wychodzi w tekscie', async () => {
      await loginClient()
      clickup.verifyTaskBelongsToFolder.mockResolvedValue(true)
      clickup.getTaskComments.mockResolvedValue([
        {
          id: 'c-znacznik',
          date: '1000',
          comment_text: '[P] gotowe',
          comment: [{ text: '[P] gotowe' }],
        },
      ])

      const res = await commentsGET(
        req(`/api/clickup/tasks/task-1/comments?slug=${portalA.slug}`),
        params('task-1')
      )
      const body = await res.json()

      assert.ok(!JSON.stringify(body.comments[0].blocks).includes('[P]'), 'znacznik zostal w blokach')
    })
  })
})
