import { describe, it, beforeAll, afterAll, beforeEach, vi } from 'vitest'
import assert from 'node:assert'
import { createHmac } from 'node:crypto'
import { isDbReachable, createTestPortal, dropTestPortal, createTestUser } from './helpers'

/**
 * WEBHOOK ClickUpa — jedyne wejscie, ktore przyjmuje payload od cudzego systemu.
 *
 * Dwie rzeczy sa tu wazne i obie latwo zrobic zle:
 *
 * 1. PODPIS. Bez niego kazdy, kto zna adres, przepisywalby indeks Historii
 *    klienta. Podpis liczy sie z SUROWEGO ciala zadania, wiec test podaje cialo
 *    zmienione po podpisaniu i sprawdza, ze nie przechodzi.
 *
 * 2. PRZYPISANIE DO PORTALU. Folder zadania bierzemy z ClickUpa, NIE z payloadu,
 *    bo payload folderu nie zawiera, a gdyby zawieral, byl by danymi od
 *    nadawcy. Przeniesienie zadania miedzy folderami MUSI usunac je z indeksu
 *    poprzedniego portalu, inaczej klient zachowuje przeszukiwalna kopie
 *    czegos, co juz do niego nie nalezy.
 *
 * PULAPKA, przez ktora ten plik wyglada inaczej niz pozostale: `WEBHOOK_SECRET`
 * jest stala modulu, czytana z `process.env` RAZ, przy imporcie. W `.env.local`
 * tej zmiennej nie ma, wiec bez ustawienia jej PRZED importem trasa zwracalaby
 * 503 na wszystko, a testy przechodzilyby, sprawdzajac wylacznie to, ze
 * nieskonfigurowany webhook nic nie robi. `vi.hoisted` wykonuje sie przed
 * wciagnieciem modulow i to jest jedyne miejsce, w ktorym da sie to ustawic.
 *
 *   docker start cp-test-pg && npm run test:integration
 */
const SEKRET = 'sekret-testowy-webhooka'

const { poprzedniSekret, clickup, taskIndex, cache, mailer } = vi.hoisted(() => {
  const poprzedni = process.env.CLICKUP_WEBHOOK_SECRET
  process.env.CLICKUP_WEBHOOK_SECRET = 'sekret-testowy-webhooka'
  return {
    poprzedniSekret: poprzedni,
    clickup: { getTask: vi.fn(), getTaskComments: vi.fn() },
    taskIndex: { indexSingleTask: vi.fn(), removeTaskFromIndex: vi.fn() },
    cache: { revalidatePath: vi.fn(), revalidateTag: vi.fn() },
    mailer: { sendMail: vi.fn(async () => ({ sent: true as const })) },
  }
})

vi.mock('@/lib/clickup', () => clickup)
vi.mock('@/lib/taskIndex', () => taskIndex)
vi.mock('next/cache', () => cache)
vi.mock('@/lib/mailer', () => mailer)

import { NextRequest } from 'next/server'
import { eq } from 'drizzle-orm'
import { db } from '@/lib/db'
import { notifications, portals } from '@/lib/db/schema'
import { POST as webhookPOST } from '@/app/api/webhooks/clickup/route'

const dbUp = await isDbReachable()

/** Zadanie podpisane poprawnie, tak jak robi to ClickUp. */
function podpisane(payload: unknown, sekret = SEKRET): NextRequest {
  const body = JSON.stringify(payload)
  return new NextRequest('http://localhost/api/webhooks/clickup', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'x-signature': createHmac('sha256', sekret).update(body).digest('hex'),
    },
    body,
  } as ConstructorParameters<typeof NextRequest>[1])
}

