/**
 * Powiadomienia na prawdziwym Postgresie.
 *
 * Testy jednostkowe w src/lib/notifications.test.ts pilnuja regul „kto co
 * dostaje". Tutaj sprawdzamy rzeczy, ktorych bez bazy sprawdzic sie nie da i
 * ktore kosztuja klienta najwiecej: czy zbiorczy mail nie wysle tego samego
 * drugi raz i czy retencja nie kasuje spraw, ktorych nikt nie widzial.
 *
 *   docker start cp-test-pg && npm run test:integration
 *
 * Kazdy test ma wlasny portal o losowym slugu i kasuje go po sobie.
 */
import { describe, it, beforeAll, afterAll, expect } from 'vitest'
import assert from 'node:assert'
import { db } from '@/lib/db'
import { notifications } from '@/lib/db/schema'
import { eq, sql } from 'drizzle-orm'
import {
  createNotifications,
  countUnread,
  listForUser,
  markRead,
  pendingDigest,
  stampEmailSent,
  purgeOldRead,
} from '@/lib/notificationStore'
import {
  isDbReachable,
  createTestPortal,
  dropTestPortal,
  createTestUser,
} from './helpers'

const dbUp = await isDbReachable()

describe.skipIf(!dbUp)('powiadomienia w bazie', () => {
  let portalId: string
  let dorota: string
  let marek: string

  beforeAll(async () => {
    const portal = await createTestPortal('notif')
    portalId = portal.id
    dorota = await createTestUser(portalId, `dorota-${portal.slug}@example.com`)
    marek = await createTestUser(portalId, `marek-${portal.slug}@example.com`)
  })

  afterAll(async () => {
    if (portalId) await dropTestPortal(portalId)
  })

  it('licznik dzwonka liczy tylko nieprzeczytane i tylko wlasne', async () => {
    await createNotifications([
      { portalId, userId: dorota, kind: 'comment', taskName: 'Koszyk' },
      { portalId, userId: dorota, kind: 'status', taskName: 'Baner' },
      { portalId, userId: marek, kind: 'comment', taskName: 'Koszyk' },
    ])

    assert.strictEqual(await countUnread(dorota), 2)
    assert.strictEqual(await countUnread(marek), 1)

    await markRead(dorota)
    assert.strictEqual(await countUnread(dorota), 0)
    // Oznaczenie u Doroty NIE moze ruszyc Marka.
    assert.strictEqual(await countUnread(marek), 1)
  })

  it('markRead z cudzym identyfikatorem nie rusza cudzego wiersza', async () => {
    // Identyfikator przychodzi z przegladarki, wiec nie moze sam decydowac,
    // czyj wiersz oznaczamy jako przeczytany.
    const [obcy] = await createNotifications([
      { portalId, userId: marek, kind: 'comment', taskName: 'Cudze' },
    ])

    await markRead(dorota, [obcy.id])

    const [row] = await db.select().from(notifications).where(eq(notifications.id, obcy.id))
    assert.strictEqual(row.readAt, null, 'wiersz Marka zostal oznaczony przez Dorote')
  })

  it('powiadomienie wyslane natychmiast nie wraca w zbiorczym mailu', async () => {
    const swiezy = await createTestPortal('notif-digest')
    const user = await createTestUser(swiezy.id, `x-${swiezy.slug}@example.com`)
    try {
      await createNotifications([
        // Poszlo od razu: ma stempel.
        { portalId: swiezy.id, userId: user, kind: 'comment', taskName: 'Od razu', emailSentAt: new Date() },
        // Czeka na digest.
        { portalId: swiezy.id, userId: user, kind: 'status', taskName: 'Do zbiorczego' },
      ])

      const oczekujace = (await pendingDigest()).filter(r => r.userId === user)
      assert.strictEqual(oczekujace.length, 1)
      assert.strictEqual(oczekujace[0].taskName, 'Do zbiorczego')
    } finally {
      await dropTestPortal(swiezy.id)
    }
  })

  it('drugie uruchomienie crona nie wysyla tego samego', async () => {
    const swiezy = await createTestPortal('notif-2x')
    const user = await createTestUser(swiezy.id, `y-${swiezy.slug}@example.com`)
    try {
      await createNotifications([
        { portalId: swiezy.id, userId: user, kind: 'status', taskName: 'Raz' },
        { portalId: swiezy.id, userId: user, kind: 'status', taskName: 'Dwa' },
      ])

      const pierwszy = (await pendingDigest()).filter(r => r.userId === user)
      assert.strictEqual(pierwszy.length, 2)
      await stampEmailSent(pierwszy.map(r => r.id))

      const drugi = (await pendingDigest()).filter(r => r.userId === user)
      assert.deepStrictEqual(drugi, [], 'digest wzialby te same powiadomienia drugi raz')
    } finally {
      await dropTestPortal(swiezy.id)
    }
  })

  it('digest pomija konta wylaczone', async () => {
    const swiezy = await createTestPortal('notif-off')
    const user = await createTestUser(swiezy.id, `z-${swiezy.slug}@example.com`)
    try {
      await createNotifications([
        { portalId: swiezy.id, userId: user, kind: 'status', taskName: 'Nieaktywny' },
      ])
      await db.execute(sql`UPDATE portal_users SET is_active = false WHERE id = ${user}`)

      const oczekujace = (await pendingDigest()).filter(r => r.userId === user)
      assert.deepStrictEqual(oczekujace, [])
    } finally {
      await dropTestPortal(swiezy.id)
    }
  })

  it('retencja kasuje stare przeczytane, ale NIE nieprzeczytane', async () => {
    const swiezy = await createTestPortal('notif-purge')
    const user = await createTestUser(swiezy.id, `p-${swiezy.slug}@example.com`)
    try {
      const rows = await createNotifications([
        { portalId: swiezy.id, userId: user, kind: 'status', taskName: 'Stare przeczytane' },
        { portalId: swiezy.id, userId: user, kind: 'status', taskName: 'Stare nieprzeczytane' },
        { portalId: swiezy.id, userId: user, kind: 'status', taskName: 'Swieze przeczytane' },
      ])
      const [stareP, stareN, swiezeP] = rows

      // Postarzamy recznie, bo test nie moze czekac 90 dni.
      await db.execute(
        sql`UPDATE notifications SET read_at = now() - interval '200 days' WHERE id = ${stareP.id}`
      )
      await db.execute(
        sql`UPDATE notifications SET created_at = now() - interval '200 days' WHERE id = ${stareN.id}`
      )
      await db.execute(sql`UPDATE notifications SET read_at = now() WHERE id = ${swiezeP.id}`)

      await purgeOldRead(90)

      const zostaly = await listForUser(user, 50)
      const nazwy = zostaly.map(r => r.taskName).sort()
      assert.deepStrictEqual(
        nazwy,
        ['Stare nieprzeczytane', 'Swieze przeczytane'],
        'retencja skasowala nie to, co trzeba'
      )
    } finally {
      await dropTestPortal(swiezy.id)
    }
  })

  it('pusta lista nie dotyka bazy i nie jest bledem', async () => {
    const out = await createNotifications([])
    assert.deepStrictEqual(out, [])
    await stampEmailSent([])
  })
})

// Gdy baza nie stoi, testy same sie pomijaja. Ten komunikat ma sprawic, ze
// pominiecie nie przejdzie niezauwazone: `npm run verify` konczy sie wtedy
// na zielono, mimo ze nic z tego pliku nie zostalo sprawdzone.
if (!dbUp) {
  describe('powiadomienia w bazie', () => {
    it.skip('POMINIETE: brak Postgresa na localhost:5433 (docker start cp-test-pg)', () => {
      expect(true).toBe(true)
    })
  })
}
