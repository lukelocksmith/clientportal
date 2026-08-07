import { describe, it, beforeAll, afterAll, beforeEach, vi } from 'vitest'
import assert from 'node:assert'
import { createHmac } from 'node:crypto'
import { eq } from 'drizzle-orm'
import { db } from '@/lib/db'
import { taskStatusHistory } from '@/lib/db/schema'
import {
  isDbReachable,
  createTestPortal,
  dropTestPortal,
  createTestUserWithPassword,
  createTestList,
} from './helpers'

/**
 * HISTORIA ZMIAN STATUSU — oba źródła, na prawdziwej bazie.
 *
 * Zmiana statusu przychodzi dwiema drogami i każda sama w sobie daje historię
 * z dziurami:
 *
 *   webhook  zespół zmienił status w ClickUpie — to WIĘKSZOŚĆ ruchu
 *   portal   klient przeciągnął kartę na tablicy
 *
 * Dlatego oba muszą pisać do tej samej tabeli, a testy sprawdzają oba.
 *
 * Najważniejsza rzecz poza samym zapisem: zapis jest BEST-EFFORT i NIE MOŻE
 * przewrócić operacji, którą opisuje. Klient, któremu nie udało się przeciągnąć
 * karty, bo padł dziennik, miałby awarię z powodu funkcji, o której istnieniu
 * nie wie.
 *
 *   docker start cp-test-pg && npm run test:integration
 */
const SEKRET = 'sekret-historii-statusow'

const { poprzedniSekret, cookieJar, clickup, taskIndex, cache } = vi.hoisted(() => {
  const poprzedni = process.env.CLICKUP_WEBHOOK_SECRET
  process.env.CLICKUP_WEBHOOK_SECRET = 'sekret-historii-statusow'
  return {
    poprzedniSekret: poprzedni,
    cookieJar: new Map<string, string>(),
    clickup: { getTask: vi.fn(), updateTask: vi.fn(), verifyTaskBelongsToFolder: vi.fn() },
    taskIndex: { indexSingleTask: vi.fn(), removeTaskFromIndex: vi.fn() },
    cache: { invalidateFolderTasks: vi.fn() },
  }
})

vi.mock('next/headers', () => ({
  cookies: vi.fn(async () => ({
    get: (name: string) => (cookieJar.has(name) ? { value: cookieJar.get(name)! } : undefined),
    set: (name: string, value: string) => { cookieJar.set(name, value) },
    delete: (name: string) => { cookieJar.delete(name) },
  })),
}))
vi.mock('@/lib/clickup', () => clickup)
vi.mock('@/lib/taskIndex', () => taskIndex)
vi.mock('@/lib/clickupCache', () => ({ ...cache, folderTasksTag: (id: string) => `f-${id}` }))
vi.mock('next/cache', () => ({ revalidatePath: vi.fn(), revalidateTag: vi.fn() }))

import { NextRequest } from 'next/server'
import { createSession, setSessionCookie } from '@/lib/auth'
import { listStatusHistory } from '@/lib/statusHistory'
import { POST as webhookPOST } from '@/app/api/webhooks/clickup/route'
import { PATCH as taskPATCH } from '@/app/api/clickup/tasks/[taskId]/route'

const dbUp = await isDbReachable()

function podpisane(payload: unknown): NextRequest {
  const body = JSON.stringify(payload)
  return new NextRequest('http://localhost/api/webhooks/clickup', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'x-signature': createHmac('sha256', SEKRET).update(body).digest('hex'),
    },
    body,
  } as ConstructorParameters<typeof NextRequest>[1])
}