describe.skipIf(!dbUp)('webhook ClickUpa na prawdziwej bazie', () => {
  let portalA: { id: string; slug: string }
  let portalB: { id: string; slug: string }

  beforeAll(async () => {
    portalA = await createTestPortal('wh-a')
    portalB = await createTestPortal('wh-b')
  })

  afterAll(async () => {
    if (portalA) await dropTestPortal(portalA.id)
    if (portalB) await dropTestPortal(portalB.id)
    if (poprzedniSekret === undefined) delete process.env.CLICKUP_WEBHOOK_SECRET
    else process.env.CLICKUP_WEBHOOK_SECRET = poprzedniSekret
  })

  beforeEach(() => {
    vi.clearAllMocks()
    taskIndex.indexSingleTask.mockResolvedValue(true)
    taskIndex.removeTaskFromIndex.mockResolvedValue(undefined)
  })

  /** Ile razy zadanie zostalo usuniete z indeksu KONKRETNEGO portalu. */
  const usunieteZ = (portalId: string) =>
    taskIndex.removeTaskFromIndex.mock.calls.filter(c => c[0] === portalId).length

  describe('podpis', () => {
    it('bez naglowka z podpisem -> 401 i zadnego dotkniecia indeksu', async () => {
      const body = JSON.stringify({ event: 'taskUpdated', task_id: 'z-1' })
      const res = await webhookPOST(
        new NextRequest('http://localhost/api/webhooks/clickup', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body,
        } as ConstructorParameters<typeof NextRequest>[1])
      )

      assert.strictEqual(res.status, 401)
      assert.strictEqual(taskIndex.indexSingleTask.mock.calls.length, 0)
      assert.strictEqual(clickup.getTask.mock.calls.length, 0)
    })

    it('podpis policzony NIE TYM sekretem -> 401', async () => {
      const res = await webhookPOST(
        podpisane({ event: 'taskUpdated', task_id: 'z-1' }, 'zgadywany-sekret')
      )

      assert.strictEqual(res.status, 401)
    })

    it('CIALO zmienione po podpisaniu -> 401', async () => {
      // Podpis liczony z jednego ciala, wyslany z innym. To jest ten przypadek,
      // dla ktorego podpis w ogole istnieje: przechwycone, prawidlowo podpisane
      // zadanie nie moze dac sie przerobic po drodze.
      const oryginal = JSON.stringify({ event: 'taskUpdated', task_id: 'z-1' })
      const podmienione = JSON.stringify({ event: 'taskUpdated', task_id: 'CUDZE-ZADANIE' })

      const res = await webhookPOST(
        new NextRequest('http://localhost/api/webhooks/clickup', {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            'x-signature': createHmac('sha256', SEKRET).update(oryginal).digest('hex'),
          },
          body: podmienione,
        } as ConstructorParameters<typeof NextRequest>[1])
      )

      assert.strictEqual(res.status, 401)
      assert.strictEqual(taskIndex.indexSingleTask.mock.calls.length, 0)
    })

    it('podpis o innej dlugosci nie wywala trasy, tylko odmawia', async () => {
      const body = JSON.stringify({ event: 'taskUpdated', task_id: 'z-1' })
      const res = await webhookPOST(
        new NextRequest('http://localhost/api/webhooks/clickup', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json', 'x-signature': 'krotki' },
          body,
        } as ConstructorParameters<typeof NextRequest>[1])
      )

      // `timingSafeEqual` rzuca przy roznej dlugosci buforow, wiec brak
      // wczesniejszego sprawdzenia dlugosci konczylby sie bledem 500 zamiast 401.
      assert.strictEqual(res.status, 401)
    })

    it('poprawny podpis, popsuty JSON -> 400', async () => {
      const body = '{to nie jest json'
      const res = await webhookPOST(
        new NextRequest('http://localhost/api/webhooks/clickup', {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            'x-signature': createHmac('sha256', SEKRET).update(body).digest('hex'),
          },
          body,
        } as ConstructorParameters<typeof NextRequest>[1])
      )

      assert.strictEqual(res.status, 400)
    })

    it('BEZ skonfigurowanego sekretu odmawia wszystkiego (fail closed)', async () => {
      // Osobny import modulu z pusta zmienna: stala jest czytana raz, przy
      // wciagnieciu, wiec inaczej tego przypadku nie da sie w ogole dosiegnac.
      vi.resetModules()
      const zapamietany = process.env.CLICKUP_WEBHOOK_SECRET
      delete process.env.CLICKUP_WEBHOOK_SECRET
      const errorSpy = vi.spyOn(console, 'error').mockImplementation(() => {})
      try {
        const { POST } = await import('@/app/api/webhooks/clickup/route')
        const res = await POST(podpisane({ event: 'taskUpdated', task_id: 'z-1' }))

        // Nieskonfigurowany webhook nie moze przechodzic „na wszelki wypadek".
        assert.strictEqual(res.status, 503)
      } finally {
        errorSpy.mockRestore()
        process.env.CLICKUP_WEBHOOK_SECRET = zapamietany
        vi.resetModules()
      }
    })
  })

  describe('przypisanie zadania do portalu', () => {
    it('zadanie z folderu klienta trafia do JEGO indeksu', async () => {
      clickup.getTask.mockResolvedValue({ id: 'z-1', folder: { id: `fake-${portalA.slug}` } })

      const res = await webhookPOST(podpisane({ event: 'taskUpdated', task_id: 'z-1' }))
      const body = await res.json()

      assert.strictEqual(res.status, 200)
      assert.strictEqual(body.portal, portalA.slug)
      assert.deepStrictEqual(taskIndex.indexSingleTask.mock.calls[0], [portalA.id, 'z-1'])
    })

    it('folder bierzemy z ClickUpa, a nie z payloadu', async () => {
      // Payload podaje folder portalu B, ClickUp mowi ze to folder portalu A.
      // Wygrywa ClickUp, bo payload przychodzi od nadawcy.
      clickup.getTask.mockResolvedValue({ id: 'z-2', folder: { id: `fake-${portalA.slug}` } })

      const res = await webhookPOST(
        podpisane({ event: 'taskUpdated', task_id: 'z-2', folder_id: `fake-${portalB.slug}` })
      )
      const body = await res.json()

      assert.strictEqual(body.portal, portalA.slug)
    })

    it('PRZENIESIENIE miedzy klientami usuwa z poprzedniego indeksu', async () => {
      clickup.getTask.mockResolvedValue({ id: 'z-3', folder: { id: `fake-${portalB.slug}` } })

      await webhookPOST(podpisane({ event: 'taskMoved', task_id: 'z-3' }))

      // Bez tego klient A zachowalby przeszukiwalna kopie zadania, ktore
      // przeniesiono do klienta B.
      assert.ok(usunieteZ(portalA.id) >= 1, 'usuniete z indeksu portalu A')
      assert.strictEqual(usunieteZ(portalB.id), 0, 'z portalu docelowego NIE usuwamy')
      assert.deepStrictEqual(taskIndex.indexSingleTask.mock.calls[0], [portalB.id, 'z-3'])
    })

    it('zadanie WYNIESIONE poza foldery klientow wypada ze wszystkich indeksow', async () => {
      clickup.getTask.mockResolvedValue({ id: 'z-4', folder: { id: 'folder-wewnetrzny-agencji' } })

      const res = await webhookPOST(podpisane({ event: 'taskMoved', task_id: 'z-4' }))
      const body = await res.json()

      assert.strictEqual(body.outsideClientFolders, true)
      assert.ok(usunieteZ(portalA.id) >= 1)
      assert.ok(usunieteZ(portalB.id) >= 1)
      assert.strictEqual(taskIndex.indexSingleTask.mock.calls.length, 0)
    })

    it('zadanie BEZ informacji o folderze traktujemy jak spoza klientow', async () => {
      clickup.getTask.mockResolvedValue({ id: 'z-5', folder: null })

      const res = await webhookPOST(podpisane({ event: 'taskUpdated', task_id: 'z-5' }))
      const body = await res.json()

      // Brak potwierdzenia przynaleznosci traktujemy jak odmowe, tak samo jak
      // w pozostalych sciezkach: nie zgadujemy, do kogo to nalezy.
      assert.strictEqual(body.outsideClientFolders, true)
      assert.strictEqual(taskIndex.indexSingleTask.mock.calls.length, 0)
    })

    it('SKASOWANE zadanie znika z indeksu KAZDEGO portalu', async () => {
      const res = await webhookPOST(podpisane({ event: 'taskDeleted', task_id: 'z-6' }))
      const body = await res.json()

      assert.strictEqual(body.removed, 'z-6')
      assert.ok(usunieteZ(portalA.id) >= 1)
      assert.ok(usunieteZ(portalB.id) >= 1)
      // Skasowanego zadania nie da sie juz pobrac, wiec nie pytamy ClickUpa
      // o folder — nie wiedzielibysmy, do kogo nalezalo.
      assert.strictEqual(clickup.getTask.mock.calls.length, 0)
    })
  })

  describe('odpornosc', () => {
    it('nieznane zdarzenie jest ignorowane, bez pytania ClickUpa', async () => {
      const res = await webhookPOST(podpisane({ event: 'listCreated', task_id: 'z-7' }))
      const body = await res.json()

      assert.strictEqual(res.status, 200)
      assert.strictEqual(body.ignored, 'listCreated')
      assert.strictEqual(clickup.getTask.mock.calls.length, 0)
    })

    it('komentarz TEZ uruchamia indeksowanie', async () => {
      clickup.getTask.mockResolvedValue({ id: 'z-8', folder: { id: `fake-${portalA.slug}` } })

      await webhookPOST(podpisane({ event: 'taskCommentPosted', task_id: 'z-8' }))

      // Zmiana komentarza NIE musi ruszyc `date_updated` zadania, wiec bez tej
      // sciezki przyrostowy cron przeoczylby zdjecie prefiksu [PUBLIC], czyli
      // zostawilby wycofana tresc w przeszukiwalnym indeksie klienta.
      assert.deepStrictEqual(taskIndex.indexSingleTask.mock.calls[0], [portalA.id, 'z-8'])
    })

    it('padniety ClickUp NIE daje bledu, tylko 200 z adnotacja', async () => {
      clickup.getTask.mockRejectedValue(new Error('ClickUp nie odpowiada'))
      const errorSpy = vi.spyOn(console, 'error').mockImplementation(() => {})

      const res = await webhookPOST(podpisane({ event: 'taskUpdated', task_id: 'z-9' }))
      const body = await res.json()

      // Blad odpowiedzi z powodu JEDNEGO zadania konczy sie ponawianiem przez
      // ClickUpa albo wylaczeniem subskrypcji. Cron i tak to nadrobi.
      assert.strictEqual(res.status, 200)
      assert.strictEqual(body.indexFailed, 'z-9')
      errorSpy.mockRestore()
    })

    it('zdarzenie BEZ task_id konczy sie spokojnie', async () => {
      const res = await webhookPOST(podpisane({ event: 'taskUpdated' }))

      assert.strictEqual(res.status, 200)
      assert.strictEqual(clickup.getTask.mock.calls.length, 0)
    })
  })

  /**
   * POWIADOMIENIA przez PRAWDZIWA trase webhooka.
   *
   * Producent ma wlasny zestaw testow (notifyProducer.test.ts). Tutaj chodzi o
   * to, czego tamten nie dowodzi: ze trasa go NAPRAWDE wola, ze wola go dla
   * wlasciwego zdarzenia i ze awaria powiadomien nie zabiera indeksowania
   * Historii. Do 2026-08-24 tego wywolania nie bylo wcale.
   */
  describe('powiadomienia', () => {
    let uzytkownik: string

    beforeAll(async () => {
      uzytkownik = await createTestUser(portalA.id, `wh-user-${portalA.slug}@example.com`)
    })

    beforeEach(async () => {
      mailer.sendMail.mockResolvedValue({ sent: true })
      clickup.getTaskComments.mockResolvedValue([])
      await db.delete(notifications).where(eq(notifications.portalId, portalA.id))
      await db
        .update(portals)
        .set({ notificationConfig: null })
        .where(eq(portals.id, portalA.id))
    })

    async function wlaczPowiadomienia() {
      await db
        .update(portals)
        .set({
          notificationConfig: {
            comment: { bell: true, mail: true },
            status: { bell: true },
            closed: { bell: true, mail: true },
            created: { bell: true },
          },
        })
        .where(eq(portals.id, portalA.id))
    }

    const zadanieA = { id: 'z-notify', name: 'Zadanie z powiadomieniem', folder: { id: `fake-${''}` } }

    function zadanie() {
      return { ...zadanieA, folder: { id: `fake-${portalA.slug}` } }
    }

    async function wiersze() {
      return db.select().from(notifications).where(eq(notifications.portalId, portalA.id))
    }

    it('projekt BEZ macierzy: indeks tak, powiadomienia nie', async () => {
      // To jest flaga wdrozenia sprawdzona przez cala trase, nie tylko w
      // producencie: wdrozenie na produkcje nie moze nic wyslac samo z siebie.
      clickup.getTask.mockResolvedValue(zadanie())
      clickup.getTaskComments.mockResolvedValue([
        { id: 'k1', comment_text: '[P] odpowiedz', date: '1000', user: { username: 'Artem' } },
      ])

      const res = await webhookPOST(podpisane({ event: 'taskCommentPosted', task_id: 'z-notify' }))

      assert.strictEqual(res.status, 200)
      assert.strictEqual(taskIndex.indexSingleTask.mock.calls.length, 1, 'indeks dziala niezaleznie')
      assert.strictEqual((await wiersze()).length, 0, 'powiadomienia milcza')
      assert.strictEqual(mailer.sendMail.mock.calls.length, 0)
    })

    it('komentarz [P] tworzy powiadomienie i wysyla mail', async () => {
      await wlaczPowiadomienia()
      clickup.getTask.mockResolvedValue(zadanie())
      clickup.getTaskComments.mockResolvedValue([
        { id: 'k-publiczny', comment_text: '[P] poprawione', date: '1000', user: { username: 'Artem' } },
      ])

      const res = await webhookPOST(podpisane({ event: 'taskCommentPosted', task_id: 'z-notify' }))

      assert.strictEqual(res.status, 200)
      const rows = await wiersze()
      assert.strictEqual(rows.length, 1)
      assert.strictEqual(rows[0].kind, 'comment')
      assert.strictEqual(rows[0].clickupTaskId, 'z-notify')
      assert.strictEqual(mailer.sendMail.mock.calls.length, 1)
    })

    it('komentarz WEWNETRZNY nie tworzy niczego', async () => {
      await wlaczPowiadomienia()
      clickup.getTask.mockResolvedValue(zadanie())
      clickup.getTaskComments.mockResolvedValue([
        { id: 'k-wewn', comment_text: 'klient nie zaplacil faktury', date: '1000', user: { username: 'Artem' } },
      ])

      await webhookPOST(podpisane({ event: 'taskCommentPosted', task_id: 'z-notify' }))

      assert.strictEqual((await wiersze()).length, 0)
      assert.strictEqual(mailer.sendMail.mock.calls.length, 0)
    })

    it('zmiana statusu tworzy powiadomienie ze starym i nowym statusem', async () => {
      await wlaczPowiadomienia()
      clickup.getTask.mockResolvedValue(zadanie())

      await webhookPOST(
        podpisane({
          event: 'taskStatusUpdated',
          task_id: 'z-notify',
          history_items: [
            { field: 'status', before: { status: 'nowe' }, after: { status: 'w trakcie' } },
          ],
        })
      )

      const rows = await wiersze()
      assert.strictEqual(rows.length, 1)
      assert.strictEqual(rows[0].kind, 'status')
      assert.deepStrictEqual(rows[0].payload, { from: 'nowe', to: 'w trakcie' })
      // Macierz ma dla statusu tylko dzwonek, wiec poczta nie rusza.
      assert.strictEqual(mailer.sendMail.mock.calls.length, 0)
    })

    it('zamkniecie sprawy to inne zdarzenie niz zwykla zmiana statusu', async () => {
      await wlaczPowiadomienia()
      clickup.getTask.mockResolvedValue(zadanie())

      await webhookPOST(
        podpisane({
          event: 'taskStatusUpdated',
          task_id: 'z-notify',
          history_items: [
            { field: 'status', before: { status: 'w trakcie' }, after: { status: 'zamknięte' } },
          ],
        })
      )

      const rows = await wiersze()
      assert.strictEqual(rows[0].kind, 'closed')
      assert.strictEqual(mailer.sendMail.mock.calls.length, 1, 'zamkniecie ma mail w macierzy')
    })

    it('awaria powiadomien NIE psuje indeksowania ani nie zwraca bledu', async () => {
      // ClickUp po serii bledow wylacza subskrypcje, a wtedy tracimy takze
      // aktualizacje Historii. Powiadomienie jest wazne, subskrypcja wazniejsza.
      await wlaczPowiadomienia()
      clickup.getTask.mockResolvedValue(zadanie())
      clickup.getTaskComments.mockRejectedValue(new Error('ClickUp padl'))
      const errorSpy = vi.spyOn(console, 'error').mockImplementation(() => {})

      const res = await webhookPOST(podpisane({ event: 'taskCommentPosted', task_id: 'z-notify' }))

      assert.strictEqual(res.status, 200)
      assert.strictEqual(taskIndex.indexSingleTask.mock.calls.length, 1)
      assert.strictEqual((await wiersze()).length, 0)
      errorSpy.mockRestore()
    })
  })
})
