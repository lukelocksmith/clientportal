import { describe, it, beforeAll, afterAll, beforeEach, vi } from 'vitest'
import assert from 'node:assert'
import { eq } from 'drizzle-orm'
import { db } from '@/lib/db'
import { portals } from '@/lib/db/schema'
import { isDbReachable, createTestPortal, dropTestPortal, createTestList } from './helpers'

/**
 * TRASA SITEPINGA — jedyny endpoint portalu odpowiadajacy BEZ SESJI.
 *
 * `lib/siteping/*` ma wlasne testy jednostkowe, ale one nie widza tego, co jest
 * tu najwazniejsze: KOLEJNOSCI i WARUNKOW, w jakich trasa w ogole dopuszcza
 * kogokolwiek do sklepu z zadaniami ClickUpa.
 *
 * Trzy rzeczy, ktore ta trasa musi trzymac:
 *
 * 1. WYLACZONY portal odpowiada 404, nie 403. 403 potwierdzalby istnienie
 *    projektu komus, kto zgadl slug.
 * 2. KONTROLA DOMENY idzie PRZED limitem czestotliwosci. Odwrotna kolejnosc
 *    znaczylaby, ze obcy ruch zjada budzet nalezacy do realnego odwiedzajacego
 *    z tego samego IP (klienci siedza za wspolnym NAT-em firmy).
 * 3. GET i POST maja ROZDZIELNE kubelki. Jedna wizyta to kilka odczytow panelu
 *    i najwyzej jeden zapis, a to zapis tworzy zadanie w ClickUpie.
 *
 * Sklep (`store`) jest podstawiony: ma 38 wlasnych testow, a tutaj chodzi
 * o brame przed nim, nie o to, co robi za nia.
 *
 *   docker start cp-test-pg && npm run test:integration
 */
const { store } = vi.hoisted(() => ({
  store: {
    createFeedback: vi.fn(),
    getFeedbacks: vi.fn(),
    findByClientId: vi.fn(),
    updateFeedback: vi.fn(),
    deleteFeedback: vi.fn(),
    deleteAllFeedbacks: vi.fn(),
    verifyProjectOwnership: vi.fn(),
  },
}))

vi.mock('@/lib/siteping/store', () => ({
  createClickUpSitepingStore: vi.fn(() => store),
}))

import { NextRequest } from 'next/server'
import { resetRateLimits } from '@/lib/siteping/rateLimit'
import { POST, GET, OPTIONS } from '@/app/api/siteping/[slug]/route'

const dbUp = await isDbReachable()

const DOMENA = 'demo.example.test'

const params = (slug: string) => ({ params: Promise.resolve({ slug }) })

/**
 * Zgloszenie w ksztalcie, ktorego wymaga walidacja `@siteping/adapter-prisma`.
 *
 * Wszystkie te pola sa OBOWIAZKOWE — brak ktoregokolwiek konczy sie odpowiedzia
 * 400 z lista pol, zanim cokolwiek dojdzie do sklepu. Uwaga na `viewport`:
 * na gornym poziomie jest NAPISEM (np. "1280x800"), a wewnatrz anotacji
 * obiektem z liczbami. Dwa pola o tej samej nazwie i roznym typie w jednym
 * ladunku to gotowa pomylka.
 */
function zgloszenie(nadpisz: Record<string, unknown> = {}) {
  return {
    projectName: 'Test SitePing',
    type: 'bug' as const,
    message: 'cos nie dziala',
    url: `https://${DOMENA}/kontakt`,
    viewport: '1280x800',
    userAgent: 'vitest',
    authorName: 'Klient Testowy',
    authorEmail: 'klient@example.test',
    clientId: `c-${Math.random().toString(36).slice(2, 10)}`,
    annotations: [],
    ...nadpisz,
  }
}

/** Zadanie z widgetu: `Origin` i adres IP, bo od nich zalezy brama. */
function zadanie(slug: string, opts: {
  origin?: string | null
  ip?: string
  method?: string
  body?: unknown
} = {}): NextRequest {
  const headers: Record<string, string> = {
    'Content-Type': 'application/json',
    'x-forwarded-for': opts.ip ?? '203.0.113.1',
  }
  if (opts.origin !== null) headers.origin = opts.origin ?? `https://${DOMENA}`

  return new NextRequest(`http://localhost/api/siteping/${slug}`, {
    method: opts.method ?? 'POST',
    headers,
    body: opts.method === 'GET' || opts.method === 'OPTIONS'
      ? undefined
      : JSON.stringify(opts.body ?? zgloszenie()),
  } as ConstructorParameters<typeof NextRequest>[1])
}

