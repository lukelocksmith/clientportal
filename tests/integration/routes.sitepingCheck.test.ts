import { describe, it, beforeAll, afterAll, beforeEach, vi } from 'vitest'
import assert from 'node:assert'
import { eq } from 'drizzle-orm'
import { isDbReachable, createTestPortal, dropTestPortal } from './helpers'

/**
 * TEST POLACZENIA SitePinga — trasa, ktora odpowiada na „czemu klientowi nie
 * dziala".
 *
 * Wlasny blad tego testu jest kosztowny w obie strony, wiec plik pilnuje
 * przede wszystkim dwoch rzeczy, ktorych czysty modul `lib/siteping/check.ts`
 * sprawdzic nie moze:
 *
 * 1. ZADNE POJEDYNCZE SPRAWDZENIE NIE MOZE ZABRAC POZOSTALYCH. Niedostepny
 *    ClickUp albo martwa strona klienta nie moga ukryc informacji, ze domeny
 *    sa puste — a to wlasnie ona najczesciej jest odpowiedzia.
 * 2. HISTORIA ZGLOSZEN NIE WYCIEKA MIEDZY PORTALAMI. Zgloszenie u klienta A
 *    nie moze zazielenic wyniku klienta B.
 *
 * `ADMIN_API_TOKEN` ustawiamy w `vi.hoisted`, bo `apiAuth` czyta `process.env`
 * przy wywolaniu, ale brama i tak musi byc sprawdzona NAPRAWDE, a nie
 * zamockowana: to jedyna granica miedzy panelem a swiatem.
 *
 *   docker start cp-test-pg && npm run test:integration
 */
const TOKEN = 'token-testowy-check'

const { poprzedniToken, clickup } = vi.hoisted(() => {
  const poprzedni = process.env.ADMIN_API_TOKEN
  process.env.ADMIN_API_TOKEN = 'token-testowy-check'
  return { poprzedniToken: poprzedni, clickup: { getSpaceTags: vi.fn() } }
})

vi.mock('@/lib/clickup', () => clickup)

/**
 * PUSTY sloik ciasteczek, nie obejscie bramy.
 *
 * `isAdminRequest` po nieudanym tokenie siega po sesje admina, a `cookies()`
 * z Next wymaga kontekstu zadania, ktorego w Vitescie nie ma — bez tego mocka
 * testy odmowy koncza sie WYJATKIEM, a nie sprawdzanym 401. Sloik jest pusty,
 * wiec sciezka sesyjna zwraca „brak sesji", czyli dokladnie to, co ma zwrocic
 * dla kogos bez ciasteczka. Token nadal weryfikuje prawdziwy `verifyToken`.
 */
vi.mock('next/headers', () => ({
  cookies: async () => ({ get: () => undefined }),
}))

import { NextRequest } from 'next/server'
import { db } from '@/lib/db'
import { portals, auditLog } from '@/lib/db/schema'
import { EVENT_TASK_CREATED } from '@/lib/portalEvents'
import { REQUIRED_TAGS } from '@/lib/siteping/check'
import { GET } from '@/app/api/admin/siteping/check/route'

const dbUp = await isDbReachable()

type Wiersz = { key: string; label: string; state: string; detail: string }

function zapytanie(slug: string | null, token: string | null = TOKEN): NextRequest {
  const url = slug
    ? `http://localhost/api/admin/siteping/check?slug=${slug}`
    : 'http://localhost/api/admin/siteping/check'
  return new NextRequest(url, {
    headers: token ? { authorization: `Bearer ${token}` } : {},
  } as ConstructorParameters<typeof NextRequest>[1])
}

async function wiersze(slug: string): Promise<Wiersz[]> {
  const res = await GET(zapytanie(slug))
  assert.strictEqual(res.status, 200)
  return (await res.json()).rows
}

const znajdz = (rows: Wiersz[], key: string): Wiersz => {
  const w = rows.find(r => r.key === key)
  assert.ok(w, `brak wiersza ${key} w wyniku: ${rows.map(r => r.key).join(', ')}`)
  return w
}

/** Odpowiedz udajaca strone klienta z osadzonym widgetem. */
function stronaZWidgetem(): Response {
  return new Response('<html><body><script src="/siteping/widget.js"></script></body></html>', {
    status: 200,
    headers: { 'content-type': 'text/html' },
  })
}

