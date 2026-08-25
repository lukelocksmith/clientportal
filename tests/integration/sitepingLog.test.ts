import { describe, it, beforeAll, afterAll, beforeEach, vi } from 'vitest'
import assert from 'node:assert'
import { and, desc, eq } from 'drizzle-orm'
import { db } from '@/lib/db'
import { portals, sitepingLog } from '@/lib/db/schema'
import { isDbReachable, createTestPortal, dropTestPortal, createTestList } from './helpers'

/**
 * LOG DIAGNOSTYCZNY SITEPINGA na prawdziwej bazie.
 *
 * Testy jednostkowe (`lib/siteping/log.test.ts`) pilnuja tego, CO wpisujemy do
 * kolumn. Tutaj sprawdzamy rzecz, ktorej one nie widza: czy trasa w ogole
 * dochodzi do zapisu na KAZDYM ze swoich wyjsc — takze na tych wczesnych,
 * ktore koncza sie `return`-em przed sklepem. Bo to wlasnie one odpowiadaja na
 * pytanie „czemu klientowi nie dochodza zgloszenia", dla ktorego ten log powstal.
 *
 *   docker start clientportal-postgres-1 && npm run test:integration
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

// Brama admina siega po ciasteczko sesji, a poza kontekstem zadania Next
// `cookies()` rzuca. Trasa logu i tak jest tu wolana tokenem.
vi.mock('next/headers', () => ({
  cookies: vi.fn(async () => ({ get: () => undefined, set: () => {}, delete: () => {} })),
}))

import { NextRequest } from 'next/server'
import { resetRateLimits } from '@/lib/siteping/rateLimit'
import { purgeOldSitepingLog } from '@/lib/siteping/log'
import { POST, GET } from '@/app/api/siteping/[slug]/route'
import { GET as logGET } from '@/app/api/admin/siteping/log/route'

const dbUp = await isDbReachable()
const maToken = !!process.env.ADMIN_API_TOKEN

const DOMENA = 'log.example.test'
const params = (slug: string) => ({ params: Promise.resolve({ slug }) })

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

function zadanie(slug: string, opts: {
  origin?: string | null
  ip?: string
  method?: string
  body?: unknown
} = {}): NextRequest {
  const headers: Record<string, string> = {
    'Content-Type': 'application/json',
    'x-forwarded-for': opts.ip ?? '203.0.113.7',
  }
  if (opts.origin !== null) headers.origin = opts.origin ?? `https://${DOMENA}`

  // GET panelu widgetu przychodzi z parametrami zapytania; `projectName` jest
  // OBOWIAZKOWY w schemacie pakietu, a bez niego walidacja odpowiada 400 i test
  // sprawdzalby popsuty odczyt zamiast udanego.
  const query = opts.method === 'GET' ? `?projectName=Test+SitePing&url=${encodeURIComponent(`https://${DOMENA}/kontakt`)}&page=1&limit=10` : ''

  return new NextRequest(`http://localhost/api/siteping/${slug}${query}`, {
    method: opts.method ?? 'POST',
    headers,
    body: opts.method === 'GET' ? undefined : JSON.stringify(opts.body ?? zgloszenie()),
  } as ConstructorParameters<typeof NextRequest>[1])
}

describe.skipIf(!dbUp)('log diagnostyczny SitePinga', () => {
  let wlaczony: { id: string; slug: string }
  let bezDomen: { id: string; slug: string }
  let obcy: { id: string; slug: string }

  async function wpisy(portalId: string) {
    return db
      .select()
      .from(sitepingLog)
      .where(eq(sitepingLog.portalId, portalId))
      .orderBy(desc(sitepingLog.createdAt))
  }

  /** Ostatni wpis o danym wyniku — testy patrza na konkretne wyjscie z trasy. */
  async function ostatni(portalId: string, outcome: string) {
    const [row] = await db
      .select()
      .from(sitepingLog)
      .where(and(eq(sitepingLog.portalId, portalId), eq(sitepingLog.outcome, outcome)))
      .orderBy(desc(sitepingLog.createdAt))
      .limit(1)
    return row ?? null
  }

  beforeAll(async () => {
    wlaczony = await createTestPortal('spl-on')
    bezDomen = await createTestPortal('spl-nodom')
    obcy = await createTestPortal('spl-inny')

    await createTestList({ portalId: wlaczony.id, clickupListId: 'lista-spl', isDefault: true })
    await db.update(portals)
      .set({ sitepingEnabled: true, siteDomains: DOMENA })
      .where(eq(portals.id, wlaczony.id))
    // Flaga wlaczona, domen brak: konfiguracja niepelna, endpoint zamkniety.
    await db.update(portals)
      .set({ sitepingEnabled: true, siteDomains: null })
      .where(eq(portals.id, bezDomen.id))
  })

  afterAll(async () => {
    for (const p of [wlaczony, bezDomen, obcy]) if (p) await dropTestPortal(p.id)
  })

  beforeEach(async () => {
    vi.clearAllMocks()
    // Kubelki limitu ORAZ zapora przed zalewaniem logu zyja w tej samej mapie.
    resetRateLimits()
    store.createFeedback.mockResolvedValue({
      id: 'task-abc', clientId: 'c-1', message: 'cos nie dziala', url: `https://${DOMENA}/kontakt`,
      createdAt: new Date().toISOString(), status: 'open', annotations: [],
    })
    store.getFeedbacks.mockResolvedValue({ feedbacks: [], total: 0 })
    for (const p of [wlaczony, bezDomen, obcy]) {
      if (p) await db.delete(sitepingLog).where(eq(sitepingLog.portalId, p.id))
    }
  })

  describe('kazde wyjscie z trasy zostawia slad', () => {
    it('udane zgloszenie: wynik ok i identyfikator zadania w ClickUpie', async () => {
      await POST(zadanie(wlaczony.slug), params(wlaczony.slug))

      const row = await ostatni(wlaczony.id, 'ok')
      assert.ok(row, 'brak wpisu o udanym zgloszeniu')
      assert.strictEqual(row.method, 'POST')
      assert.ok(row.status < 400, `oczekiwano kodu sukcesu, jest ${row.status}`)
      // To jest link miedzy logiem a tym, co widzi zespol w ClickUpie.
      assert.strictEqual(row.clickupTaskId, 'task-abc')
      assert.strictEqual(row.origin, `https://${DOMENA}`)
      assert.ok((row.durationMs ?? -1) >= 0, 'czas obslugi nie zostal zmierzony')
    })

    it('adres IP jest zapisany jako TRZY OKTETY, nigdy w calosci', async () => {
      await POST(zadanie(wlaczony.slug, { ip: '89.64.12.34' }), params(wlaczony.slug))

      const row = await ostatni(wlaczony.id, 'ok')
      assert.strictEqual(row?.ipPrefix, '89.64.12')
      // Zapis pelnego adresu bylby trzymaniem danych osobowych w logu
      // diagnostycznym bez uzasadnienia.
      const wszystkie = await wpisy(wlaczony.id)
      assert.strictEqual(wszystkie.some(w => w.ipPrefix?.includes('89.64.12.34')), false)
    })

    it('zgloszenie z OBCEJ domeny: wynik origin_not_allowed', async () => {
      await POST(
        zadanie(wlaczony.slug, { origin: 'https://zlodziej.example' }),
        params(wlaczony.slug)
      )

      const row = await ostatni(wlaczony.id, 'origin_not_allowed')
      assert.ok(row, 'odrzucony Origin nie zostawil sladu')
      assert.strictEqual(row.status, 403)
      // Bez tego pola diagnoza konczy sie na „cos odrzucamy", a z nim widac,
      // ze klient wkleil widget na innej domenie niz ta z konfiguracji.
      assert.strictEqual(row.origin, 'https://zlodziej.example')
    })

    it('przekroczony limit czestotliwosci: wynik rate_limited', async () => {
      const ip = '198.51.100.77'
      for (let i = 0; i < 11; i++) {
        await POST(zadanie(wlaczony.slug, { ip }), params(wlaczony.slug))
      }

      const row = await ostatni(wlaczony.id, 'rate_limited')
      assert.ok(row, 'odbicie od limitu nie zostawilo sladu')
      assert.strictEqual(row.status, 429)
    })

    it('portal z niepelna konfiguracja: wynik misconfigured z powodem', async () => {
      await POST(zadanie(bezDomen.slug), params(bezDomen.slug))

      const row = await ostatni(bezDomen.id, 'misconfigured')
      assert.ok(row, 'portal odpowiadajacy 404 nie zostawil sladu')
      assert.strictEqual(row.status, 404)
      // Powod jest tu cala wartoscia wpisu: 404 sam w sobie nie mowi, ktorego
      // z trzech warunkow brakuje.
      assert.ok(row.detail && row.detail.length > 0, 'brak powodu odmowy')
    })

    it('nieistniejacy slug nie zapisuje niczego nikomu', async () => {
      await POST(zadanie('nie-ma-takiego-portalu'), params('nie-ma-takiego-portalu'))

      // Nie ma projektu, do ktorego mozna by wpis przypiac. Zapisanie go
      // „gdziekolwiek" zanieczysciloby log przypadkowego klienta.
      for (const p of [wlaczony, bezDomen, obcy]) {
        assert.strictEqual((await wpisy(p.id)).length, 0)
      }
    })

    it('blad ClickUpa: wynik error z trescia bledu', async () => {
      store.createFeedback.mockRejectedValue(new Error('ClickUp odpowiedzial 401'))

      await POST(zadanie(wlaczony.slug), params(wlaczony.slug))

      const row = await ostatni(wlaczony.id, 'error')
      assert.ok(row, 'awaria sklepu nie zostawila sladu')
      assert.strictEqual(row.status, 500)
      // Pakiet zwraca zglaszajacemu generyczne „Internal server error", wiec
      // bez tego pola tresc bledu nie istnieje nigdzie poza konsola serwera.
      assert.ok(
        row.detail?.includes('ClickUp odpowiedzial 401'),
        `tresc bledu nie trafila do logu: ${row.detail}`
      )
    })

    it('popsuty ladunek: wynik invalid_payload', async () => {
      await POST(
        zadanie(wlaczony.slug, { body: { message: 'brakuje polowy pol' } }),
        params(wlaczony.slug)
      )

      const row = await ostatni(wlaczony.id, 'invalid_payload')
      assert.ok(row, 'odrzucony ladunek nie zostawil sladu')
      assert.strictEqual(row.status, 400)
    })

    it('odczyt panelu widgetu (GET) tez jest widoczny', async () => {
      await GET(zadanie(wlaczony.slug, { method: 'GET' }), params(wlaczony.slug))

      const wszystkie = await wpisy(wlaczony.id)
      const get = wszystkie.find(w => w.method === 'GET')
      // Udany GET jest dowodem, ze widget na stronie klienta ROZMAWIA z nami,
      // nawet gdy nikt jeszcze nic nie zglosil.
      assert.ok(get, 'odczyt panelu widgetu nie zostawil sladu')
      assert.strictEqual(get.outcome, 'ok')
    })
  })

  describe('zapora przed zalewaniem logu', () => {
    it('powtarzane odmowy z jednego adresu nie mnoza wierszy bez konca', async () => {
      const ip = '198.51.100.90'
      for (let i = 0; i < 40; i++) {
        await POST(
          zadanie(wlaczony.slug, { ip, origin: 'https://zlodziej.example' }),
          params(wlaczony.slug)
        )
      }

      const odmowy = (await wpisy(wlaczony.id)).filter(w => w.outcome === 'origin_not_allowed')
      // Odmowa NIE przechodzi przez limit czestotliwosci (brama domeny jest
      // przed nim), wiec bez wlasnej zapory bot wstawialby wiersz na kazde
      // zadanie i zapora chroniaca ClickUpa bylaby droga do zapisu w bazie.
      assert.ok(odmowy.length > 0, 'odmowy mialy zostawic slad')
      assert.ok(odmowy.length <= 10, `zapora nie zadzialala, wierszy: ${odmowy.length}`)
    })
  })

  describe('retencja', () => {
    it('kasuje starsze niz 30 dni i TYLKO je', async () => {
      const dzien = 24 * 60 * 60 * 1000
      await db.insert(sitepingLog).values([
        {
          portalId: wlaczony.id, method: 'POST', status: 201, outcome: 'ok',
          detail: 'stary', createdAt: new Date(Date.now() - 31 * dzien),
        },
        {
          portalId: wlaczony.id, method: 'POST', status: 201, outcome: 'ok',
          detail: 'swiezy', createdAt: new Date(Date.now() - 29 * dzien),
        },
      ])

      await purgeOldSitepingLog(30)

      const zostaly = await wpisy(wlaczony.id)
      assert.strictEqual(zostaly.some(w => w.detail === 'stary'), false, 'stary wpis mial zniknac')
      assert.strictEqual(zostaly.some(w => w.detail === 'swiezy'), true, 'swiezy wpis mial zostac')
    })
  })

  describe('trasa panelu admina', () => {
    const zapytaj = (query: string, naglowki: Record<string, string> = {}) =>
      logGET(new NextRequest(`http://localhost/api/admin/siteping/log?${query}`, {
        headers: naglowki,
      } as ConstructorParameters<typeof NextRequest>[1]))

    it('bez uwierzytelnienia nie oddaje niczego', async () => {
      // Log niesie adresy podstron cudzej witryny i prefiksy IP jej gosci.
      const res = await zapytaj(`slug=${wlaczony.slug}`)
      assert.strictEqual(res.status, 401)
    })

    it.skipIf(!maToken)('oddaje wylacznie wpisy wskazanego projektu', async () => {
      await POST(zadanie(wlaczony.slug), params(wlaczony.slug))
      await db.insert(sitepingLog).values({
        portalId: obcy.id, method: 'POST', status: 201, outcome: 'ok', detail: 'cudzy',
      })

      const res = await zapytaj(`slug=${wlaczony.slug}`, {
        authorization: `Bearer ${process.env.ADMIN_API_TOKEN}`,
      })
      const dane = await res.json()

      assert.strictEqual(res.status, 200)
      assert.ok(dane.entries.length > 0)
      assert.strictEqual(
        dane.entries.some((w: { detail: string | null }) => w.detail === 'cudzy'),
        false,
        'wpis innego projektu wyciekl do odpowiedzi'
      )
    })

    it.skipIf(!maToken)('only=problems odsiewa udane zadania', async () => {
      await POST(zadanie(wlaczony.slug), params(wlaczony.slug))
      await POST(
        zadanie(wlaczony.slug, { origin: 'https://zlodziej.example' }),
        params(wlaczony.slug)
      )

      const res = await zapytaj(`slug=${wlaczony.slug}&only=problems`, {
        authorization: `Bearer ${process.env.ADMIN_API_TOKEN}`,
      })
      const dane = await res.json()

      // Domyslny widok panelu. Udane zadania sa najliczniejsze i zaslonilyby
      // odmowy, dla ktorych ten log powstal.
      assert.ok(dane.entries.length > 0)
      assert.strictEqual(
        dane.entries.every((w: { outcome: string }) => w.outcome !== 'ok'),
        true
      )
      // Zestawienie liczy WSZYSTKO, takze udane — inaczej nie dalo by sie
      // powiedziec, czy cokolwiek dochodzi.
      assert.ok(dane.summary.byOutcome.some((w: { outcome: string }) => w.outcome === 'ok'))
    })
  })

  describe('granica projektow', () => {
    it('log jednego projektu nie wycieka do drugiego', async () => {
      await POST(zadanie(wlaczony.slug), params(wlaczony.slug))
      await POST(
        zadanie(wlaczony.slug, { origin: 'https://zlodziej.example' }),
        params(wlaczony.slug)
      )

      // Log widzi wylacznie admin i wylacznie w karcie konkretnego projektu.
      assert.strictEqual((await wpisy(obcy.id)).length, 0)
      assert.ok((await wpisy(wlaczony.id)).length >= 2)
    })
  })
})