describe.skipIf(!dbUp)('trasa SitePinga na prawdziwej bazie', () => {
  let wlaczony: { id: string; slug: string }
  let wylaczony: { id: string; slug: string }
  let bezDomen: { id: string; slug: string }
  let bezList: { id: string; slug: string }

  beforeAll(async () => {
    wlaczony = await createTestPortal('sp-on')
    wylaczony = await createTestPortal('sp-off')
    bezDomen = await createTestPortal('sp-nodom')
    bezList = await createTestPortal('sp-nolist')

    await createTestList({ portalId: wlaczony.id, clickupListId: 'lista-sp', isDefault: true })
    await createTestList({ portalId: bezDomen.id, clickupListId: 'lista-sp2', isDefault: true })

    await db.update(portals)
      .set({ sitepingEnabled: true, siteDomains: DOMENA })
      .where(eq(portals.id, wlaczony.id))
    // Flaga wlaczona, ale BEZ domen — konfiguracja niepelna.
    await db.update(portals)
      .set({ sitepingEnabled: true, siteDomains: null })
      .where(eq(portals.id, bezDomen.id))
    // Flaga i domeny sa, brakuje listy, wiec nie ma gdzie zalozyc zadania.
    await db.update(portals)
      .set({ sitepingEnabled: true, siteDomains: DOMENA })
      .where(eq(portals.id, bezList.id))
  })

  afterAll(async () => {
    for (const p of [wlaczony, wylaczony, bezDomen, bezList]) {
      if (p) await dropTestPortal(p.id)
    }
  })

  beforeEach(() => {
    vi.clearAllMocks()
    // Limit zyje w pamieci modulu, wiec bez tego test poprzedni zjadalby budzet
    // nastepnemu i porazka wygladalaby jak zle dzialajaca brama.
    resetRateLimits()
    store.createFeedback.mockResolvedValue({
      id: 'fb-1', clientId: 'c-1', message: 'cos nie dziala', url: `https://${DOMENA}/kontakt`,
      createdAt: new Date().toISOString(), status: 'open', annotations: [],
    })
    store.getFeedbacks.mockResolvedValue([])
  })

  describe('kiedy trasa w ogole istnieje', () => {
    it('portal BEZ wlaczonego SitePinga -> 404, nie 403', async () => {
      const res = await POST(zadanie(wylaczony.slug), params(wylaczony.slug))

      // 403 potwierdzalby istnienie projektu komus, kto zgadl slug.
      assert.strictEqual(res.status, 404)
      assert.strictEqual(store.createFeedback.mock.calls.length, 0)
    })

    it('nieistniejacy slug -> 404, tak samo jak wylaczony', async () => {
      const res = await POST(zadanie('nie-ma-takiego'), params('nie-ma-takiego'))

      // Ta sama odpowiedz co wyzej: nie da sie tym odroznic projektu
      // istniejacego od nieistniejacego.
      assert.strictEqual(res.status, 404)
    })

    it('flaga wlaczona, ale BEZ domen -> 404', async () => {
      const res = await POST(zadanie(bezDomen.slug), params(bezDomen.slug))

      // Bez listy domen nie da sie stwierdzic, skad wolno przyjmowac zgloszenia,
      // wiec konfiguracja niepelna znaczy wylaczone.
      assert.strictEqual(res.status, 404)
    })

    it('flaga i domeny sa, ale brak listy -> 404', async () => {
      const res = await POST(zadanie(bezList.slug), params(bezList.slug))

      // Nie ma gdzie zalozyc zadania, wiec przyjecie zgloszenia byloby
      // obietnica bez pokrycia.
      assert.strictEqual(res.status, 404)
    })
  })

  describe('kontrola domeny', () => {
    it('zgloszenie z DOZWOLONEJ domeny przechodzi do sklepu', async () => {
      const res = await POST(zadanie(wlaczony.slug), params(wlaczony.slug))

      assert.ok(res.status < 400, `oczekiwano przejscia, dostalem ${res.status}`)
      assert.strictEqual(store.createFeedback.mock.calls.length, 1)
    })

    it('zgloszenie z OBCEJ domeny -> 403 i sklep nietkniety', async () => {
      const res = await POST(
        zadanie(wlaczony.slug, { origin: 'https://zlodziej.example' }),
        params(wlaczony.slug)
      )

      assert.strictEqual(res.status, 403)
      assert.strictEqual(store.createFeedback.mock.calls.length, 0)
    })

    it('zadanie BEZ naglowka Origin i Referer -> 403', async () => {
      const res = await POST(zadanie(wlaczony.slug, { origin: null }), params(wlaczony.slug))

      // To jest ta droga, ktorej `allowedOrigins` w pakiecie NIE zamyka: CORS
      // jest mechanizmem przegladarki, wiec curl bez Origina przeszedlby tamtedy
      // nietkniety. Brama musi byc po naszej stronie.
      assert.strictEqual(res.status, 403)
      assert.strictEqual(store.createFeedback.mock.calls.length, 0)
    })

    it('poddomena dozwolonej domeny NIE przechodzi', async () => {
      const res = await POST(
        zadanie(wlaczony.slug, { origin: `https://zlo.${DOMENA}` }),
        params(wlaczony.slug)
      )

      // Porownujemy caly host, nie koncowke: inaczej ktokolwiek moglby zalozyc
      // poddomene i wysylac zadania w imieniu klienta.
      assert.strictEqual(res.status, 403)
    })

    it('wielkosc liter w domenie nie ma znaczenia', async () => {
      const res = await POST(
        zadanie(wlaczony.slug, { origin: `https://${DOMENA.toUpperCase()}` }),
        params(wlaczony.slug)
      )

      assert.ok(res.status < 400)
    })
  })

  describe('limit czestotliwosci', () => {
    it('POST ma budzet 10 na minute, jedenaste zadanie -> 429', async () => {
      const ip = '198.51.100.10'
      for (let i = 0; i < 10; i++) {
        const res = await POST(zadanie(wlaczony.slug, { ip }), params(wlaczony.slug))
        assert.ok(res.status < 400, `zgloszenie ${i + 1} powinno przejsc`)
      }

      const jedenaste = await POST(zadanie(wlaczony.slug, { ip }), params(wlaczony.slug))

      assert.strictEqual(jedenaste.status, 429)
      assert.strictEqual(store.createFeedback.mock.calls.length, 10, 'jedenaste NIE dotknelo sklepu')
    })

    /**
     * KOLEJNOSC BRAM. Ten test jest powodem, dla ktorego `publicGuard` sprawdza
     * domene przed limitem.
     */
    it('ruch z OBCEJ domeny NIE zjada budzetu prawdziwego odwiedzajacego', async () => {
      const ip = '198.51.100.20'
      for (let i = 0; i < 15; i++) {
        await POST(
          zadanie(wlaczony.slug, { ip, origin: 'https://zlodziej.example' }),
          params(wlaczony.slug)
        )
      }

      // Ten sam adres IP (klienci siedza za wspolnym NAT-em firmy), ale
      // tym razem z wlasciwej domeny.
      const uczciwy = await POST(zadanie(wlaczony.slug, { ip }), params(wlaczony.slug))

      assert.ok(uczciwy.status < 400, 'prawdziwy odwiedzajacy nie zostal ukarany za cudzy ruch')
    })

    it('GET i POST maja ROZDZIELNE kubelki', async () => {
      const ip = '198.51.100.30'
      for (let i = 0; i < 10; i++) {
        await POST(zadanie(wlaczony.slug, { ip }), params(wlaczony.slug))
      }
      assert.strictEqual(
        (await POST(zadanie(wlaczony.slug, { ip }), params(wlaczony.slug))).status,
        429,
        'kubelek zapisow wyczerpany'
      )

      const odczyt = await GET(
        zadanie(wlaczony.slug, { ip, method: 'GET' }),
        params(wlaczony.slug)
      )

      // Wspolny licznik albo dusilby odczyty panelu, albo rozluznial zapisy,
      // a to zapis zaklada zadanie w ClickUpie.
      assert.notStrictEqual(odczyt.status, 429)
    })

    it('inny adres IP ma wlasny budzet', async () => {
      for (let i = 0; i < 10; i++) {
        await POST(zadanie(wlaczony.slug, { ip: '198.51.100.40' }), params(wlaczony.slug))
      }

      const inny = await POST(zadanie(wlaczony.slug, { ip: '198.51.100.41' }), params(wlaczony.slug))

      assert.ok(inny.status < 400)
    })

    it('inny PORTAL ma wlasny budzet, mimo tego samego IP', async () => {
      const ip = '198.51.100.50'
      for (let i = 0; i < 10; i++) {
        await POST(zadanie(wlaczony.slug, { ip }), params(wlaczony.slug))
      }

      // Drugi portal z tym samym IP nie moze dziedziczyc wyczerpanego budzetu.
      const drugi = await POST(zadanie(wylaczony.slug, { ip }), params(wylaczony.slug))
      assert.strictEqual(drugi.status, 404, 'wylaczony portal dalej odpowiada 404, nie 429')
    })
  })

  describe('preflight OPTIONS', () => {
    it('NIE przechodzi przez brame, wiec nie zjada budzetu', async () => {
      const ip = '198.51.100.60'
      for (let i = 0; i < 20; i++) {
        await OPTIONS(zadanie(wlaczony.slug, { ip, method: 'OPTIONS' }), params(wlaczony.slug))
      }

      // Przegladarka wysyla preflight PRZED wlasciwym zadaniem. Gdyby liczyl
      // sie do limitu, ruch z dozwolonej domeny dusilby sam siebie.
      const zapis = await POST(zadanie(wlaczony.slug, { ip }), params(wlaczony.slug))
      assert.ok(zapis.status < 400)
    })

    it('preflight z OBCEJ domeny nie dostaje naglowka CORS', async () => {
      const res = await OPTIONS(
        zadanie(wlaczony.slug, { method: 'OPTIONS', origin: 'https://zlodziej.example' }),
        params(wlaczony.slug)
      )

      // Odmowa nastepuje u przegladarki: bez naglowka nie wysle wlasciwego
      // zadania, a gdyby wyslala, trafiloby na 403.
      assert.strictEqual(res.headers.get('access-control-allow-origin'), null)
    })

    it('preflight z DOZWOLONEJ domeny dostaje dokladnie ten Origin', async () => {
      const res = await OPTIONS(
        zadanie(wlaczony.slug, { method: 'OPTIONS' }),
        params(wlaczony.slug)
      )

      // Nie sama nazwa hosta: pakiet porownuje `allowedOrigins` z naglowkiem
      // ZNAK PO ZNAKU, wiec podanie golego hosta znaczyloby brak naglowka
      // i zablokowanie odpowiedzi takze dla prawdziwego klienta.
      assert.strictEqual(res.headers.get('access-control-allow-origin'), `https://${DOMENA}`)
    })
  })

  describe('przycinanie anotacji', () => {
    it('ulamki spoza [0,1] sa przycinane, a zgloszenie przechodzi', async () => {
      const res = await POST(
        zadanie(wlaczony.slug, {
          body: zgloszenie({
            message: 'przycisk nie dziala',
            annotations: [{
              anchor: {
                cssSelector: 'body > button',
                xpath: '/html/body/button',
                textSnippet: 'Zamów teraz',
                elementTag: 'BUTTON',
                textPrefix: '',
                textSuffix: '',
                fingerprint: '12:0:0',
                neighborText: '',
                anchorKey: null,
              },
              // Widget przysyla takie wartosci przy zwyklym przeciagnieciu poza
              // krawedz elementu, a adapter odrzuca wtedy CALE zgloszenie
              // z bledem na `annotations.0.rect.hPct`. Bez przyciecia na wejsciu
              // klient klika „Wyslij" i nie dzieje sie nic.
              rect: { xPct: -0.4, yPct: 0.2, wPct: 1.9, hPct: 1.4 },
              scrollX: -10,
              scrollY: 300,
              viewportW: 1280,
              viewportH: 800,
              devicePixelRatio: 2,
            }],
          }),
        }),
        params(wlaczony.slug)
      )

      assert.ok(res.status < 400, `zgloszenie odrzucone kodem ${res.status}`)
      assert.strictEqual(store.createFeedback.mock.calls.length, 1, 'doszlo do sklepu')
    })

    it('cialo nie bedace JSON-em nie wywala trasy', async () => {
      const res = await POST(
        new NextRequest(`http://localhost/api/siteping/${wlaczony.slug}`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json', origin: `https://${DOMENA}`, 'x-forwarded-for': '198.51.100.70' },
          body: 'to nie jest json',
        } as ConstructorParameters<typeof NextRequest>[1]),
        params(wlaczony.slug)
      )

      // Odpowiedz na popsuty payload nalezy do walidacji pakietu; nasza czescia
      // jest tylko to, zeby nie skonczylo sie wyjatkiem bez odpowiedzi.
      assert.ok(res.status >= 400 && res.status < 500, `oczekiwano bledu klienta, dostalem ${res.status}`)
    })
  })
})
