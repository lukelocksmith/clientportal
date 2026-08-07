import { describe, it, beforeAll, afterAll, beforeEach, vi } from 'vitest'
import assert from 'node:assert'
import { and, eq } from 'drizzle-orm'
import { db } from '@/lib/db'
import { auditLog, panicAlerts, notifications } from '@/lib/db/schema'
import {
  isDbReachable,
  createTestPortal,
  dropTestPortal,
  createTestUser,
  createTestList,
} from './helpers'

/**
 * Pozostale trasy portalu na prawdziwej bazie: alarm, powiadomienia, pomysly,
 * zalaczniki.
 *
 * Zasada ta sama, co w routes.clickupTasks.test.ts: podstawione jest WYLACZNIE
 * wyjscie na swiat (ClickUp, poczta, Discord), reszta prawdziwa. Test ma
 * odpowiadac na pytanie "czy klient A dosiegnie danych klienta B" i "czy to,
 * co obiecuje interfejs, faktycznie sie dzieje", a nie na pytanie, czy atrapa
 * oddala to, co jej kazano.
 *
 * Alarm jest tu najwazniejszy: jest to jedyna funkcja portalu, przy ktorej cisza
 * jest gorsza od bledu. Klient wciska czerwony przycisk, bo cos plonie.
 *
 *   docker start cp-test-pg && npm run test:integration
 */
const { cookieJar, clickup, mailer, cache, fetchMock } = vi.hoisted(() => ({
  cookieJar: new Map<string, string>(),
  clickup: {
    createTask: vi.fn(),
    addTaskAttachment: vi.fn(),
    verifyTaskBelongsToFolder: vi.fn(),
    getTask: vi.fn(),
  },
  // Bez wbudowanej implementacji, zeby TS nie zawezil typu wywolan do
  // sygnatury bezargumentowej — inaczej `mock.calls[0][0]` nie istnieje.
  mailer: { sendMail: vi.fn() },
  cache: { invalidateFolderTasks: vi.fn() },
  fetchMock: vi.fn(),
}))

vi.mock('next/headers', () => ({
  cookies: vi.fn(async () => ({
    get: (name: string) => (cookieJar.has(name) ? { value: cookieJar.get(name)! } : undefined),
    set: (name: string, value: string) => { cookieJar.set(name, value) },
    delete: (name: string) => { cookieJar.delete(name) },
  })),
}))
vi.mock('@/lib/clickup', () => clickup)
vi.mock('@/lib/mailer', () => mailer)
vi.mock('@/lib/clickupCache', () => ({ ...cache, folderTasksTag: (id: string) => `folder-${id}` }))

import { NextRequest } from 'next/server'
import { createSession, setSessionCookie } from '@/lib/auth'
import { createNotifications } from '@/lib/notificationStore'
import { POST as panicPOST } from '@/app/api/panic/route'
import { GET as notifGET, POST as notifPOST, DELETE as notifDELETE } from '@/app/api/notifications/route'
import { POST as ideasPOST } from '@/app/api/portal-ideas/route'
import { POST as attachPOST } from '@/app/api/clickup/tasks/[taskId]/attachments/route'

const dbUp = await isDbReachable()

