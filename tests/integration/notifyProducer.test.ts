/**
 * PRODUCENT POWIADOMIEN na prawdziwym Postgresie.
 *
 * To jest ten kawalek, ktorego do 2026-08-24 nie bylo wcale: maszyneria stala
 * gotowa i przetestowana, ale nikt jej nie wolal, wiec dzwonek klienta byl
 * zawsze pusty. Testy jednostkowe pilnuja regul „kto co dostaje"
 * (src/lib/notifications.test.ts) i tresci (src/lib/notifyText.test.ts). Tutaj
 * sprawdzamy to, czego bez bazy sprawdzic nie da sie w ogole:
 *
 * - czy WYLACZONY projekt naprawde milczy (to jest flaga wdrozenia),
 * - czy klient nie dostaje powiadomienia o SWOIM wlasnym dzialaniu,
 * - czy mail idzie do autora zgloszenia, a nie do calego portalu.
 *
 * Poczta jest PODSTAWIONA, baza prawdziwa. Kazdy test ma wlasny portal.
 *
 *   docker start clientportal-postgres-1 && npm run test:integration
 */
import { describe, it, beforeAll, afterAll, beforeEach, vi } from 'vitest'
import assert from 'node:assert'
import { and, eq } from 'drizzle-orm'
import { db } from '@/lib/db'
import { notifications, portals, portalUsers } from '@/lib/db/schema'

const { mailer } = vi.hoisted(() => ({
  mailer: { sendMail: vi.fn(async () => ({ sent: true as const })) },
}))
vi.mock('@/lib/mailer', () => mailer)

import { produceNotifications } from '@/lib/notifyProducer'
import { countUnread, listForUser } from '@/lib/notificationStore'
import {
  logEvent,
  EVENT_TASK_CREATED,
  EVENT_COMMENT_ADDED,
  EVENT_STATUS_CHANGED,
} from '@/lib/portalEvents'
import { isDbReachable, createTestPortal, dropTestPortal, createTestUser } from './helpers'

const dbUp = await isDbReachable()

