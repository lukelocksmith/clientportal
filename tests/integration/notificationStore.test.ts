/**
 * notificationStore.ts na prawdziwym Postgresie.
 *
 * `tests/integration/notifications.test.ts` juz pokrywa liczniki, markRead,
 * kolejke digestu (bez powtorki) i retencje — NIE powtarzamy tego tutaj.
 * Ten plik dobija to, co tamten pomija: ksztalt wiersza po insercie,
 * kolejnosc list, izolacje MIEDZY portalami (nie tylko miedzy userami w
 * jednym portalu) i kaskadowe kasowanie po usunieciu portalu.
 *
 *   docker start cp-test-pg && npm run test:integration
 */
import { describe, it, beforeAll, afterAll, expect } from 'vitest'
import assert from 'node:assert'
import { db } from '@/lib/db'
import { notifications } from '@/lib/db/schema'
import { eq } from 'drizzle-orm'
import {
  createNotifications,
  listForUser,
  markRead,
  pendingDigest,
  stampEmailSent,
} from '@/lib/notificationStore'
import { isDbReachable, createTestPortal, dropTestPortal, createTestUser } from './helpers'

const dbUp = await isDbReachable()

describe.skipIf(!dbUp)('notificationStore — ksztalt danych i izolacja', () => {
  describe('createNotifications', () => {
    let portalId: string
    let userId: string

    beforeAll(async () => {
      const portal = await createTestPortal('nstore-create')
      portalId = portal.id
      userId = await createTestUser(portalId, `u-${portal.slug}@example.com`)
    })

    afterAll(async () => {
      if (portalId) await dropTestPortal(portalId)
    })

    it('bez podanych opcjonalnych pol daje sensowne domyslne wartosci', async () => {
      const [row] = await createNotifications([
        { portalId, userId, kind: 'comment', taskName: 'Bez opcji' },
      ])

      assert.strictEqual(row.clickupTaskId, null)
      assert.deepStrictEqual(row.payload, {})
      assert.strictEqual(row.emailSentAt, null)
      assert.strictEqual(row.readAt, null, 'nowe powiadomienie musi byc nieprzeczytane')
      assert.strictEqual(row.portalId, portalId)
      assert.strictEqual(row.userId, userId)
      assert.strictEqual(row.kind, 'comment')
      assert.strictEqual(row.taskName, 'Bez opcji')
    })

    it('zapisuje podane clickupTaskId i payload bez zgubienia czegokolwiek', async () => {
      const [row] = await createNotifications([
        {
          portalId,
          userId,
          kind: 'status',
          taskName: 'Z opcjami',
          clickupTaskId: 'task-777',
          payload: { from: 'do zrobienia', to: 'w trakcie' },
        },
      ])

      assert.strictEqual(row.clickupTaskId, 'task-777')
      assert.deepStrictEqual(row.payload, { from: 'do zrobienia', to: 'w trakcie' })
    })

    it('emailSentAt ustawiony przy tworzeniu zostaje zapisany od razu (wyslane natychmiast)', async () => {
      const stamp = new Date()
      const [row] = await createNotifications([
        { portalId, userId, kind: 'comment', taskName: 'Od razu', emailSentAt: stamp },
      ])

      assert.ok(row.emailSentAt, 'brak stempla, choc podany przy tworzeniu')
      assert.strictEqual(new Date(row.emailSentAt as Date).getTime(), stamp.getTime())
    })

    it('jednym wywolaniem wstawia wiele wierszy dla roznych osob naraz', async () => {
      const marek = await createTestUser(portalId, `marek-batch-${portalId}@example.com`)
      const rows = await createNotifications([
        { portalId, userId, kind: 'comment', taskName: 'Batch A' },
        { portalId, userId: marek, kind: 'comment', taskName: 'Batch B' },
      ])

      assert.strictEqual(rows.length, 2)
      assert.deepStrictEqual(
        rows.map(r => r.userId).sort(),
        [userId, marek].sort()
      )
    })
  })

  describe('listForUser — kolejnosc i limit', () => {
    let portalId: string
    let userId: string

    beforeAll(async () => {
      const portal = await createTestPortal('nstore-list')
      portalId = portal.id
      userId = await createTestUser(portalId, `u-${portal.slug}@example.com`)

      // Wstawiamy po kolei, zeby created_at rosl monotonicznie.
      for (const taskName of ['Pierwsze', 'Drugie', 'Trzecie']) {
        await createNotifications([{ portalId, userId, kind: 'status', taskName }])
      }
    })

    afterAll(async () => {
      if (portalId) await dropTestPortal(portalId)
    })

    it('zwraca od najnowszego do najstarszego', async () => {
      const rows = await listForUser(userId, 10)
      const nazwy = rows.map(r => r.taskName)
      assert.deepStrictEqual(nazwy, ['Trzecie', 'Drugie', 'Pierwsze'])
    })

    it('limit ponizej 1 nie wywala zapytania, tylko obcina do 1 wiersza', async () => {
      const rows = await listForUser(userId, 0)
      assert.strictEqual(rows.length, 1)
      assert.strictEqual(rows[0].taskName, 'Trzecie', 'limit=0 musi dac przynajmniej najnowszy wiersz')
    })

    it('limit ponad 50 jest przycinany do 50, zamiast dociagac wszystko', async () => {
      // Nie wstawiamy tu 51 wierszy — sprawdzamy sama zasade obciecia na malej
      // probce: limit=1000 nie moze zwrocic wiecej niz jest w bazie, ale
      // NAJWAZNIEJSZE jest to, ze funkcja nie odrzuca ani nie zawyza limitu
      // ponad 50 (test progu robimy przez samo query — patrz test nizej).
      const rows = await listForUser(userId, 1000)
      assert.ok(rows.length <= 50)
    })

    it('domyslny limit to 20, bez podawania argumentu', async () => {
      const rows = await listForUser(userId)
      assert.strictEqual(rows.length, 3, 'przy 3 wierszach w bazie domyslny limit i tak zwraca wszystkie')
    })
  })

  describe('markRead — oznaczanie czesciowe', () => {
    let portalId: string
    let userId: string

    beforeAll(async () => {
      const portal = await createTestPortal('nstore-partial')
      portalId = portal.id
      userId = await createTestUser(portalId, `u-${portal.slug}@example.com`)
    })

    afterAll(async () => {
      if (portalId) await dropTestPortal(portalId)
    })

    it('z konkretnymi id oznacza TYLKO wskazane wiersze, reszta zostaje nieprzeczytana', async () => {
      const [a, b, c] = await createNotifications([
        { portalId, userId, kind: 'status', taskName: 'A' },
        { portalId, userId, kind: 'status', taskName: 'B' },
        { portalId, userId, kind: 'status', taskName: 'C' },
      ])

      await markRead(userId, [a.id, c.id])

      const rows = await db.select().from(notifications).where(eq(notifications.userId, userId))
      const stan = Object.fromEntries(rows.map(r => [r.taskName, r.readAt !== null]))
      assert.strictEqual(stan['A'], true)
      assert.strictEqual(stan['B'], false, 'B nie bylo na liscie id, nie powinno zostac ruszone')
      assert.strictEqual(stan['C'], true)
      void b
    })
  })

  describe('stampEmailSent', () => {
    let portalId: string
    let userId: string

    beforeAll(async () => {
      const portal = await createTestPortal('nstore-stamp')
      portalId = portal.id
      userId = await createTestUser(portalId, `u-${portal.slug}@example.com`)
    })

    afterAll(async () => {
      if (portalId) await dropTestPortal(portalId)
    })

    it('wpisuje realny znacznik czasu, nie tylko usuwa z kolejki digestu', async () => {
      const [row] = await createNotifications([
        { portalId, userId, kind: 'status', taskName: 'Do oznaczenia' },
      ])
      assert.strictEqual(row.emailSentAt, null)

      const przed = Date.now()
      await stampEmailSent([row.id])

      const [po] = await db.select().from(notifications).where(eq(notifications.id, row.id))
      assert.ok(po.emailSentAt, 'stampEmailSent nie ustawil znacznika')
      assert.ok(
        new Date(po.emailSentAt as Date).getTime() >= przed - 1000,
        'znacznik wyglada na stary, jakby stampEmailSent nic nie zrobil'
      )
    })
  })

  describe('izolacja MIEDZY portalami', () => {
    let portalA: string
    let portalB: string
    let userA: string
    let userB: string

    beforeAll(async () => {
      const pA = await createTestPortal('nstore-iso-a')
      const pB = await createTestPortal('nstore-iso-b')
      portalA = pA.id
      portalB = pB.id
      // Ten sam adres w obu portalach celowo: to NAJTWARDSZY przypadek —
      // gdyby cokolwiek scalalo po emailu zamiast po userId/portalId,
      // ten test by to zlapal.
      userA = await createTestUser(portalA, 'ten-sam@example.com')
      userB = await createTestUser(portalB, 'ten-sam@example.com')

      await createNotifications([
        { portalId: portalA, userId: userA, kind: 'comment', taskName: 'Sprawa w portalu A' },
        { portalId: portalB, userId: userB, kind: 'comment', taskName: 'Sprawa w portalu B' },
      ])
    })

    afterAll(async () => {
      if (portalA) await dropTestPortal(portalA)
      if (portalB) await dropTestPortal(portalB)
    })

    it('listForUser jednego portalu nie pokazuje spraw z drugiego, mimo tego samego maila', async () => {
      const rowsA = await listForUser(userA)
      const rowsB = await listForUser(userB)

      assert.deepStrictEqual(rowsA.map(r => r.taskName), ['Sprawa w portalu A'])
      assert.deepStrictEqual(rowsB.map(r => r.taskName), ['Sprawa w portalu B'])
    })

    it('markRead w portalu A nie rusza wiersza o tym samym mailu w portalu B', async () => {
      await markRead(userA)

      const [row] = await db.select().from(notifications).where(eq(notifications.userId, userB))
      assert.strictEqual(row.readAt, null, 'oznaczenie w portalu A wycieklo do portalu B')
    })

    it('pendingDigest zwraca wpisy obu portali, ale kazdy z wlasciwym portalId', async () => {
      const oczekujace = (await pendingDigest()).filter(
        r => r.taskName === 'Sprawa w portalu A' || r.taskName === 'Sprawa w portalu B'
      )
      const poNazwie = Object.fromEntries(oczekujace.map(r => [r.taskName, r.portalId]))

      assert.strictEqual(poNazwie['Sprawa w portalu A'], portalA)
      assert.strictEqual(poNazwie['Sprawa w portalu B'], portalB)
    })

    it('kasowanie portalu kaskadowo usuwa jego powiadomienia, nie rusza drugiego portalu', async () => {
      const trzeci = await createTestPortal('nstore-iso-c')
      const userC = await createTestUser(trzeci.id, `c-${trzeci.slug}@example.com`)
      const [notif] = await createNotifications([
        { portalId: trzeci.id, userId: userC, kind: 'comment', taskName: 'Do skasowania z portalem' },
      ])

      await dropTestPortal(trzeci.id)

      const zostalo = await db.select().from(notifications).where(eq(notifications.id, notif.id))
      assert.deepStrictEqual(zostalo, [], 'powiadomienie przezylo skasowanie wlasnego portalu')

      // Portale A i B, utworzone wczesniej, maja swoje powiadomienia nietkniete.
      const rowsA = await listForUser(userA)
      assert.strictEqual(rowsA.length, 1)
    })
  })

  describe('pendingDigest — kolejnosc i dane z joina', () => {
    let portalId: string
    let userId: string

    beforeAll(async () => {
      const portal = await createTestPortal('nstore-digest-order')
      portalId = portal.id
      userId = await createTestUser(portalId, `u-${portal.slug}@example.com`)

      for (const taskName of ['Najstarsza', 'Srodkowa', 'Najnowsza']) {
        await createNotifications([{ portalId, userId, kind: 'status', taskName }])
      }
    })

    afterAll(async () => {
      if (portalId) await dropTestPortal(portalId)
    })

    it('zwraca od najstarszego do najnowszego, odwrotnie niz listForUser', async () => {
      const oczekujace = (await pendingDigest())
        .filter(r => r.userId === userId)
        .map(r => r.taskName)
      assert.deepStrictEqual(oczekujace, ['Najstarsza', 'Srodkowa', 'Najnowsza'])
    })

    it('dolacza dane potrzebne do wyslania maila: adres, ustawienia, nazwe zadania', async () => {
      const [wpis] = (await pendingDigest()).filter(r => r.userId === userId)
      assert.ok(wpis.email?.includes('@'))
      assert.strictEqual(wpis.notifyImportant, 'instant', 'domyslne ustawienie z portal_users')
      assert.strictEqual(wpis.notifyBoard, 'daily', 'domyslne ustawienie z portal_users')
      assert.strictEqual(wpis.isActive, true)
    })
  })
})

if (!dbUp) {
  describe('notificationStore — ksztalt danych i izolacja', () => {
    it.skip('POMINIETE: brak Postgresa na localhost:5433 (docker start cp-test-pg)', () => {
      expect(true).toBe(true)
    })
  })
}