const jsonReq = (url: string, body: unknown) =>
  new NextRequest(`http://localhost${url}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  } as ConstructorParameters<typeof NextRequest>[1])

describe.skipIf(!dbUp)('trasy portalu na prawdziwej bazie', () => {
  let portalA: { id: string; slug: string }
  let portalB: { id: string; slug: string }
  let userA: string
  let userB: string

  beforeAll(async () => {
    portalA = await createTestPortal('rp-a')
    portalB = await createTestPortal('rp-b')
    userA = await createTestUser(portalA.id, `user-${portalA.slug}@example.com`)
    userB = await createTestUser(portalB.id, `user-${portalB.slug}@example.com`)
    await createTestList({ portalId: portalA.id, clickupListId: 'lista-a', isDefault: true })
  })

  afterAll(async () => {
    if (portalA) await dropTestPortal(portalA.id)
    if (portalB) await dropTestPortal(portalB.id)
  })

  beforeEach(() => {
    cookieJar.clear()
    vi.clearAllMocks()
    mailer.sendMail.mockResolvedValue({ ok: true })
    cache.invalidateFolderTasks.mockResolvedValue(undefined)
    fetchMock.mockResolvedValue(new Response('ok'))
    vi.stubGlobal('fetch', fetchMock)
  })

  async function loginAs(userId: string): Promise<void> {
    await setSessionCookie(await createSession(userId, '127.0.0.1', 'vitest'))
  }

  describe('POST /api/panic (alarm)', () => {
    it('zapisuje alarm, powiadamia i zaklada zadanie', async () => {
      await loginAs(userA)
      clickup.createTask.mockResolvedValue({ id: 'alarm-task', name: 'ALARM', url: 'https://cu.test/a' })

      const res = await panicPOST(jsonReq('/api/panic', { slug: portalA.slug, message: 'strona nie dziala' }))

      assert.strictEqual(res.status, 200)

      // 1. Slad u nas. To jest jedyne zrodlo, ktore nie zalezy od cudzych uslug.
      const alarmy = await db.select().from(panicAlerts).where(eq(panicAlerts.portalId, portalA.id))
      assert.strictEqual(alarmy.length, 1)
      assert.strictEqual(alarmy[0].message, 'strona nie dziala')
      assert.strictEqual(alarmy[0].userId, userA, 'wiadomo KTO wcisnal, nie tylko ktory portal')
      assert.ok(alarmy[0].ackToken, 'token potwierdzenia powstal')

      // 2. Powiadomienie mailem, przez wspolny mailer, wiec z wpisem w rejestrze.
      assert.ok(mailer.sendMail.mock.calls.length >= 1, 'mail alarmowy poszedl')
      assert.strictEqual(mailer.sendMail.mock.calls[0][0].kind, 'panic')

      // 3. Zadanie na tablicy, zeby alarm nie zniknal w skrzynce.
      assert.strictEqual(clickup.createTask.mock.calls.length, 1)
      assert.strictEqual(clickup.createTask.mock.calls[0][1].priority, 1)
    })

    it('padniety ClickUp NIE psuje alarmu, bo powiadomienie jest wazniejsze', async () => {
      await loginAs(userA)
      clickup.createTask.mockRejectedValue(new Error('ClickUp nie odpowiada'))
      const errorSpy = vi.spyOn(console, 'error').mockImplementation(() => {})

      const res = await panicPOST(jsonReq('/api/panic', { slug: portalA.slug, message: 'pilne' }))

      // Klient nie moze dostac bledu przy alarmie, skoro mail juz poszedl.
      assert.strictEqual(res.status, 200)
      assert.ok(mailer.sendMail.mock.calls.length >= 1)
      errorSpy.mockRestore()
    })

    it('klient portalu A nie wysle alarmu W IMIENIU portalu B', async () => {
      await loginAs(userA)

      const res = await panicPOST(jsonReq('/api/panic', { slug: portalB.slug, message: 'podszywka' }))

      assert.strictEqual(res.status, 401)
      const alarmyB = await db.select().from(panicAlerts).where(eq(panicAlerts.portalId, portalB.id))
      assert.strictEqual(alarmyB.length, 0)
      assert.strictEqual(mailer.sendMail.mock.calls.length, 0, 'zaden mail nie poszedl')
    })

    it('pusta tresc alarmu nie powiadamia nikogo', async () => {
      await loginAs(userA)

      const res = await panicPOST(jsonReq('/api/panic', { slug: portalA.slug, message: '   ' }))

      assert.strictEqual(res.status, 400)
      assert.strictEqual(mailer.sendMail.mock.calls.length, 0)
    })
  })

  describe('powiadomienia (dzwonek)', () => {
    it('klient widzi TYLKO swoje powiadomienia, nie cudze', async () => {
      await createNotifications([
        { userId: userA, portalId: portalA.id, kind: 'comment', clickupTaskId: 'z-1', taskName: 'Moje' },
        { userId: userB, portalId: portalB.id, kind: 'comment', clickupTaskId: 'z-2', taskName: 'Cudze' },
      ])
      await loginAs(userA)

      const res = await notifGET(new NextRequest(`http://localhost/api/notifications?slug=${portalA.slug}`))
      const body = await res.json()

      assert.strictEqual(res.status, 200)
      assert.strictEqual(body.items.length, 1)
      assert.strictEqual(body.items[0].taskName, 'Moje')
      assert.strictEqual(body.unread, 1)
    })

    it('oznaczenie jako przeczytane dziala i zeruje licznik', async () => {
      await createNotifications([
        { userId: userA, portalId: portalA.id, kind: 'comment', clickupTaskId: 'z-3', taskName: 'Do odczytu' },
      ])
      await loginAs(userA)

      const res = await notifPOST(jsonReq('/api/notifications', { slug: portalA.slug }))
      const body = await res.json()

      assert.strictEqual(res.status, 200)
      assert.strictEqual(body.unread, 0)

      const wiersze = await db.select().from(notifications).where(eq(notifications.userId, userA))
      assert.ok(wiersze.every(n => n.readAt != null), 'znacznik odczytu zapisany w bazie')
    })

    it('oznaczenie POJEDYNCZEGO zmniejsza licznik o jeden, nie zeruje', async () => {
      const [a, b] = await Promise.all([
        createNotifications([{ userId: userA, portalId: portalA.id, kind: 'comment', clickupTaskId: 'p-1', taskName: 'Pierwsze' }]),
        createNotifications([{ userId: userA, portalId: portalA.id, kind: 'comment', clickupTaskId: 'p-2', taskName: 'Drugie' }]),
      ])
      void a; void b
      await loginAs(userA)
      const przed = await (await notifGET(new NextRequest(`http://localhost/api/notifications?slug=${portalA.slug}`))).json()

      const res = await notifPOST(
        jsonReq('/api/notifications', { slug: portalA.slug, ids: [przed.items[0].id] })
      )
      const body = await res.json()

      // Wczesniej licznik schodzil WYLACZNIE przyciskiem „oznacz wszystkie",
      // wiec przeczytanie jednej sprawy nie zmienialo cyfry przy dzwonku.
      assert.strictEqual(body.unread, przed.unread - 1)
    })

    it('kasowanie usuwa WIERSZ z bazy, nie tylko z ekranu', async () => {
      await createNotifications([
        { userId: userA, portalId: portalA.id, kind: 'comment', clickupTaskId: 'p-3', taskName: 'Do skasowania' },
      ])
      await loginAs(userA)
      const lista = await (await notifGET(new NextRequest(`http://localhost/api/notifications?slug=${portalA.slug}`))).json()
      const doKasacji = lista.items.find((i: { taskName: string }) => i.taskName === 'Do skasowania')

      const res = await notifDELETE(
        jsonReq('/api/notifications', { slug: portalA.slug, ids: [doKasacji.id] })
      )

      assert.strictEqual(res.status, 200)
      const wiersze = await db.select().from(notifications).where(eq(notifications.id, doKasacji.id))
      assert.strictEqual(wiersze.length, 0)
    })

    it('NIE skasuje cudzego powiadomienia, nawet znajac jego identyfikator', async () => {
      await createNotifications([
        { userId: userB, portalId: portalB.id, kind: 'comment', clickupTaskId: 'p-4', taskName: 'Cudze' },
      ])
      const [cudze] = await db.select().from(notifications).where(eq(notifications.userId, userB))
      await loginAs(userA)

      const res = await notifDELETE(
        jsonReq('/api/notifications', { slug: portalA.slug, ids: [cudze.id] })
      )
      const body = await res.json()

      // Identyfikator przychodzi z przegladarki, wiec nie moze sam decydowac,
      // czyj wiersz kasujemy. Odpowiedz jest 200, ale skasowano ZERO.
      assert.strictEqual(body.usuniete, 0)
      assert.strictEqual(
        (await db.select().from(notifications).where(eq(notifications.id, cudze.id))).length,
        1,
        'cudze powiadomienie nietkniete'
      )
    })

    it('PUSTA lista identyfikatorow -> 400, zeby nie skasowac wszystkiego', async () => {
      await loginAs(userA)

      const res = await notifDELETE(jsonReq('/api/notifications', { slug: portalA.slug, ids: [] }))

      // `markRead` bez `ids` znaczy „wszystkie moje". Gdyby kasowanie mialo te
      // sama wygode, jedno przeoczone `undefined` czyscilo by cala historie.
      assert.strictEqual(res.status, 400)
    })

    it('kasowanie bez sesji -> 401', async () => {
      const res = await notifDELETE(
        jsonReq('/api/notifications', { slug: portalA.slug, ids: ['00000000-0000-0000-0000-000000000000'] })
      )
      assert.strictEqual(res.status, 401)
    })

    it.skipIf(!process.env.ADMIN_SECRET)(
      'admin dostaje pusta liste zamiast bledu, bo nie ma konta w portalu',
      async () => {
        cookieJar.set(
          'admin_session',
          (await import('node:crypto')).createHmac('sha256', process.env.ADMIN_SECRET!)
            .update('admin-session').digest('hex')
        )

        const res = await notifGET(new NextRequest(`http://localhost/api/notifications?slug=${portalA.slug}`))
        const body = await res.json()

        // Podglad portalu ma dzialac; pusty dzwonek jest poprawna odpowiedzia,
        // bo `notifications.user_id` wskazuje na portal_users, a admin tam nie ma wiersza.
        assert.strictEqual(res.status, 200)
        assert.strictEqual(body.adminPreview, true)
        assert.strictEqual(body.unread, 0)
      }
    )

    it('bez sesji -> 401, bez sluga -> 400', async () => {
      assert.strictEqual(
        (await notifGET(new NextRequest(`http://localhost/api/notifications?slug=${portalA.slug}`))).status,
        401
      )
      await loginAs(userA)
      assert.strictEqual(
        (await notifGET(new NextRequest('http://localhost/api/notifications'))).status,
        400
      )
    })
  })

  describe('POST /api/portal-ideas (pomysl na portal)', () => {
    // Zmienna srodowiskowa jest globalna dla procesu, a pliki testow chodza
    // sekwencyjnie w tym samym procesie. Bez przywrocenia ten test ustawialby
    // konfiguracje kolejnym plikom i zmienialby ich wynik.
    const przedIdeas = process.env.CLICKUP_PORTAL_IDEAS_LIST_ID
    afterAll(() => {
      if (przedIdeas === undefined) delete process.env.CLICKUP_PORTAL_IDEAS_LIST_ID
      else process.env.CLICKUP_PORTAL_IDEAS_LIST_ID = przedIdeas
    })

    it('pomysl trafia do NASZEJ listy, nie na kanban klienta', async () => {
      await loginAs(userA)
      process.env.CLICKUP_PORTAL_IDEAS_LIST_ID = 'nasza-lista-pomyslow'
      clickup.createTask.mockResolvedValue({ id: 'pomysl-1', name: 'x', url: null })

      const res = await ideasPOST(
        jsonReq('/api/portal-ideas', { slug: portalA.slug, text: 'przydalby sie eksport do PDF' })
      )

      assert.strictEqual(res.status, 200)
      // Klucz rzeczy: lista NASZA, a nie `lista-a` z folderu klienta. Pomysl o
      // portalu jest nasza praca nad produktem, nie zleceniem dla klienta.
      assert.strictEqual(clickup.createTask.mock.calls[0][0], 'nasza-lista-pomyslow')

      const wpisy = await db
        .select()
        .from(auditLog)
        .where(and(eq(auditLog.portalId, portalA.id), eq(auditLog.action, 'portal_idea')))
      assert.strictEqual(wpisy.length, 1)
    })

    it('za krotki pomysl odrzucony przed dotknieciem ClickUpa', async () => {
      await loginAs(userA)

      const res = await ideasPOST(jsonReq('/api/portal-ideas', { slug: portalA.slug, text: 'krotkie' }))

      assert.strictEqual(res.status, 400)
      assert.strictEqual(clickup.createTask.mock.calls.length, 0)
    })

    it('cudzy slug nie podpisze pomyslu cudzym projektem', async () => {
      await loginAs(userA)

      const res = await ideasPOST(
        jsonReq('/api/portal-ideas', { slug: portalB.slug, text: 'podpisane nie tym projektem' })
      )

      assert.strictEqual(res.status, 401)
      assert.strictEqual(clickup.createTask.mock.calls.length, 0)
    })
  })

  describe('POST .../attachments (zalaczniki)', () => {
    it('zalacznik zadania spoza portalu NIE jest wysylany', async () => {
      await loginAs(userA)
      clickup.verifyTaskBelongsToFolder.mockResolvedValue(false)

      const form = new FormData()
      form.append('files', new File(['x'], 'zrzut.png', { type: 'image/png' }))
      const res = await attachPOST(
        new NextRequest(`http://localhost/api/clickup/tasks/obce/attachments?slug=${portalA.slug}`, {
          method: 'POST',
          body: form,
        } as ConstructorParameters<typeof NextRequest>[1]),
        { params: Promise.resolve({ taskId: 'obce' }) }
      )

      assert.strictEqual(res.status, 403)
      assert.strictEqual(clickup.addTaskAttachment.mock.calls.length, 0)
    })

    it('zalacznik wlasnego zadania przechodzi', async () => {
      await loginAs(userA)
      clickup.verifyTaskBelongsToFolder.mockResolvedValue(true)
      clickup.addTaskAttachment.mockResolvedValue({ url: 'https://cu.test/z.png' })

      const form = new FormData()
      form.append('files', new File(['x'], 'zrzut.png', { type: 'image/png' }))
      const res = await attachPOST(
        new NextRequest(`http://localhost/api/clickup/tasks/task-1/attachments?slug=${portalA.slug}`, {
          method: 'POST',
          body: form,
        } as ConstructorParameters<typeof NextRequest>[1]),
        { params: Promise.resolve({ taskId: 'task-1' }) }
      )
      const body = await res.json()

      assert.strictEqual(res.status, 200)
      assert.strictEqual(body.attachments[0].ok, true)
    })

    it('bez sluga nie dochodzi do sprawdzania zadania', async () => {
      await loginAs(userA)

      const form = new FormData()
      form.append('files', new File(['x'], 'z.png', { type: 'image/png' }))
      const res = await attachPOST(
        new NextRequest('http://localhost/api/clickup/tasks/task-1/attachments', {
          method: 'POST',
          body: form,
        } as ConstructorParameters<typeof NextRequest>[1]),
        { params: Promise.resolve({ taskId: 'task-1' }) }
      )

      assert.strictEqual(res.status, 400)
      assert.strictEqual(clickup.verifyTaskBelongsToFolder.mock.calls.length, 0)
    })
  })
})