describe.skipIf(!dbUp)('producent powiadomien', () => {
  let portalId: string
  let slug: string
  /** Zglaszajaca: to ona zaklada zadania z portalu, wiec do niej ida maile. */
  let dorota: string
  /** Druga osoba w firmie klienta: dzwonek tak, mail nie. */
  let marek: string

  beforeAll(async () => {
    const portal = await createTestPortal('notify')
    portalId = portal.id
    slug = portal.slug
    dorota = await createTestUser(portalId, `dorota-${slug}@example.com`)
    marek = await createTestUser(portalId, `marek-${slug}@example.com`)
  })

  afterAll(async () => {
    if (portalId) await dropTestPortal(portalId)
  })

  beforeEach(async () => {
    vi.clearAllMocks()
    mailer.sendMail.mockResolvedValue({ sent: true })
    await db.delete(notifications).where(eq(notifications.portalId, portalId))
    await db.update(portalUsers).set({ isActive: true }).where(eq(portalUsers.portalId, portalId))
  })

  /** Ustawia macierz powiadomien projektu. `null` znaczy „wylaczone". */
  async function ustawMacierz(config: unknown) {
    await db.update(portals).set({ notificationConfig: config }).where(eq(portals.id, portalId))
  }

  const WSZYSTKO = {
    comment: { bell: true, mail: true },
    created: { bell: true, mail: true },
    status: { bell: true, mail: true },
    closed: { bell: true, mail: true },
  }

  /** Zadanie zgloszone Z PORTALU przez Dorote, czyli ma autora po stronie klienta. */
  async function zadanieOdDoroty(taskId: string) {
    await logEvent({
      portalId,
      actor: { userId: dorota, email: `dorota-${slug}@example.com`, name: 'Dorota' },
      action: EVENT_TASK_CREATED,
      resourceId: taskId,
    })
  }

  async function wiersze() {
    return db.select().from(notifications).where(eq(notifications.portalId, portalId))
  }

  describe('brama projektu', () => {
    it('projekt bez konfiguracji NIE wysyla nic', async () => {
      await ustawMacierz(null)
      await zadanieOdDoroty('zad-1')

      const wynik = await produceNotifications({
        portalId,
        event: 'comment',
        taskId: 'zad-1',
        taskName: 'Zadanie',
        author: 'Artem',
      })

      assert.deepStrictEqual(wynik, { bell: 0, mailed: 0, reason: 'off' })
      assert.strictEqual((await wiersze()).length, 0)
      assert.strictEqual(mailer.sendMail.mock.calls.length, 0)
    })

    it('zdarzenie wylaczone w macierzy nie powiadamia, wlaczone powiadamia', async () => {
      // Para: odmowa i przejscie w tej samej konfiguracji. Bez tego nie wiadomo,
      // czy cisza wynika z reguly, czy z tego, ze nic nie dziala.
      await ustawMacierz({ comment: { bell: true, mail: true } })
      await zadanieOdDoroty('zad-2')

      const status = await produceNotifications({
        portalId,
        event: 'status',
        taskId: 'zad-2',
        taskName: 'Zadanie',
        toStatus: 'w trakcie',
      })
      const komentarz = await produceNotifications({
        portalId,
        event: 'comment',
        taskId: 'zad-2',
        taskName: 'Zadanie',
        author: 'Artem',
      })

      assert.strictEqual(status.reason, 'channel-off')
      assert.strictEqual(komentarz.bell, 2, 'dzwonek dla obu osob')
      assert.strictEqual(komentarz.mailed, 1, 'mail tylko do zglaszajacej')
    })
  })

  describe('kto dostaje', () => {
    it('dzwonek dla wszystkich aktywnych, mail dla autora zgloszenia', async () => {
      await ustawMacierz(WSZYSTKO)
      await zadanieOdDoroty('zad-3')

      const wynik = await produceNotifications({
        portalId,
        event: 'comment',
        taskId: 'zad-3',
        taskName: 'Filtry na mobile',
        author: 'Artem',
        excerpt: 'poprawione',
      })

      assert.strictEqual(wynik.bell, 2)
      assert.strictEqual(wynik.mailed, 1)
      const adresaci = mailer.sendMail.mock.calls.map(
        c => (c as unknown as [{ to: string }])[0].to
      )
      assert.deepStrictEqual(adresaci, [`dorota-${slug}@example.com`])
    })

    it('osoba nieaktywna nie dostaje ani dzwonka, ani maila', async () => {
      await ustawMacierz(WSZYSTKO)
      await zadanieOdDoroty('zad-4')
      await db.update(portalUsers).set({ isActive: false }).where(eq(portalUsers.id, marek))

      const wynik = await produceNotifications({
        portalId,
        event: 'comment',
        taskId: 'zad-4',
        taskName: 'Zadanie',
        author: 'Artem',
      })

      assert.strictEqual(wynik.bell, 1)
      const ids = (await wiersze()).map(w => w.userId)
      assert.deepStrictEqual(ids, [dorota])
    })

    it('zadanie zalozone przez AGENCJE wysyla mail do wszystkich', async () => {
      // Bez autora po stronie klienta nie ma komu wyslac imiennie, a wtedy ta
      // kategoria nie powiadomilaby nigdy nikogo.
      await ustawMacierz(WSZYSTKO)

      const wynik = await produceNotifications({
        portalId,
        event: 'created',
        taskId: 'zad-agencji',
        taskName: 'Zadanie od nas',
      })

      assert.strictEqual(wynik.bell, 2)
      assert.strictEqual(wynik.mailed, 2)
    })
  })

  describe('tlumienie wlasnego dzialania', () => {
    it('komentarz napisany Z PORTALU nie powiadamia jego autorki', async () => {
      await ustawMacierz(WSZYSTKO)
      await zadanieOdDoroty('zad-5')
      // Tak zapisuje to trasa komentarzy: resourceId to id KOMENTARZA.
      await logEvent({
        portalId,
        actor: { userId: dorota, email: `dorota-${slug}@example.com`, name: 'Dorota' },
        action: EVENT_COMMENT_ADDED,
        resourceId: 'komentarz-99',
        meta: { taskId: 'zad-5' },
      })

      const wynik = await produceNotifications({
        portalId,
        event: 'comment',
        taskId: 'zad-5',
        taskName: 'Zadanie',
        author: 'Dorota',
        clickupCommentId: 'komentarz-99',
      })

      assert.strictEqual(wynik.bell, 1, 'zostaje tylko druga osoba')
      const ids = (await wiersze()).map(w => w.userId)
      assert.deepStrictEqual(ids, [marek])
      // Dorota byla autorka sprawy, ale to ona wlasnie napisala: zero maili.
      assert.strictEqual(wynik.mailed, 0)
    })

    it('komentarz zespolu powiadamia autorke, mimo tego samego konta serwisowego', async () => {
      // Para do testu wyzej. Brak wpisu o naszym komentarzu = pisal zespol.
      await ustawMacierz(WSZYSTKO)
      await zadanieOdDoroty('zad-6')

      const wynik = await produceNotifications({
        portalId,
        event: 'comment',
        taskId: 'zad-6',
        taskName: 'Zadanie',
        author: 'Artem',
        clickupCommentId: 'komentarz-zespolu',
      })

      assert.strictEqual(wynik.bell, 2)
      assert.strictEqual(wynik.mailed, 1)
    })

    it('zmiana statusu zrobiona z portalu nie wraca do tej samej osoby', async () => {
      await ustawMacierz(WSZYSTKO)
      await zadanieOdDoroty('zad-7')
      await logEvent({
        portalId,
        actor: { userId: dorota, email: `dorota-${slug}@example.com`, name: 'Dorota' },
        action: EVENT_STATUS_CHANGED,
        resourceId: 'zad-7',
        meta: { toStatus: 'w trakcie' },
      })

      const wynik = await produceNotifications({
        portalId,
        event: 'status',
        taskId: 'zad-7',
        taskName: 'Zadanie',
        fromStatus: 'nowe',
        toStatus: 'w trakcie',
      })

      const ids = (await wiersze()).map(w => w.userId)
      assert.deepStrictEqual(ids, [marek], 'Dorota wlasnie to zrobila')
      assert.strictEqual(wynik.mailed, 0)
    })

    it('INNY status w tym samym oknie NIE jest tlumiony', async () => {
      // Najwazniejszy test tlumienia. Okno czasowe bez porownania wartosci
      // zjadaloby powiadomienie o zmianie ZESPOLU, gdyby trafila zaraz po
      // zmianie klienta, a to jest gorszy kierunek bledu.
      await ustawMacierz(WSZYSTKO)
      await zadanieOdDoroty('zad-8')
      await logEvent({
        portalId,
        actor: { userId: dorota, email: `dorota-${slug}@example.com`, name: 'Dorota' },
        action: EVENT_STATUS_CHANGED,
        resourceId: 'zad-8',
        meta: { toStatus: 'w trakcie' },
      })

      const wynik = await produceNotifications({
        portalId,
        event: 'closed',
        taskId: 'zad-8',
        taskName: 'Zadanie',
        toStatus: 'zamknięte',
      })

      assert.strictEqual(wynik.bell, 2, 'zamkniecie zrobil zespol, wiec wiedza oboje')
      assert.strictEqual(wynik.mailed, 1)
    })
  })

  describe('kanaly osobno', () => {
    it('sam mail, bez dzwonka: dzwonek milczy, ale zapis zostaje', async () => {
      // Wiersz powstaje, zeby brama powtorek miala po czym poznac, ze mail juz
      // poszedl. Klient go nie widzi: `bell_visible = false`.
      await ustawMacierz({ comment: { mail: true } })
      await zadanieOdDoroty('zad-9')

      const wynik = await produceNotifications({
        portalId,
        event: 'comment',
        taskId: 'zad-9',
        taskName: 'Zadanie',
        author: 'Artem',
      })

      assert.strictEqual(wynik.bell, 0, 'nic nie dzwoni')
      assert.strictEqual(wynik.mailed, 1)
      const rows = await wiersze()
      assert.strictEqual(rows.length, 2, 'zapis istnieje')
      assert.ok(rows.every(r => r.bellVisible === false), 'zaden nie moze byc widoczny')
      // Dowod od strony klienta: dzwonek tego nie pokazuje.
      assert.strictEqual(await countUnread(dorota), 0)
      assert.strictEqual((await listForUser(dorota)).length, 0)
    })

    it('sam dzwonek, bez maila: wiersze sa, poczta nie rusza', async () => {
      await ustawMacierz({ comment: { bell: true } })
      await zadanieOdDoroty('zad-10')

      const wynik = await produceNotifications({
        portalId,
        event: 'comment',
        taskId: 'zad-10',
        taskName: 'Zadanie',
        author: 'Artem',
      })

      assert.strictEqual(wynik.bell, 2)
      assert.strictEqual(wynik.mailed, 0)
      assert.strictEqual(mailer.sendMail.mock.calls.length, 0)
    })

    it('wiersz osoby, ktora dostala mail, jest ostemplowany dla przyszlego digestu', async () => {
      await ustawMacierz(WSZYSTKO)
      await zadanieOdDoroty('zad-11')

      await produceNotifications({
        portalId,
        event: 'comment',
        taskId: 'zad-11',
        taskName: 'Zadanie',
        author: 'Artem',
      })

      const doroty = await db
        .select()
        .from(notifications)
        .where(and(eq(notifications.portalId, portalId), eq(notifications.userId, dorota)))
      const marka = await db
        .select()
        .from(notifications)
        .where(and(eq(notifications.portalId, portalId), eq(notifications.userId, marek)))

      assert.ok(doroty[0].emailSentAt, 'mail poszedl, wiec digest ma to pominac')
      assert.strictEqual(marka[0].emailSentAt, null, 'Marek maila nie dostal')
    })
  })

  describe('odpornosc', () => {
    it('awaria poczty nie kasuje dzwonka', async () => {
      await ustawMacierz(WSZYSTKO)
      await zadanieOdDoroty('zad-12')
      mailer.sendMail.mockRejectedValue(new Error('SMTP padl'))

      const wynik = await produceNotifications({
        portalId,
        event: 'comment',
        taskId: 'zad-12',
        taskName: 'Zadanie',
        author: 'Artem',
      })

      assert.strictEqual(wynik.bell, 2, 'dzwonek zostaje')
      assert.strictEqual(wynik.mailed, 0)
    })

    it('nieistniejacy projekt nie rzuca wyjatkiem', async () => {
      const wynik = await produceNotifications({
        portalId: '00000000-0000-0000-0000-000000000000',
        event: 'comment',
        taskId: 'zad-13',
        taskName: 'Zadanie',
      })

      assert.deepStrictEqual(wynik, { bell: 0, mailed: 0, reason: 'no-portal' })
    })
  })

  describe('to samo zdarzenie dwa razy', () => {
    it('ten sam komentarz nie powiadamia drugi raz', async () => {
      // ClickUp dostarcza zdarzenia CO NAJMNIEJ RAZ, wiec ponowienie jest
      // normalnym ruchem, nie awaria. Do tego webhook przychodzi takze przy
      // EDYCJI komentarza, a wtedy najnowszy w watku bywa ten sam co poprzednio.
      // Bez tej bramy klient dostawalby to samo powiadomienie kilka razy.
      await ustawMacierz(WSZYSTKO)
      await zadanieOdDoroty('zad-20')

      const pierwsze = await produceNotifications({
        portalId,
        event: 'comment',
        taskId: 'zad-20',
        taskName: 'Zadanie',
        author: 'Artem',
        excerpt: 'poprawione',
        clickupCommentId: 'komentarz-abc',
      })
      const drugie = await produceNotifications({
        portalId,
        event: 'comment',
        taskId: 'zad-20',
        taskName: 'Zadanie',
        author: 'Artem',
        excerpt: 'poprawione',
        clickupCommentId: 'komentarz-abc',
      })

      assert.strictEqual(pierwsze.bell, 2)
      assert.deepStrictEqual(drugie, { bell: 0, mailed: 0, reason: 'duplicate' })
      assert.strictEqual((await wiersze()).length, 2, 'nadal dwa wiersze, nie cztery')
      assert.strictEqual(mailer.sendMail.mock.calls.length, 1, 'mail poszedl raz')
    })

    it('INNY komentarz w tym samym zadaniu powiadamia normalnie', async () => {
      // Para do testu wyzej: brama ma zatrzymywac powtorke, nie kolejna rozmowe.
      await ustawMacierz(WSZYSTKO)
      await zadanieOdDoroty('zad-21')

      await produceNotifications({
        portalId,
        event: 'comment',
        taskId: 'zad-21',
        taskName: 'Zadanie',
        author: 'Artem',
        clickupCommentId: 'komentarz-1',
      })
      const drugie = await produceNotifications({
        portalId,
        event: 'comment',
        taskId: 'zad-21',
        taskName: 'Zadanie',
        author: 'Artem',
        clickupCommentId: 'komentarz-2',
      })

      assert.strictEqual(drugie.bell, 2)
    })

    it('przy samym mailu, bez dzwonka, powtorka TEZ jest blokowana', async () => {
      /**
       * Dziura zamknieta 2026-08-24 kolumna `bell_visible`: wiersz powstaje
       * ZAWSZE, takze przy wylaczonym dzwonku, wiec brama powtorek dziala w
       * kazdej konfiguracji. Wczesniej przy „mail tak, dzwonek nie" ponowione
       * zdarzenie z ClickUpa wysylalo maila drugi raz.
       */
      await ustawMacierz({ comment: { mail: true } })
      await zadanieOdDoroty('zad-23')

      const raz = await produceNotifications({
        portalId,
        event: 'comment',
        taskId: 'zad-23',
        taskName: 'Zadanie',
        author: 'Artem',
        clickupCommentId: 'komentarz-bez-dzwonka',
      })
      const dwa = await produceNotifications({
        portalId,
        event: 'comment',
        taskId: 'zad-23',
        taskName: 'Zadanie',
        author: 'Artem',
        clickupCommentId: 'komentarz-bez-dzwonka',
      })

      assert.strictEqual(raz.mailed, 1)
      assert.deepStrictEqual(dwa, { bell: 0, mailed: 0, reason: 'duplicate' })
      assert.strictEqual(mailer.sendMail.mock.calls.length, 1, 'mail poszedl raz')
    })

    it('zdarzenie bez identyfikatora komentarza nie jest blokowane', async () => {
      // Statusy i nowe zadania nie maja identyfikatora komentarza, wiec brama
      // nie moze ich dotyczyc.
      await ustawMacierz(WSZYSTKO)

      const raz = await produceNotifications({
        portalId,
        event: 'status',
        taskId: 'zad-22',
        taskName: 'Zadanie',
        toStatus: 'w trakcie',
      })
      const dwa = await produceNotifications({
        portalId,
        event: 'status',
        taskId: 'zad-22',
        taskName: 'Zadanie',
        toStatus: 'przeglad',
      })

      assert.strictEqual(raz.bell, 2)
      assert.strictEqual(dwa.bell, 2)
    })
  })
})
