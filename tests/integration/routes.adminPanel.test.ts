import { describe, it, beforeAll, afterAll, beforeEach, vi } from 'vitest'
import assert from 'node:assert'
import { eq } from 'drizzle-orm'
import { db } from '@/lib/db'
import { portals, portalLists, panicAlerts, mailLog } from '@/lib/db/schema'
import {
  isDbReachable,
  createTestPortal,
  dropTestPortal,
  createTestUserWithPassword,
} from './helpers'

/**
 * RESZTA PANELU ADMINA plus potwierdzanie alarmu.
 *
 * Zamyka liste dziur z docs/testing.md. Dwie rzeczy sa tu warte uwagi ponad
 * zwykly perymetr:
 *
 * 1. PATCH portalu ma za soba realny blad: transformacja Zoda zamieniala pole
 *    NIEOBECNE w zadaniu na `null`, a `set()` sumiennie zerowalo kolor, logo
 *    i kontakt przy KAZDYM przelaczeniu zwyklej flagi. Test pilnuje roznicy
 *    miedzy „nie przyslano" a „przyslano null".
 *
 * 2. Potwierdzenie alarmu (`/api/panic/[id]/ack`) jest trasa PUBLICZNA,
 *    autoryzowana wylacznie tokenem z maila. Odpowiada HTML-em, wiec kod stanu
 *    nie niesie tu informacji o wyniku — trzeba czytac tresc strony.
 *
 * ClickUp podstawiony, bo `/admin/clickup/folders` wychodzi do sieci.
 *
 *   docker start cp-test-pg && npm run test:integration
 */
const { fetchMock } = vi.hoisted(() => ({ fetchMock: vi.fn() }))

vi.mock('next/headers', () => ({
  cookies: vi.fn(async () => ({
    get: () => undefined,
    set: () => {},
    delete: () => {},
  })),
}))

import { NextRequest } from 'next/server'
import { POST as portalsPOST, PATCH as portalsPATCH } from '@/app/api/admin/portals/route'
import { GET as linksGET, PUT as linksPUT } from '@/app/api/admin/portal-links/route'
import { GET as eventsGET } from '@/app/api/admin/portal-events/route'
import { GET as mailLogGET } from '@/app/api/admin/mail-log/route'
import { GET as syncGET } from '@/app/api/admin/portal-sync/route'
import { GET as foldersGET } from '@/app/api/admin/clickup/folders/route'
import { GET as listsGET } from '@/app/api/admin/clickup/folders/[folderId]/lists/route'
import { GET as activityGET } from '@/app/api/admin/users/[userId]/activity/route'
import { GET as ackGET } from '@/app/api/panic/[id]/ack/route'

const dbUp = await isDbReachable()
const maToken = !!process.env.ADMIN_API_TOKEN

const naglowek = () => ({ authorization: `Bearer ${process.env.ADMIN_API_TOKEN}` })

const req = (url: string, init?: RequestInit) =>
  new NextRequest(`http://localhost${url}`, init as ConstructorParameters<typeof NextRequest>[1])

const zTokenem = (url: string) => req(url, { headers: naglowek() })

const wyslij = (url: string, method: string, body: unknown) =>
  req(url, {
    method,
    headers: { 'Content-Type': 'application/json', ...naglowek() },
    body: JSON.stringify(body),
  })

