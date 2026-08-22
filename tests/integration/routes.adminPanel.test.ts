import { describe, it, beforeAll, afterAll, beforeEach, vi } from 'vitest'
import assert from 'node:assert'
import { eq } from 'drizzle-orm'
import { db } from '@/lib/db'
import { portals, portalLists, mailLog, taskStatusHistory } from '@/lib/db/schema'
import {
  isDbReachable,
  createTestPortal,
  dropTestPortal,
  createTestUserWithPassword,
} from './helpers'

/**
 * RESZTA PANELU ADMINA.
 *
 * Zamyka liste dziur z docs/testing.md. Dwie rzeczy sa tu warte uwagi ponad
 * zwykly perymetr:
 *
 * 1. PATCH portalu ma za soba realny blad: transformacja Zoda zamieniala pole
 *    NIEOBECNE w zadaniu na `null`, a `set()` sumiennie zerowalo kolor, logo
 *    i kontakt przy KAZDYM przelaczeniu zwyklej flagi. Test pilnuje roznicy
 *    miedzy „nie przyslano" a „przyslano null".
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
import { GET as portalTagsGET } from '@/app/api/admin/portals/tags/route'
import { GET as linksGET, PUT as linksPUT } from '@/app/api/admin/portal-links/route'
import { GET as eventsGET } from '@/app/api/admin/portal-events/route'
import { GET as mailLogGET } from '@/app/api/admin/mail-log/route'
import { GET as syncGET } from '@/app/api/admin/portal-sync/route'
import { GET as foldersGET } from '@/app/api/admin/clickup/folders/route'
import { GET as listsGET } from '@/app/api/admin/clickup/folders/[folderId]/lists/route'
import { GET as activityGET } from '@/app/api/admin/users/[userId]/activity/route'

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
      ['GET /admin/portals/tags', () => portalTagsGET(req('/api/admin/portals/tags?spaceId=1'))],
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

    it('GET /admin/portals/tags bez uprawnien NIE woła ClickUpa', async () => {
      await portalTagsGET(req('/api/admin/portals/tags?spaceId=1'))

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

  describe.skipIf(!maToken)('log synchronizacji niesie TEZ historie statusow', () => {
    it('odpowiedz zawiera pole `statusy`, nawet gdy jest puste', async () => {
      const res = await syncGET(zTokenem(`/api/admin/portal-sync?slug=${portalA.slug}`))
      const body = await res.json()

      // Brak pola i pusta tablica to dwie rozne rzeczy dla komponentu: przy
      // braku widok wywalilby sie na `.map`, przy pustej pokaze komunikat.
      assert.ok(Array.isArray(body.statusy), 'pole `statusy` jest tablica')
    })

    it('zapisana zmiana statusu pojawia sie w logu', async () => {
      await db.insert(taskStatusHistory).values({
        portalId: portalA.id,
        clickupTaskId: 'zad-log-1',
        taskName: 'Zadanie z logu',
        fromStatus: 'do zrobienia',
        toStatus: 'w trakcie',
        source: 'portal',
        actorLabel: 'Anna Klient',
      })

      const res = await syncGET(zTokenem(`/api/admin/portal-sync?slug=${portalA.slug}`))
      const body = await res.json()

      const wpis = body.statusy.find((z: { clickupTaskId: string }) => z.clickupTaskId === 'zad-log-1')
      assert.ok(wpis, 'zmiana widoczna w logu')
      assert.strictEqual(wpis.fromStatus, 'do zrobienia')
      assert.strictEqual(wpis.toStatus, 'w trakcie')
      assert.strictEqual(wpis.actorLabel, 'Anna Klient')
      assert.strictEqual(wpis.source, 'portal')
    })

    it('historia INNEGO projektu nie wchodzi do logu', async () => {
      const portalC = await createTestPortal('log-obcy')
      try {
        await db.insert(taskStatusHistory).values({
          portalId: portalC.id,
          clickupTaskId: 'zad-obce',
          taskName: 'Cudze',
          toStatus: 'zamkniete',
          source: 'webhook',
        })

        const res = await syncGET(zTokenem(`/api/admin/portal-sync?slug=${portalA.slug}`))
        const body = await res.json()

        assert.ok(
          !body.statusy.some((z: { clickupTaskId: string }) => z.clickupTaskId === 'zad-obce'),
          'log projektu A nie pokazuje zmian projektu C'
        )
      } finally {
        await dropTestPortal(portalC.id)
      }
    })
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

    it('autoTags zapisuje sie jako tekst po przecinku, deduplikowany', async () => {
      const res = await portalsPATCH(
        wyslij('/api/admin/portals', 'PATCH', { slug: portalA.slug, autoTags: ['asana', 'portal', 'asana'] })
      )
      const { portal } = await res.json()

      assert.strictEqual(res.status, 200)
      assert.strictEqual(portal.autoTags, 'asana,portal')
      assert.strictEqual(portal.brandColor, '#c8a24a', 'kolor nietkniety przy okazji')
    })

    it('pusta tablica autoTags czysci pole (null, nie pusty string)', async () => {
      await portalsPATCH(wyslij('/api/admin/portals', 'PATCH', { slug: portalA.slug, autoTags: ['asana'] }))

      const res = await portalsPATCH(wyslij('/api/admin/portals', 'PATCH', { slug: portalA.slug, autoTags: [] }))
      const { portal } = await res.json()

      assert.strictEqual(portal.autoTags, null)
    })

    it('statusControlsEnabled da sie wlaczyc i wylaczyc, bez wplywu na inne pola', async () => {
      const wlacz = await portalsPATCH(
        wyslij('/api/admin/portals', 'PATCH', { slug: portalA.slug, statusControlsEnabled: true })
      )
      const { portal: wlaczony } = await wlacz.json()
      assert.strictEqual(wlaczony.statusControlsEnabled, true)
      assert.strictEqual(wlaczony.brandColor, '#c8a24a', 'kolor nietkniety')

      const wylacz = await portalsPATCH(
        wyslij('/api/admin/portals', 'PATCH', { slug: portalA.slug, statusControlsEnabled: false })
      )
      const { portal: wylaczony } = await wylacz.json()
      assert.strictEqual(wylaczony.statusControlsEnabled, false)
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
   * TAGI PRZESTRZENI. Zrodlo checkboxow autoTags w panelu — admin ma wybierac
   * z tagow, ktore NAPRAWDE istnieja w ClickUpie, zeby nie dalo sie zapisac
   * literowki, ktorej ClickUp i tak cicho nie zastosuje przy tworzeniu zadania.
   */
  describe.skipIf(!maToken)('GET /api/admin/portals/tags', () => {
    it('bez ?spaceId -> 400', async () => {
      const res = await portalTagsGET(zTokenem('/api/admin/portals/tags'))
      assert.strictEqual(res.status, 400)
    })

    it('sprowadza odpowiedz ClickUpa do samych nazw tagow', async () => {
      fetchMock.mockResolvedValue(
        new Response(JSON.stringify({
          tags: [{ name: 'asana', tag_fg: '#fff', tag_bg: '#000' }, { name: 'portal' }],
        }))
      )

      const res = await portalTagsGET(zTokenem('/api/admin/portals/tags?spaceId=90100136256'))
      const { tags } = await res.json()

      assert.strictEqual(res.status, 200)
      assert.deepStrictEqual(tags, ['asana', 'portal'])
      assert.match(fetchMock.mock.calls[0][0] as string, /space\/90100136256\/tag/)
    })

    it('ClickUp nie odpowiada -> 502, nie 500 bez wyjasnienia', async () => {
      fetchMock.mockRejectedValue(new Error('siec padla'))

      const res = await portalTagsGET(zTokenem('/api/admin/portals/tags?spaceId=90100136256'))

      assert.strictEqual(res.status, 502)
    })
  })
})