describe.skipIf(!dbUp)('test polaczenia SitePinga na prawdziwej bazie', () => {
  let portal: { id: string; slug: string }
  let obcy: { id: string; slug: string }
  const fetchMock = vi.fn()

  beforeAll(async () => {
    portal = await createTestPortal('spcheck')
    obcy = await createTestPortal('spobcy')
  })

  afterAll(async () => {
    await dropTestPortal(portal.id)
    await dropTestPortal(obcy.id)
    if (poprzedniToken === undefined) delete process.env.ADMIN_API_TOKEN
    else process.env.ADMIN_API_TOKEN = poprzedniToken
  })

  beforeEach(async () => {
    vi.clearAllMocks()
    vi.stubGlobal('fetch', fetchMock)
    fetchMock.mockResolvedValue(stronaZWidgetem())
    clickup.getSpaceTags.mockResolvedValue([...REQUIRED_TAGS])

    // Stan wyjsciowy: funkcja wlaczona, jedna domena, czysta historia.
    await db
      .update(portals)
      .set({ sitepingEnabled: true, siteDomains: 'demo.example' })
      .where(eq(portals.id, portal.id))
    await db.delete(auditLog).where(eq(auditLog.portalId, portal.id))
    await db.delete(auditLog).where(eq(auditLog.portalId, obcy.id))
  })

  describe('brama', () => {
    it('bez tokenu odmawia', async () => {
      assert.strictEqual((await GET(zapytanie(portal.slug, null))).status, 401)
    })

    it('zly token odmawia', async () => {
      assert.strictEqual((await GET(zapytanie(portal.slug, 'nie-ten'))).status, 401)
    })

    it('z poprawnym tokenem przechodzi', async () => {
      // Bez tego dowodu dwa testy wyzej przechodzilyby takze wtedy, gdyby
      // trasa odmawiala WSZYSTKIM z dowolnego innego powodu.
      assert.strictEqual((await GET(zapytanie(portal.slug))).status, 200)
    })

    it('brak sluga to 400, nieznany portal to 404', async () => {
      assert.strictEqual((await GET(zapytanie(null))).status, 400)
      assert.strictEqual((await GET(zapytanie('nie-ma-takiego'))).status, 404)
    })
  })

  describe('konfiguracja z bazy', () => {
    it('wylaczona flaga daje `fail`, mowiac co to znaczy', async () => {
      await db.update(portals).set({ sitepingEnabled: false }).where(eq(portals.id, portal.id))

      const w = znajdz(await wiersze(portal.slug), 'flaga')
      assert.strictEqual(w.state, 'fail')
      assert.match(w.detail, /odrzuca/)
    })

    it('puste domeny daja `fail` i ZERO wierszy o widgecie', async () => {
      // Sprawdzanie widgetu bez domen nie ma na czym pracowac; wiersz „nie
      // udalo sie" wygladalby na awarie strony klienta, a problem jest u nas.
      await db.update(portals).set({ siteDomains: null }).where(eq(portals.id, portal.id))

      const rows = await wiersze(portal.slug)
      assert.strictEqual(znajdz(rows, 'domeny').state, 'fail')
      assert.strictEqual(rows.filter(r => r.key.startsWith('widget:')).length, 0)
      assert.strictEqual(fetchMock.mock.calls.length, 0, 'nie wychodzimy na zewnatrz bez domen')
    })

    it('KAZDA domena dostaje wlasny wiersz, nie tylko pierwsza', async () => {
      // Produkcja i staging: widget na jednej, brak na drugiej to typowy stan
      // po wdrozeniu i dokladnie to, co ten test ma wylapywac.
      await db
        .update(portals)
        .set({ siteDomains: 'demo.example, staging.demo.example' })
        .where(eq(portals.id, portal.id))

      const rows = await wiersze(portal.slug)
      assert.strictEqual(rows.filter(r => r.key.startsWith('widget:')).length, 2)
    })
  })

  describe('tagi w ClickUpie', () => {
    it('komplet tagow daje `ok`', async () => {
      assert.strictEqual(znajdz(await wiersze(portal.slug), 'tagi').state, 'ok')
    })

    it('brakujace tagi sa WYMIENIONE z nazwy', async () => {
      // „Brakuje tagow" bez listy kaze szukac po omacku w przestrzeni klienta.
      clickup.getSpaceTags.mockResolvedValue(['siteping', 'błąd'])

      const w = znajdz(await wiersze(portal.slug), 'tagi')
      assert.strictEqual(w.state, 'fail')
      assert.match(w.detail, /zmiana/)
      assert.match(w.detail, /pytanie/)
    })

    it('bledny ClickUp daje `unknown`, NIE `fail`', async () => {
      clickup.getSpaceTags.mockRejectedValue(new Error('ClickUp API error 500'))

      assert.strictEqual(znajdz(await wiersze(portal.slug), 'tagi').state, 'unknown')
    })

    it('bledny ClickUp NIE zabiera pozostalych sprawdzen', async () => {
      // To jest sedno „jedno nieudane nie przerywa pozostalych": odpowiedz
      // musi nadal powiedziec, czy flaga i domeny sa w porzadku.
      clickup.getSpaceTags.mockRejectedValue(new Error('padlo'))

      const rows = await wiersze(portal.slug)
      assert.strictEqual(znajdz(rows, 'flaga').state, 'ok')
      assert.strictEqual(znajdz(rows, 'domeny').state, 'ok')
      assert.strictEqual(rows.filter(r => r.key.startsWith('widget:')).length, 1)
    })
  })

  describe('widget na stronie klienta', () => {
    it('pobiera adres Z PARAMETREM ?siteping=1', async () => {
      // Bez parametru mu-plugin nie osadzi widgetu i wynik bylby „nie ma"
      // u kazdego poprawnie skonfigurowanego klienta.
      await wiersze(portal.slug)

      assert.strictEqual(String(fetchMock.mock.calls[0][0]), 'https://demo.example/?siteping=1')
    })

    it('widoczny skrypt daje `ok`', async () => {
      assert.strictEqual(znajdz(await wiersze(portal.slug), 'widget:demo.example').state, 'ok')
    })

    it('strona bez skryptu i bez historii daje `fail`', async () => {
      fetchMock.mockResolvedValue(new Response('<html><body>nic</body></html>', { status: 200 }))

      assert.strictEqual(znajdz(await wiersze(portal.slug), 'widget:demo.example').state, 'fail')
    })

    it('niedostepna strona daje `unknown`, nigdy `fail`', async () => {
      fetchMock.mockRejectedValue(new Error('ECONNREFUSED'))

      const w = znajdz(await wiersze(portal.slug), 'widget:demo.example')
      assert.strictEqual(w.state, 'unknown')
    })

    it('blad HTTP strony klienta daje `unknown` z kodem', async () => {
      fetchMock.mockResolvedValue(new Response('nie ma', { status: 503 }))

      const w = znajdz(await wiersze(portal.slug), 'widget:demo.example')
      assert.strictEqual(w.state, 'unknown')
      assert.match(w.detail, /503/)
    })

    it('idzie za przekierowaniem W OBREBIE domeny', async () => {
      // http → https i dopisanie www to najczestsze przekierowania w sieci.
      fetchMock
        .mockResolvedValueOnce(
          new Response(null, { status: 301, headers: { location: 'https://www.demo.example/' } })
        )
        .mockResolvedValueOnce(stronaZWidgetem())

      assert.strictEqual(znajdz(await wiersze(portal.slug), 'widget:demo.example').state, 'ok')
      assert.strictEqual(fetchMock.mock.calls.length, 2)
    })

    it('ZATRZYMUJE sie na przekierowaniu poza liste domen', async () => {
      // Test wychodzi na cudza infrastrukture; bez tej granicy klikniecie
      // admina daloby sie poprowadzic gdziekolwiek.
      fetchMock.mockResolvedValueOnce(
        new Response(null, { status: 302, headers: { location: 'https://gdzie-indziej.example/' } })
      )

      const w = znajdz(await wiersze(portal.slug), 'widget:demo.example')
      assert.strictEqual(w.state, 'unknown')
      assert.match(w.detail, /poza listę domen/)
      assert.strictEqual(fetchMock.mock.calls.length, 1, 'nie wolno wykonac drugiego zadania')
    })

    it('petla przekierowan konczy sie sama', async () => {
      fetchMock.mockResolvedValue(
        new Response(null, { status: 302, headers: { location: 'https://demo.example/' } })
      )

      const w = znajdz(await wiersze(portal.slug), 'widget:demo.example')
      assert.strictEqual(w.state, 'unknown')
      assert.ok(fetchMock.mock.calls.length <= 5, `za duzo prob: ${fetchMock.mock.calls.length}`)
    })
  })

  describe('historia zgloszen jako drugi sygnal', () => {
    async function dopiszZgloszenie(portalId: string) {
      await db.insert(auditLog).values({
        portalId,
        action: EVENT_TASK_CREATED,
        meta: JSON.stringify({ source: 'siteping', taskName: 'Testowe', url: '/' }),
      })
    }

    it('zamienia `fail` na `unknown`, gdy zgloszenia przychodzily', async () => {
      // Widget wstrzykiwany przez GTM nie pojawi sie w pobranym HTML. Krzyzyk
      // wyslalby zespol naprawiac cos, co dziala.
      fetchMock.mockResolvedValue(new Response('<html>nic</html>', { status: 200 }))
      await dopiszZgloszenie(portal.id)

      const w = znajdz(await wiersze(portal.slug), 'widget:demo.example')
      assert.strictEqual(w.state, 'unknown')
      assert.match(w.detail, /przeglądarki/)
    })

    it('zgloszenie OBCEGO portalu nie zmienia wyniku', async () => {
      fetchMock.mockResolvedValue(new Response('<html>nic</html>', { status: 200 }))
      await dopiszZgloszenie(obcy.id)

      assert.strictEqual(znajdz(await wiersze(portal.slug), 'widget:demo.example').state, 'fail')
    })

    it('zdarzenie spoza SitePinga nie liczy sie jako zgloszenie z widgetu', async () => {
      // Zadanie zalozone przez klienta w portalu tez jest `task_created`,
      // ale nie dowodzi, ze widget na stronie dziala.
      fetchMock.mockResolvedValue(new Response('<html>nic</html>', { status: 200 }))
      await db.insert(auditLog).values({
        portalId: portal.id,
        action: EVENT_TASK_CREATED,
        meta: JSON.stringify({ source: 'portal', taskName: 'Z portalu' }),
      })

      assert.strictEqual(znajdz(await wiersze(portal.slug), 'widget:demo.example').state, 'fail')
    })
  })
})