describe.skipIf(!dbUp)('reszta panelu admina na prawdziwej bazie', () => {
  let portalA: { id: string; slug: string }

  beforeAll(async () => {
    portalA = await createTestPortal('panel')
  })

  afterAll(async () => {
    if (portalA) await dropTestPortal(portalA.id)
  })

  beforeEach(() => {
    vi.clearAllMocks()
    vi.stubGlobal('fetch', fetchMock)
  })

  /**
   * PERYMETR. Domkniecie listy z routes.admin.test.ts — te trasy tam nie weszly.
   */
  describe('perymetr pozostalych tras', () => {
    const trasy: Array<[string, () => Promise<Response>]> = [
      ['GET /admin/portal-links', () => linksGET(req('/api/admin/portal-links?slug=x'))],
      ['PUT /admin/portal-links', () => linksPUT(
        req('/api/admin/portal-links', {
          method: 'PUT',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ slug: 'x', links: [] }),
        })
      )],
      ['GET /admin/portal-events', () => eventsGET(req('/api/admin/portal-events?slug=x'))],
      ['GET /admin/mail-log', () => mailLogGET(req('/api/admin/mail-log?slug=x'))],
      ['GET /admin/portal-sync', () => syncGET(req('/api/admin/portal-sync?slug=x'))],
      ['GET /admin/clickup/folders', () => foldersGET(req('/api/admin/clickup/folders'))],
      ['GET /admin/clickup/folders/[id]/lists', () => listsGET(
        req('/api/admin/clickup/folders/123/lists'),
        { params: Promise.resolve({ folderId: '123' }) }
      )],
      ['GET /admin/users/[id]/activity', () => activityGET(
        req('/api/admin/users/00000000-0000-0000-0000-000000000000/activity'),
        { params: Promise.resolve({ userId: '00000000-0000-0000-0000-000000000000' }) }
      )],
      ['PATCH /admin/portals', () => portalsPATCH(
        req('/api/admin/portals', {
          method: 'PATCH',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ slug: 'x', isActive: false }),
        })
      )],
      ['POST /admin/portals', () => portalsPOST(
        req('/api/admin/portals', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ name: 'X', slug: 'x', clickupFolderId: '1', lists: [] }),
        })
      )],
    ]

    for (const [nazwa, wywolaj] of trasy) {
      it(`${nazwa} bez uprawnien -> 401`, async () => {
        assert.strictEqual((await wywolaj()).status, 401)
      })
    }

    it('GET /admin/clickup/folders bez uprawnien NIE woła ClickUpa', async () => {
      await foldersGET(req('/api/admin/clickup/folders'))

      // Odmowa po zapytaniu do ClickUpa i tak zjadalaby limit wspolnego tokenu.
      assert.strictEqual(fetchMock.mock.calls.length, 0)
    })
  })

  describe.skipIf(!maToken)('wspolny kontrakt tras z ?slug', () => {
    const trasy: Array<[string, (url: string) => Promise<Response>]> = [
      ['portal-links', u => linksGET(zTokenem(u))],
      ['portal-events', u => eventsGET(zTokenem(u))],
      ['mail-log', u => mailLogGET(zTokenem(u))],
      ['portal-sync', u => syncGET(zTokenem(u))],
    ]

    for (const [nazwa, wywolaj] of trasy) {
      it(`${nazwa}: bez ?slug -> 400`, async () => {
        assert.strictEqual((await wywolaj(`/api/admin/${nazwa}`)).status, 400)
      })

      it(`${nazwa}: nieistniejacy projekt -> 404`, async () => {
        assert.strictEqual((await wywolaj(`/api/admin/${nazwa}?slug=nie-ma-takiego`)).status, 404)
      })

      it(`${nazwa}: istniejacy projekt -> 200`, async () => {
        assert.strictEqual((await wywolaj(`/api/admin/${nazwa}?slug=${portalA.slug}`)).status, 200)
      })
    }
  })

  /**
   * PATCH PORTALU. Tu siedzial blad, ktory po cichu kasowal konfiguracje marki.
   */
  describe.skipIf(!maToken)('PATCH /api/admin/portals', () => {
    beforeEach(async () => {
      await db.update(portals)
        .set({
          brandColor: '#c8a24a',
          logoUrl: 'https://example.test/logo.png',
          contactName: 'Opiekun',
          reportsEnabled: false,
        })
        .where(eq(portals.id, portalA.id))
    })

    it('REGRESJA: przelaczenie flagi NIE kasuje koloru, logo ani kontaktu', async () => {
      const res = await portalsPATCH(
        wyslij('/api/admin/portals', 'PATCH', { slug: portalA.slug, reportsEnabled: true })
      )
      const { portal } = await res.json()

      assert.strictEqual(res.status, 200)
      assert.strictEqual(portal.reportsEnabled, true, 'flaga zmieniona')
      // Wczesniej transformacja Zoda zamieniala NIEOBECNE pole na null, a `set()`
      // sumiennie zerowalo marke klienta przy kazdym przelaczeniu zakladki.
      assert.strictEqual(portal.brandColor, '#c8a24a', 'kolor nietkniety')
      assert.strictEqual(portal.logoUrl, 'https://example.test/logo.png', 'logo nietkniete')
      assert.strictEqual(portal.contactName, 'Opiekun', 'kontakt nietkniety')
    })

    it('jawny null CZYSCI pole — to co innego niz nieobecnosc', async () => {
      const res = await portalsPATCH(
        wyslij('/api/admin/portals', 'PATCH', { slug: portalA.slug, brandColor: null })
      )
      const { portal } = await res.json()

      assert.strictEqual(portal.brandColor, null)
      assert.strictEqual(portal.logoUrl, 'https://example.test/logo.png', 'reszta bez zmian')
    })

    it('pusty ciag tez czysci pole', async () => {
      const res = await portalsPATCH(
        wyslij('/api/admin/portals', 'PATCH', { slug: portalA.slug, contactName: '   ' })
      )
      const { portal } = await res.json()

      assert.strictEqual(portal.contactName, null)
    })

    it('kolor jest normalizowany do #rrggbb', async () => {
      const res = await portalsPATCH(
        wyslij('/api/admin/portals', 'PATCH', { slug: portalA.slug, brandColor: 'ABC' })
      )
      const { portal } = await res.json()

      assert.strictEqual(portal.brandColor, '#aabbcc')
    })

    it('kolor spoza formatu -> 400, bez zapisu', async () => {
      const res = await portalsPATCH(
        wyslij('/api/admin/portals', 'PATCH', { slug: portalA.slug, brandColor: 'red; background:url(x)' })
      )

      // Wartosc lezy potem w atrybucie `style` na stronie klienta, wiec
      // wpuszczamy WYLACZNIE cyfry szesnastkowe. Walidacja musi byc tutaj,
      // bo curl z tokenem omija panel w calosci.
      assert.strictEqual(res.status, 400)
      const [wiersz] = await db.select().from(portals).where(eq(portals.id, portalA.id))
      assert.strictEqual(wiersz.brandColor, '#c8a24a', 'stara wartosc zostala')
    })

    it('logo w postaci javascript: -> 400', async () => {
      const res = await portalsPATCH(
        wyslij('/api/admin/portals', 'PATCH', { slug: portalA.slug, logoUrl: 'javascript:alert(1)' })
      )
      assert.strictEqual(res.status, 400)
    })

    it('domeny SitePinga ze schematem -> 400', async () => {
      const res = await portalsPATCH(
        wyslij('/api/admin/portals', 'PATCH', { slug: portalA.slug, siteDomains: 'https://wdf.important.is' })
      )

      // Porownujemy je z HOSTEM z naglowka Origin, wiec wpis ze schematem nigdy
      // by nie pasowal i SitePing milczalby bez zadnego sygnalu.
      assert.strictEqual(res.status, 400)
    })

    it('domeny sa normalizowane do malych liter i przycinane', async () => {
      const res = await portalsPATCH(
        wyslij('/api/admin/portals', 'PATCH', { slug: portalA.slug, siteDomains: ' WDF.important.IS , demo.pl ' })
      )
      const { portal } = await res.json()

      assert.strictEqual(portal.siteDomains, 'wdf.important.is,demo.pl')
    })

    it('nieznane pole -> 400, nie ciche pominiecie', async () => {
      const res = await portalsPATCH(
        wyslij('/api/admin/portals', 'PATCH', { slug: portalA.slug, isAdmin: true })
      )
      assert.strictEqual(res.status, 400)
    })

    it('zadanie bez zadnego pola do zmiany -> 400', async () => {
      const res = await portalsPATCH(wyslij('/api/admin/portals', 'PATCH', { slug: portalA.slug }))
      assert.strictEqual(res.status, 400)
    })

    it('nieistniejacy projekt -> 404', async () => {
      const res = await portalsPATCH(
        wyslij('/api/admin/portals', 'PATCH', { slug: 'nie-ma-takiego', isActive: false })
      )
      assert.strictEqual(res.status, 404)
    })
  })

  describe.skipIf(!maToken)('POST /api/admin/portals (nowy projekt)', () => {
    it('zaklada projekt z listami; PIERWSZA lista jest domyslna', async () => {
      const slug = `nowy-${Math.random().toString(36).slice(2, 8)}`
      let utworzony: string | undefined
      try {
        const res = await portalsPOST(
          wyslij('/api/admin/portals', 'POST', {
            name: 'Nowy Projekt',
            slug,
            clickupFolderId: '123456',
            lists: [
              { clickupListId: 'l-1', displayName: 'Zadania' },
              { clickupListId: 'l-2', displayName: 'Backlog' },
            ],
          })
        )
        const { portal } = await res.json()
        utworzony = portal.id

        assert.strictEqual(res.status, 201)
        const listy = await db.select().from(portalLists).where(eq(portalLists.portalId, portal.id))
        const domyslne = listy.filter(l => l.isDefault)
        // Portal bez domyslnej listy nie ma gdzie zakladac zadan z formularza,
        // wiec pierwsza jest nia zawsze, niezaleznie od tego, co przyslano.
        assert.strictEqual(domyslne.length, 1)
        assert.strictEqual(domyslne[0].clickupListId, 'l-1')
      } finally {
        if (utworzony) await dropTestPortal(utworzony)
      }
    })

    it('slug wielkimi literami -> 400', async () => {
      const res = await portalsPOST(
        wyslij('/api/admin/portals', 'POST', {
          name: 'X', slug: 'Wielkie-Litery', clickupFolderId: '1',
          lists: [{ clickupListId: 'l', displayName: 'L' }],
        })
      )

      // Slug jest czescia adresu portalu klienta, wiec musi byc jednoznaczny.
      assert.strictEqual(res.status, 400)
    })

    it('projekt BEZ list -> 400', async () => {
      const res = await portalsPOST(
        wyslij('/api/admin/portals', 'POST', {
          name: 'X', slug: `bez-list-${Math.random().toString(36).slice(2, 6)}`,
          clickupFolderId: '1', lists: [],
        })
      )
      assert.strictEqual(res.status, 400)
    })

    it('powtorzony slug -> 409, bez nadpisania istniejacego', async () => {
      const res = await portalsPOST(
        wyslij('/api/admin/portals', 'POST', {
          name: 'Podszywka', slug: portalA.slug, clickupFolderId: '999',
          lists: [{ clickupListId: 'l', displayName: 'L' }],
        })
      )

      assert.strictEqual(res.status, 409)
      const [wiersz] = await db.select().from(portals).where(eq(portals.id, portalA.id))
      assert.notStrictEqual(wiersz.clickupFolderId, '999', 'istniejacy projekt nietkniety')
    })

    it('identyfikator folderu wyciagany z adresu ClickUpa', async () => {
      const slug = `z-url-${Math.random().toString(36).slice(2, 8)}`
      let utworzony: string | undefined
      try {
        const res = await portalsPOST(
          wyslij('/api/admin/portals', 'POST', {
            name: 'Z URL',
            slug,
            clickupFolderUrl: 'https://app.clickup.com/4552118/v/f/90121639332/90100136256',
            lists: [{ clickupListId: 'l', displayName: 'L' }],
          })
        )
        const { portal } = await res.json()
        utworzony = portal?.id

        assert.strictEqual(res.status, 201)
        assert.strictEqual(portal.clickupFolderId, '90121639332')
      } finally {
        if (utworzony) await dropTestPortal(utworzony)
      }
    })
  })

  describe.skipIf(!maToken)('linki projektu', () => {
    it('PUT podmienia CALY zestaw i odrzuca puste wiersze', async () => {
      await linksPUT(
        wyslij('/api/admin/portal-links', 'PUT', {
          slug: portalA.slug,
          links: [
            { label: 'Figma', url: 'https://figma.com/x' },
            { label: '', url: '' },
            { label: 'Analytics', url: 'https://analytics.example' },
          ],
        })
      )

      const res = await linksGET(zTokenem(`/api/admin/portal-links?slug=${portalA.slug}`))
      const { links } = await res.json()

      // Panel pozwala dodac pusty wiersz i to normalne, ze czesc zostanie
      // niewypelniona — odrzucamy je po cichu, zamiast wywalac cala zmiane.
      assert.strictEqual(links.length, 2)
      assert.deepStrictEqual(links.map((l: { label: string }) => l.label), ['Figma', 'Analytics'])
    })

    it('pusta lista czysci wszystkie linki', async () => {
      await linksPUT(wyslij('/api/admin/portal-links', 'PUT', { slug: portalA.slug, links: [] }))

      const { links } = await (await linksGET(zTokenem(`/api/admin/portal-links?slug=${portalA.slug}`))).json()
      assert.strictEqual(links.length, 0)
    })
  })

  describe.skipIf(!maToken)('folder ClickUpa i historia osoby', () => {
    it('lista folderow sprowadza odpowiedz do id i nazwy', async () => {
      fetchMock.mockResolvedValue(
        new Response(JSON.stringify({
          folders: [{ id: '1', name: 'Onyx', tajne: 'nie-nasza-sprawa', lists: [] }],
        }))
      )

      const res = await foldersGET(zTokenem('/api/admin/clickup/folders'))
      const { folders } = await res.json()

      assert.deepStrictEqual(folders, [{ id: '1', name: 'Onyx' }])
    })

    it('listy folderu tez sa sprowadzane do id i nazwy', async () => {
      fetchMock.mockResolvedValue(
        new Response(JSON.stringify({
          lists: [{ id: '9', name: 'Zadania', task_count: 12, statuses: [] }],
        }))
      )

      const res = await listsGET(
        zTokenem('/api/admin/clickup/folders/123/lists'),
        { params: Promise.resolve({ folderId: '123' }) }
      )
      const { lists } = await res.json()

      // Odpowiedz ClickUpa niesie duzo wiecej pol; do panelu ida tylko te dwa.
      assert.deepStrictEqual(lists, [{ id: '9', name: 'Zadania' }])
      assert.match(fetchMock.mock.calls[0][0] as string, /folder\/123\/list/)
    })

    it('historia osoby laczy konto, zdarzenia i maile', async () => {
      const email = `hist-${Math.random().toString(36).slice(2, 8)}@example.com`
      const userId = await createTestUserWithPassword({
        portalId: portalA.id, email, password: 'jakies-haslo-1',
      })
      await db.insert(mailLog).values({
        portalId: portalA.id, recipient: email, subject: 'Zaproszenie', kind: 'invite', ok: true,
      })

      const res = await activityGET(
        zTokenem(`/api/admin/users/${userId}/activity`),
        { params: Promise.resolve({ userId }) }
      )
      const body = await res.json()

      assert.strictEqual(res.status, 200)
      assert.strictEqual(body.user.email, email)
      // Maile ida po ADRESIE (w obrebie projektu), nie po user_id: konto mozna
      // usunac i zalozyc ponownie, a to dalej ta sama osoba i ta sama historia
      // wspolpracy. Pole nazywa sie `mail`, nie `mails`.
      assert.ok(body.mail.some((m: { subject: string }) => m.subject === 'Zaproszenie'))
    })

    it('nieistniejaca osoba -> 404', async () => {
      const brak = '00000000-0000-0000-0000-000000000000'
      const res = await activityGET(
        zTokenem(`/api/admin/users/${brak}/activity`),
        { params: Promise.resolve({ userId: brak }) }
      )
      assert.strictEqual(res.status, 404)
    })
  })

  /**
   * POTWIERDZENIE ALARMU. Trasa PUBLICZNA, autoryzowana tokenem z maila.
   * Odpowiada HTML-em, wiec kod stanu nie niesie wyniku — czytamy tresc.
   */
  describe('GET /api/panic/[id]/ack', () => {
    async function alarm(): Promise<{ id: string; token: string }> {
      const [wiersz] = await db.insert(panicAlerts).values({
        portalId: portalA.id,
        userEmail: 'klient@example.com',
        userName: 'Klient',
        message: 'strona lezy',
        ackToken: `tok-${Math.random().toString(36).slice(2, 12)}`,
      }).returning()
      return { id: wiersz.id, token: wiersz.ackToken }
    }

    it('poprawny token oznacza alarm jako podjety', async () => {
      const a = await alarm()

      const res = await ackGET(
        req(`/api/panic/${a.id}/ack?token=${a.token}`),
        { params: Promise.resolve({ id: a.id }) }
      )
      const html = await res.text()

      assert.match(html, /Potwierdzono/)
      const [wiersz] = await db.select().from(panicAlerts).where(eq(panicAlerts.id, a.id))
      assert.ok(wiersz.acknowledgedAt, 'znacznik zapisany w bazie, nie tylko na ekranie')
    })

    it('ZLY token nie potwierdza alarmu', async () => {
      const a = await alarm()

      const res = await ackGET(
        req(`/api/panic/${a.id}/ack?token=zgadywany`),
        { params: Promise.resolve({ id: a.id }) }
      )
      const html = await res.text()

      // Bez tego kazdy, kto zna identyfikator alarmu, mogl by go „odklikac",
      // a zespol uznalby, ze ktos sie tym zajmuje.
      assert.match(html, /nieważny|Błąd/i)
      const [wiersz] = await db.select().from(panicAlerts).where(eq(panicAlerts.id, a.id))
      assert.strictEqual(wiersz.acknowledgedAt, null)
    })

    it('BEZ tokenu nie potwierdza', async () => {
      const a = await alarm()

      const html = await (await ackGET(
        req(`/api/panic/${a.id}/ack`),
        { params: Promise.resolve({ id: a.id }) }
      )).text()

      assert.match(html, /Brakuje tokenu/)
      const [wiersz] = await db.select().from(panicAlerts).where(eq(panicAlerts.id, a.id))
      assert.strictEqual(wiersz.acknowledgedAt, null)
    })

    it('token od INNEGO alarmu nie dziala', async () => {
      const a = await alarm()
      const b = await alarm()

      const html = await (await ackGET(
        req(`/api/panic/${a.id}/ack?token=${b.token}`),
        { params: Promise.resolve({ id: a.id }) }
      )).text()

      assert.match(html, /nieważny|Błąd/i)
    })

    it('drugie klikniecie NIE nadpisuje kto i kiedy potwierdzil', async () => {
      const a = await alarm()
      await ackGET(req(`/api/panic/${a.id}/ack?token=${a.token}`), { params: Promise.resolve({ id: a.id }) })
      const [pierwsze] = await db.select().from(panicAlerts).where(eq(panicAlerts.id, a.id))

      const html = await (await ackGET(
        req(`/api/panic/${a.id}/ack?token=${a.token}`),
        { params: Promise.resolve({ id: a.id }) }
      )).text()

      assert.match(html, /już potwierdzony/i)
      const [drugie] = await db.select().from(panicAlerts).where(eq(panicAlerts.id, a.id))
      // Czas pierwszej reakcji jest tym, co potem tlumaczymy klientowi.
      assert.strictEqual(drugie.acknowledgedAt?.getTime(), pierwsze.acknowledgedAt?.getTime())
    })

    it('tresc alarmu w HTML-u jest escapowana', async () => {
      const [wiersz] = await db.insert(panicAlerts).values({
        portalId: portalA.id,
        userEmail: 'k@example.com',
        message: '<img src=x onerror=alert(1)>',
        ackToken: `tok-xss-${Math.random().toString(36).slice(2, 8)}`,
      }).returning()

      const html = await (await ackGET(
        req(`/api/panic/${wiersz.id}/ack?token=${wiersz.ackToken}`),
        { params: Promise.resolve({ id: wiersz.id }) }
      )).text()

      // Tresc pochodzi od klienta i lezy na stronie, ktora otwiera NASZ zespol
      // z maila, wiec musi byc obojetna.
      assert.ok(!html.includes('<img src=x'), 'surowy znacznik nie trafil do strony')
      assert.ok(html.includes('&lt;img'), 'tresc jest widoczna, ale escapowana')
    })
  })
})
