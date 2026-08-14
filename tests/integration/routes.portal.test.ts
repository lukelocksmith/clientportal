import { describe, it, beforeAll, afterAll, beforeEach, afterEach, vi } from 'vitest'
import assert from 'node:assert'
import { and, eq } from 'drizzle-orm'
import { db } from '@/lib/db'
import { auditLog, panicAlerts, notifications, smsLog } from '@/lib/db/schema'
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

/** /api/portal-ideas przyjmuje multipart/form-data, nie JSON — patrz komentarz w trasie. */
const ideaForm = (fields: { slug: string; text: string }, files: File[] = []) => {
  const form = new FormData()
  form.append('slug', fields.slug)
  form.append('text', fields.text)
  files.forEach(f => form.append('files', f))
  return new NextRequest('http://localhost/api/portal-ideas', {
    method: 'POST',
    body: form,
  } as ConstructorParameters<typeof NextRequest>[1])
}

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

      // 2. Powiadomienie mailem, przez wspolny mailer, wiec z wpisem w rejestrze.
      assert.ok(mailer.sendMail.mock.calls.length >= 1, 'mail alarmowy poszedl')
      assert.strictEqual(mailer.sendMail.mock.calls[0][0].kind, 'panic')

      // 3. Zadanie na tablicy, zeby alarm nie zniknal w skrzynce.
      assert.strictEqual(clickup.createTask.mock.calls.length, 1)
      assert.strictEqual(clickup.createTask.mock.calls[0][1].priority, 1)

      // 4. Osoba dyzurna przypisana od razu, zeby zadanie nie czekalo na to,
      // az ktos je zobaczy. Domyslnie Paulina (94729587).
      assert.deepEqual(clickup.createTask.mock.calls[0][1].assignees, [94729587])

      // 5. Id zadania zapisane przy alarmie. Bez niego eskalacja po 25 minutach
      // nie ma czego zapytac o przypisanych.
      const [poZadaniu] = await db.select().from(panicAlerts).where(eq(panicAlerts.id, alarmy[0].id))
      assert.strictEqual(poZadaniu.clickupTaskId, 'alarm-task')
      assert.strictEqual(poZadaniu.escalationCount, 0)
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

  /**
   * SMS z alarmu przez wlasna bramke. Bramka jest PODSTAWIONA (`fetch`), zeby
   * test nie budzil nikogo w nocy, ale reszta jest prawdziwa: sesja, zapis
   * alarmu i odczyt poprzedniego alarmu z bazy przy dlawiku.
   *
   * Wlasny portal i uzytkownik, bo dlawik patrzy na POPRZEDNI alarm w tym
   * samym projekcie — na portalu A alarmy z testow wyzej wpadlyby w okno i
   * uciszyly pierwszy SMS, czyli test sprawdzalby cos innego, niz sadzi.
   */
  describe('POST /api/panic — SMS do zespolu', () => {
    const ENV_KEYS = ['PANIC_SMS_TO', 'SMSGATE_API_USERNAME', 'SMSGATE_API_PASSWORD'] as const
    let savedEnv: Record<string, string | undefined>
    let portalC: { id: string; slug: string }
    let userC: string

    beforeAll(async () => {
      portalC = await createTestPortal('rp-sms')
      userC = await createTestUser(portalC.id, `user-${portalC.slug}@example.com`)
      // Bez listy nie ma gdzie zalozyc zadania, wiec nie byloby tez linku w SMS-ie.
      await createTestList({ portalId: portalC.id, clickupListId: 'lista-sms', isDefault: true })
    })

    afterAll(async () => {
      if (portalC) await dropTestPortal(portalC.id)
    })

    beforeEach(() => {
      savedEnv = Object.fromEntries(ENV_KEYS.map(k => [k, process.env[k]]))
      // FIKCYJNE dane bramki i numery z zakresu testowego (+48 555 ...).
      process.env.PANIC_SMS_TO = '555111222, 555333444'
      process.env.SMSGATE_API_USERNAME = 'test-device'
      process.env.SMSGATE_API_PASSWORD = 'test-pass-fixture'
      fetchMock.mockImplementation(
        async () => new Response(JSON.stringify({ id: 'sms-1', state: 'Pending' }), { status: 202 })
      )
      clickup.createTask.mockResolvedValue({ id: 'alarm-task', name: 'ALARM', url: 'https://cu.test/a' })
    })

    afterEach(async () => {
      for (const k of ENV_KEYS) {
        if (savedEnv[k] === undefined) delete process.env[k]
        else process.env[k] = savedEnv[k]
      }
      // Oba rejestry, nie tylko alarmy: `sms_log` ma portal_id ON DELETE SET NULL,
      // wiec wpisy przezylyby usuniecie portalu i liczylyby sie w kolejnym tescie.
      await db.delete(panicAlerts).where(eq(panicAlerts.portalId, portalC.id))
      await db.delete(smsLog).where(eq(smsLog.portalId, portalC.id))
    })

    it('wysyla SMS do kazdego numeru z PANIC_SMS_TO', async () => {
      await loginAs(userC)

      const res = await panicPOST(jsonReq('/api/panic', { slug: portalC.slug, message: 'strona nie dziala' }))

      assert.strictEqual(res.status, 200)
      const wyslane = fetchMock.mock.calls.filter(c => String(c[0]).includes('/api/3rdparty/v1/messages'))
      assert.strictEqual(wyslane.length, 2, 'po jednym SMS na odbiorce')

      const body = JSON.parse(String((wyslane[0][1] as RequestInit).body))
      assert.deepEqual(body.phoneNumbers, ['+48555111222'])
      assert.match(body.textMessage.text, /ALARM/)
      assert.match(body.textMessage.text, /strona nie dziala/)
      // Link do zadania jest sednem kolejnosci "najpierw ClickUp, potem alarm".
      assert.match(body.textMessage.text, /app\.clickup\.com\/t\/alarm-task/)
    })

    it('zadanie w ClickUpie powstaje PRZED wyslaniem SMS-a, inaczej nie byloby linku', async () => {
      await loginAs(userC)

      await panicPOST(jsonReq('/api/panic', { slug: portalC.slug, message: 'kolejnosc' }))

      const czasZadania = clickup.createTask.mock.invocationCallOrder[0]
      const czasSms = fetchMock.mock.invocationCallOrder.find((_, i) =>
        String(fetchMock.mock.calls[i][0]).includes('/api/3rdparty/v1/messages')
      )
      assert.ok(czasZadania && czasSms && czasZadania < czasSms, 'ClickUp musi byc wolany przed bramka SMS')
    })

    it('padniety ClickUp NIE ucisza alarmu, SMS idzie z informacja o braku zadania', async () => {
      await loginAs(userC)
      clickup.createTask.mockRejectedValue(new Error('ClickUp nie odpowiada'))
      const errorSpy = vi.spyOn(console, 'error').mockImplementation(() => {})

      const res = await panicPOST(jsonReq('/api/panic', { slug: portalC.slug, message: 'clickup padl' }))

      assert.strictEqual(res.status, 200)
      const wyslane = fetchMock.mock.calls.filter(c => String(c[0]).includes('/api/3rdparty/v1/messages'))
      assert.strictEqual(wyslane.length, 2, 'SMS-y poszly mimo padnietego ClickUpa')
      const body = JSON.parse(String((wyslane[0][1] as RequestInit).body))
      assert.match(body.textMessage.text, /NIE powstalo/)
      errorSpy.mockRestore()
    })

    it('zapisuje kazda probe do rejestru sms_log, zeby dalo sie sprawdzic czy dotarl', async () => {
      await loginAs(userC)

      await panicPOST(jsonReq('/api/panic', { slug: portalC.slug, message: 'pilne' }))

      const wpisy = await db.select().from(smsLog).where(eq(smsLog.portalId, portalC.id))
      assert.strictEqual(wpisy.length, 2)
      assert.ok(wpisy.every(w => w.ok))
      assert.ok(wpisy.every(w => w.providerMessageId === 'sms-1'))
    })

    it('drugi alarm w tym samym projekcie w oknie dlawika NIE wysyla kolejnego SMS-a', async () => {
      await loginAs(userC)

      await panicPOST(jsonReq('/api/panic', { slug: portalC.slug, message: 'pierwszy' }))
      const poPierwszym = fetchMock.mock.calls.length
      await panicPOST(jsonReq('/api/panic', { slug: portalC.slug, message: 'drugi, ten sam problem' }))

      assert.strictEqual(fetchMock.mock.calls.length, poPierwszym, 'drugi alarm nie wyslal SMS-a')
      // ...ale mail poszedl przy OBU, bo dlawik dotyczy wylacznie SMS-a.
      assert.strictEqual(mailer.sendMail.mock.calls.length, 2)
      const alarmy = await db.select().from(panicAlerts).where(eq(panicAlerts.portalId, portalC.id))
      assert.strictEqual(alarmy.length, 2, 'oba alarmy sa zapisane')
    })

    it('padnieta bramka NIE psuje alarmu, bo mail juz poszedl', async () => {
      await loginAs(userC)
      fetchMock.mockRejectedValue(new Error('bramka nie odpowiada'))
      const errorSpy = vi.spyOn(console, 'error').mockImplementation(() => {})

      const res = await panicPOST(jsonReq('/api/panic', { slug: portalC.slug, message: 'awaria' }))

      assert.strictEqual(res.status, 200)
      assert.ok(mailer.sendMail.mock.calls.length >= 1)
      const wpisy = await db.select().from(smsLog).where(eq(smsLog.portalId, portalC.id))
      assert.ok(wpisy.every(w => !w.ok), 'nieudane proby sa w rejestrze, nie giną po cichu')
      errorSpy.mockRestore()
    })

    it('brak PANIC_SMS_TO wylacza kanal, nie wywala alarmu', async () => {
      await loginAs(userC)
      delete process.env.PANIC_SMS_TO

      const res = await panicPOST(jsonReq('/api/panic', { slug: portalC.slug, message: 'bez smsa' }))

      assert.strictEqual(res.status, 200)
      const wyslane = fetchMock.mock.calls.filter(c => String(c[0]).includes('/api/3rdparty/v1/messages'))
      assert.strictEqual(wyslane.length, 0)
      const wpisy = await db.select().from(smsLog).where(eq(smsLog.portalId, portalC.id))
      assert.strictEqual(wpisy.length, 0, 'skoro nikt nie mial dostac SMS-a, rejestr tez jest pusty')
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
        ideaForm({ slug: portalA.slug, text: 'przydalby sie eksport do PDF' })
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

      const res = await ideasPOST(ideaForm({ slug: portalA.slug, text: 'krotkie' }))

      assert.strictEqual(res.status, 400)
      assert.strictEqual(clickup.createTask.mock.calls.length, 0)
    })

    it('cudzy slug nie podpisze pomyslu cudzym projektem', async () => {
      await loginAs(userA)

      const res = await ideasPOST(
        ideaForm({ slug: portalB.slug, text: 'podpisane nie tym projektem' })
      )

      assert.strictEqual(res.status, 401)
      assert.strictEqual(clickup.createTask.mock.calls.length, 0)
    })

    it('pomysl ze zrzutem: obraz idzie jako zalacznik NA UTWORZONE zadanie', async () => {
      // Osobny uzytkownik, zeby nie wpasc na cooldown poprzedniego zgloszenia
      // userA w tym samym pliku — cooldown jest sprawdzany na prawdziwej bazie.
      await loginAs(await createTestUser(portalA.id, `zrzut-${portalA.slug}@example.com`))
      process.env.CLICKUP_PORTAL_IDEAS_LIST_ID = 'nasza-lista-pomyslow'
      clickup.createTask.mockResolvedValue({ id: 'pomysl-2', name: 'x', url: null })
      clickup.addTaskAttachment.mockResolvedValue({ id: 'att-1', url: 'https://cu.test/1', title: 'a' })

      const res = await ideasPOST(
        ideaForm(
          { slug: portalA.slug, text: 'przydalby sie ciemny motyw' },
          [new File(['x'], 'zrzut.png', { type: 'image/png' })]
        )
      )
      const body = await res.json()

      assert.strictEqual(res.status, 200)
      assert.strictEqual(body.attachmentsFailed, 0)
      assert.strictEqual(clickup.addTaskAttachment.mock.calls.length, 1)
      assert.strictEqual(clickup.addTaskAttachment.mock.calls[0][0], 'pomysl-2')
    })

    it('nie-obrazkowy plik jest po cichu pomijany, pomysl i tak dociera', async () => {
      await loginAs(await createTestUser(portalA.id, `notatka-${portalA.slug}@example.com`))
      process.env.CLICKUP_PORTAL_IDEAS_LIST_ID = 'nasza-lista-pomyslow'
      clickup.createTask.mockResolvedValue({ id: 'pomysl-3', name: 'x', url: null })

      const res = await ideasPOST(
        ideaForm(
          { slug: portalA.slug, text: 'zalaczam plik, ktory nie jest obrazkiem' },
          [new File(['x'], 'notatka.txt', { type: 'text/plain' })]
        )
      )

      assert.strictEqual(res.status, 200)
      assert.strictEqual(clickup.addTaskAttachment.mock.calls.length, 0, 'plik spoza image/* nie ma trafic do ClickUpa')
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