describe.skipIf(!dbUp)('historia zmian statusu na prawdziwej bazie', () => {
  let portalA: { id: string; slug: string }
  let userA: string

  beforeAll(async () => {
    portalA = await createTestPortal('hist')
    userA = await createTestUserWithPassword({
      portalId: portalA.id,
      email: `hist-${Math.random().toString(36).slice(2, 8)}@example.com`,
      password: 'jakies-haslo-1',
      name: 'Anna Klient',
    })
    await createTestList({ portalId: portalA.id, clickupListId: 'lista-h', isDefault: true })
  })

  afterAll(async () => {
    if (portalA) await dropTestPortal(portalA.id)
    if (poprzedniSekret === undefined) delete process.env.CLICKUP_WEBHOOK_SECRET
    else process.env.CLICKUP_WEBHOOK_SECRET = poprzedniSekret
  })

  beforeEach(async () => {
    cookieJar.clear()
    vi.clearAllMocks()
    taskIndex.indexSingleTask.mockResolvedValue(true)
    taskIndex.removeTaskFromIndex.mockResolvedValue(undefined)
    cache.invalidateFolderTasks.mockResolvedValue(undefined)
    await db.delete(taskStatusHistory).where(eq(taskStatusHistory.portalId, portalA.id))
  })

  const wpisy = () => listStatusHistory({ portalId: portalA.id })

  describe('zmiana zrobiona przez zespół w ClickUpie (webhook)', () => {
    it('zapisuje stan poprzedni, nowy, autora i czas ze ŹRÓDŁA', async () => {
      clickup.getTask.mockResolvedValue({
        id: 'z-1', name: 'Poprawić formularz', folder: { id: `fake-${portalA.slug}` },
      })

      await webhookPOST(podpisane({
        event: 'taskStatusUpdated',
        task_id: 'z-1',
        history_items: [{
          field: 'status',
          date: '1786000000000',
          before: { status: 'do zrobienia' },
          after: { status: 'w trakcie' },
          user: { username: 'Filip', email: 'filip.g@important.is' },
        }],
      }))

      const [wpis] = await wpisy()
      assert.ok(wpis, 'zmiana zapisana')
      assert.strictEqual(wpis.fromStatus, 'do zrobienia')
      assert.strictEqual(wpis.toStatus, 'w trakcie')
      assert.strictEqual(wpis.actorLabel, 'Filip')
      assert.strictEqual(wpis.source, 'webhook')
      // Czas WEBHOOKA, nie czas zapisu: webhook bywa opóźniony, a historia ma
      // opisywać, kiedy rzecz się stała.
      assert.strictEqual(wpis.changedAt.getTime(), 1786000000000)
      // Nazwa zadania z ClickUpa, bo payload jej nie zawiera.
      assert.strictEqual(wpis.taskName, 'Poprawić formularz')
    })

    it('zdarzenie BEZ zmiany statusu nic nie zapisuje', async () => {
      clickup.getTask.mockResolvedValue({ id: 'z-2', name: 'X', folder: { id: `fake-${portalA.slug}` } })

      await webhookPOST(podpisane({
        event: 'taskUpdated',
        task_id: 'z-2',
        history_items: [{ field: 'description' }],
      }))

      // `taskUpdated` przychodzi także przy zmianie opisu czy priorytetu.
      assert.strictEqual((await wpisy()).length, 0)
    })

    it('zadanie SPOZA folderów klientów nic nie zapisuje', async () => {
      clickup.getTask.mockResolvedValue({
        id: 'z-3', name: 'Wewnętrzne', folder: { id: 'folder-agencji' },
      })

      await webhookPOST(podpisane({
        event: 'taskStatusUpdated',
        task_id: 'z-3',
        history_items: [{ field: 'status', after: { status: 'zrobione' } }],
      }))

      // Wiersz bez projektu byłby historią niczyją.
      assert.strictEqual((await wpisy()).length, 0)
    })

    it('brak stanu poprzedniego zapisuje null, a nie odrzuca zdarzenia', async () => {
      clickup.getTask.mockResolvedValue({ id: 'z-4', name: 'Nowe', folder: { id: `fake-${portalA.slug}` } })

      await webhookPOST(podpisane({
        event: 'taskStatusUpdated',
        task_id: 'z-4',
        history_items: [{ field: 'status', after: { status: 'do zrobienia' } }],
      }))

      const [wpis] = await wpisy()
      // Odrzucenie byłoby gorsze: stracilibyśmy informację, że zadanie
      // W OGÓLE zmieniło status.
      assert.strictEqual(wpis.fromStatus, null)
      assert.strictEqual(wpis.toStatus, 'do zrobienia')
    })
  })

  describe('zmiana zrobiona przez klienta w portalu', () => {
    async function zaloguj() {
      await setSessionCookie(await createSession(userA, '127.0.0.1', 'vitest'))
    }

    const patch = (taskId: string, body: unknown) =>
      taskPATCH(
        new NextRequest(`http://localhost/api/clickup/tasks/${taskId}?slug=${portalA.slug}`, {
          method: 'PATCH',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(body),
        } as ConstructorParameters<typeof NextRequest>[1]),
        { params: Promise.resolve({ taskId }) }
      )

    it('przeciągnięcie karty zapisuje zmianę podpisaną KLIENTEM', async () => {
      await zaloguj()
      clickup.verifyTaskBelongsToFolder.mockResolvedValue(true)
      clickup.getTask.mockResolvedValue({ id: 'z-5', name: 'Karta', status: { status: 'do zrobienia' } })
      clickup.updateTask.mockResolvedValue({ id: 'z-5', name: 'Karta' })

      const res = await patch('z-5', { status: 'w trakcie' })
      assert.strictEqual(res.status, 200)

      const [wpis] = await wpisy()
      assert.strictEqual(wpis.fromStatus, 'do zrobienia')
      assert.strictEqual(wpis.toStatus, 'w trakcie')
      assert.strictEqual(wpis.source, 'portal')
      // Podpis klienta, nie konta serwisowego agencji: webhook z ClickUpa
      // przyjdzie chwilę później i podpisałby tę zmianę nami.
      assert.strictEqual(wpis.actorLabel, 'Anna Klient')
    })

    it('zmiana INNEGO pola niż status nic nie zapisuje i nie pyta ClickUpa o stan', async () => {
      await zaloguj()
      clickup.verifyTaskBelongsToFolder.mockResolvedValue(true)
      clickup.updateTask.mockResolvedValue({ id: 'z-6', name: 'Nowa nazwa' })

      await patch('z-6', { name: 'Nowa nazwa' })

      assert.strictEqual((await wpisy()).length, 0)
      // Pobranie stanu sprzed zmiany byłoby zmarnowanym wywołaniem wspólnego
      // tokenu ClickUpa.
      assert.strictEqual(clickup.getTask.mock.calls.length, 0)
    })

    it('PADNIĘTY zapis historii NIE przewraca zmiany statusu', async () => {
      await zaloguj()
      clickup.verifyTaskBelongsToFolder.mockResolvedValue(true)
      // Nazwa dłuższa niż kolumna? Nie — wymuszamy błąd inaczej: zadanie
      // wskazuje portal, który zaraz przestanie istnieć w kluczu obcym.
      clickup.getTask.mockResolvedValue({ id: 'z-7', name: 'X', status: { status: 'a' } })
      clickup.updateTask.mockResolvedValue({ id: 'z-7', name: 'X' })
      const errorSpy = vi.spyOn(console, 'error').mockImplementation(() => {})
      const insertSpy = vi.spyOn(db, 'insert').mockImplementationOnce(() => {
        throw new Error('baza niedostępna')
      })

      const res = await patch('z-7', { status: 'b' })

      // To jest istota: klient przeciągnął kartę, ClickUp ją przyjął, więc
      // odpowiedź MUSI być pozytywna, choćby dziennik padł.
      assert.strictEqual(res.status, 200)
      insertSpy.mockRestore()
      errorSpy.mockRestore()
    })
  })

  describe('odczyt historii', () => {
    it('zwraca zmiany od NAJNOWSZEJ', async () => {
      clickup.getTask.mockResolvedValue({ id: 'z-8', name: 'Kolejność', folder: { id: `fake-${portalA.slug}` } })

      for (const [kiedy, status] of [['1786000000000', 'pierwszy'], ['1786000900000', 'drugi']] as const) {
        await webhookPOST(podpisane({
          event: 'taskStatusUpdated',
          task_id: 'z-8',
          history_items: [{ field: 'status', date: kiedy, after: { status } }],
        }))
      }

      const lista = await wpisy()
      assert.deepStrictEqual(lista.map(w => w.toStatus), ['drugi', 'pierwszy'])
    })

    it('da się zawęzić do JEDNEGO zadania', async () => {
      clickup.getTask.mockImplementation(async (id: string) => ({
        id, name: `Zadanie ${id}`, folder: { id: `fake-${portalA.slug}` },
      }))

      for (const id of ['z-9', 'z-10']) {
        await webhookPOST(podpisane({
          event: 'taskStatusUpdated',
          task_id: id,
          history_items: [{ field: 'status', after: { status: 'w trakcie' } }],
        }))
      }

      const jedno = await listStatusHistory({ portalId: portalA.id, clickupTaskId: 'z-9' })
      assert.strictEqual(jedno.length, 1)
      assert.strictEqual(jedno[0].clickupTaskId, 'z-9')
    })

    it('historia INNEGO projektu nie wchodzi do wyniku', async () => {
      const portalB = await createTestPortal('hist-b')
      try {
        clickup.getTask.mockResolvedValue({ id: 'z-11', name: 'Cudze', folder: { id: `fake-${portalB.slug}` } })
        await webhookPOST(podpisane({
          event: 'taskStatusUpdated',
          task_id: 'z-11',
          history_items: [{ field: 'status', after: { status: 'w trakcie' } }],
        }))

        // Zmiana trafiła do portalu B, więc w historii portalu A ma jej nie być.
        assert.strictEqual((await wpisy()).length, 0)
        assert.strictEqual((await listStatusHistory({ portalId: portalB.id })).length, 1)
      } finally {
        await dropTestPortal(portalB.id)
      }
    })
  })
})
