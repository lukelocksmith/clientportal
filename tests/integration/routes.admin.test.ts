import { describe, it, beforeAll, afterAll, beforeEach, vi } from 'vitest'
import assert from 'node:assert'
import { createHmac } from 'node:crypto'
import { eq } from 'drizzle-orm'
import { db } from '@/lib/db'
import { portalUsers, userInvites, sessions } from '@/lib/db/schema'
import {
  isDbReachable,
  createTestPortal,
  dropTestPortal,
  createTestUserWithPassword,
} from './helpers'

/**
 * PANEL ADMINA: zakladanie kont, nadawanie i odbieranie dostepu.
 *
 * To sa trasy, ktore moga dac komus dostep do cudzego projektu, i do tej pory
 * nie mialy ani jednego testu. Perymetr jest tu jedna linijka na poczatku
 * kazdego handlera (`isAdminRequest`), wiec pominiecie jej w jednej trasie nie
 * rzuca sie w oczy przy czytaniu — dlatego KAZDA trasa ma tu test odmowy bez
 * uprawnien, wykonany w petli, zeby nowa trasa nie mogla przejsc niezauwazona.
 *
 * `isAdminRequest` przepuszcza DWIE drogi: ciasteczko z panelu i token
 * `ADMIN_API_TOKEN` w naglowku (zarzadzanie z terminala, bez przegladarki).
 * Obie sa tu sprawdzane, bo droga bez testu jest droga, o ktorej sie zapomina.
 *
 * Poczta podstawiona. Postgres, bcrypt, HMAC i tokeny prawdziwe.
 *
 *   docker start cp-test-pg && npm run test:integration
 */
const { cookieJar, mailer } = vi.hoisted(() => ({
  cookieJar: new Map<string, string>(),
  mailer: { sendMail: vi.fn(), isMailConfigured: vi.fn(() => true) },
}))

vi.mock('next/headers', () => ({
  cookies: vi.fn(async () => ({
    get: (name: string) => (cookieJar.has(name) ? { value: cookieJar.get(name)! } : undefined),
    set: (name: string, value: string) => { cookieJar.set(name, value) },
    delete: (name: string) => { cookieJar.delete(name) },
  })),
}))
vi.mock('@/lib/mailer', () => mailer)

import { NextRequest } from 'next/server'
import { POST as adminLoginPOST } from '@/app/api/admin/login/route'
import { POST as adminLogoutPOST } from '@/app/api/admin/logout/route'
import { GET as usersGET, POST as usersPOST } from '@/app/api/admin/users/route'
import { PATCH as userPATCH, DELETE as userDELETE } from '@/app/api/admin/users/[userId]/route'
import { POST as invitePOST } from '@/app/api/admin/users/invite/route'
import { GET as portalsGET } from '@/app/api/admin/portals/route'
import { GET as statsGET } from '@/app/api/admin/stats/route'
import { POST as loginPOST } from '@/app/api/auth/login/route'

const dbUp = await isDbReachable()
const maSekret = !!process.env.ADMIN_SECRET
const maToken = !!process.env.ADMIN_API_TOKEN

const req = (url: string, init?: RequestInit) =>
  new NextRequest(`http://localhost${url}`, init as ConstructorParameters<typeof NextRequest>[1])

const post = (url: string, body: unknown, headers: Record<string, string> = {}) =>
  req(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', ...headers },
    body: JSON.stringify(body),
  })

describe.skipIf(!dbUp)('trasy admina na prawdziwej bazie', () => {
  let portalA: { id: string; slug: string }

  beforeAll(async () => {
    portalA = await createTestPortal('adm')
  })

  afterAll(async () => {
    if (portalA) await dropTestPortal(portalA.id)
  })

  beforeEach(() => {
    cookieJar.clear()
    vi.clearAllMocks()
    mailer.sendMail.mockResolvedValue({ sent: true })
    mailer.isMailConfigured.mockReturnValue(true)
  })

  function zalogujAdmina(): void {
    cookieJar.set(
      'admin_session',
      createHmac('sha256', process.env.ADMIN_SECRET!).update('admin-session').digest('hex')
    )
  }

  const naglowekTokenu = () => ({ authorization: `Bearer ${process.env.ADMIN_API_TOKEN}` })

  /**
   * PERYMETR. Kazda trasa admina bez uprawnien musi odmowic.
   *
   * Petla zamiast osobnych testow, zeby dodanie trasy do listy bylo tanie.
   * Trasa, ktorej nie ma na tej liscie, nie ma sprawdzonego perymetru.
   */
  describe('perymetr: bez uprawnien nie przechodzi NIC', () => {
    const trasy: Array<[string, () => Promise<Response>]> = [
      ['GET /admin/users', () => usersGET(req('/api/admin/users'))],
      ['POST /admin/users', () => usersPOST(post('/api/admin/users', { slug: 'x', email: 'a@b.c', name: 'X' }))],
      ['PATCH /admin/users/[id]', () => userPATCH(
        req('/api/admin/users/00000000-0000-0000-0000-000000000000', {
          method: 'PATCH',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ isActive: false }),
        }),
        { params: Promise.resolve({ userId: '00000000-0000-0000-0000-000000000000' }) }
      )],
      ['DELETE /admin/users/[id]', () => userDELETE(
        req('/api/admin/users/00000000-0000-0000-0000-000000000000', { method: 'DELETE' }),
        { params: Promise.resolve({ userId: '00000000-0000-0000-0000-000000000000' }) }
      )],
      ['POST /admin/users/invite', () => invitePOST(
        post('/api/admin/users/invite', { userId: '00000000-0000-0000-0000-000000000000' })
      )],
      ['GET /admin/portals', () => portalsGET(req('/api/admin/portals'))],
      ['GET /admin/stats', () => statsGET(req('/api/admin/stats'))],
    ]

    for (const [nazwa, wywolaj] of trasy) {
      it(`${nazwa} bez ciasteczka i bez tokenu -> 401`, async () => {
        const res = await wywolaj()
        assert.strictEqual(res.status, 401)
      })
    }

    it.skipIf(!maSekret)('podrobione ciasteczko admina nie przechodzi', async () => {
      cookieJar.set('admin_session', 'a'.repeat(64))

      const res = await usersGET(req('/api/admin/users'))

      assert.strictEqual(res.status, 401)
    })

    it.skipIf(!maToken)('zly token w naglowku nie przechodzi', async () => {
      const res = await usersGET(
        req('/api/admin/users', { headers: { authorization: 'Bearer nie-ten-token' } })
      )

      assert.strictEqual(res.status, 401)
    })
  })

  describe('dwie drogi wejscia', () => {
    it.skipIf(!maSekret)('ciasteczko z panelu wpuszcza', async () => {
      zalogujAdmina()
      const res = await usersGET(req('/api/admin/users'))
      assert.strictEqual(res.status, 200)
    })

    it.skipIf(!maToken)('token w naglowku wpuszcza BEZ ciasteczka (praca z terminala)', async () => {
      const res = await usersGET(req('/api/admin/users', { headers: naglowekTokenu() }))
      assert.strictEqual(res.status, 200)
    })
  })

  describe('POST /api/admin/login', () => {
    it('bez danych -> 400 (blad zadania, nie uwierzytelnienia) i zadnego ciasteczka', async () => {
      const res = await adminLoginPOST(post('/api/admin/login', {}))

      assert.strictEqual(res.status, 400)
      assert.strictEqual(cookieJar.has('admin_session'), false)
    })

    it('nieznany adres -> 401', async () => {
      const res = await adminLoginPOST(
        post('/api/admin/login', { email: 'ktos-inny@example.com', password: 'cokolwiek' })
      )

      assert.strictEqual(res.status, 401)
      assert.strictEqual(cookieJar.has('admin_session'), false)
    })

    it.skipIf(!maSekret)('wylogowanie kasuje ciasteczko admina', async () => {
      zalogujAdmina()

      await adminLogoutPOST()

      assert.strictEqual(cookieJar.has('admin_session'), false)
      assert.strictEqual((await usersGET(req('/api/admin/users'))).status, 401)
    })
  })

  describe.skipIf(!maToken)('POST /api/admin/users (nowe konto)', () => {
    it('konto BEZ hasla dostaje zaproszenie i NIE DA SIE na nie zalogowac', async () => {
      const email = `nowy-${Math.random().toString(36).slice(2, 8)}@example.com`

      const res = await usersPOST(
        post('/api/admin/users', { slug: portalA.slug, email, name: 'Nowy Klient' }, naglowekTokenu())
      )
      const body = await res.json()

      assert.strictEqual(res.status, 201)
      assert.strictEqual(body.invite.sent, true)
      assert.strictEqual(body.invite.url, null, 'przy udanej wysylce token nie krazy poza mailem')

      // Konto jest widoczne i formularz logowania jest dla niego otwarty, wiec
      // haslo puste albo przewidywalne byloby dziura. Sprawdzamy to LOGOWANIEM,
      // a nie ogladaniem hasha: hash moze wygladac poprawnie i mimo to pasowac.
      for (const proba of ['', ' ', 'password', 'haslo123']) {
        const logowanie = await loginPOST(
          post('/api/auth/login', { email, password: proba, slug: portalA.slug })
        )
        assert.ok(logowanie.status >= 400, `haslo "${proba}" NIE moze wpuszczac`)
      }

      const [zaproszenie] = await db.select().from(userInvites).where(eq(userInvites.userId, body.user.id))
      assert.ok(zaproszenie, 'zaproszenie powstalo w bazie')
      assert.strictEqual(zaproszenie.usedAt, null)
    })

    it('gdy mail NIE poszedl, admin dostaje link do przekazania z reki', async () => {
      mailer.sendMail.mockResolvedValue({ sent: false, reason: 'brak-smtp' })
      const email = `bez-maila-${Math.random().toString(36).slice(2, 8)}@example.com`

      const res = await usersPOST(
        post('/api/admin/users', { slug: portalA.slug, email, name: 'Bez Maila' }, naglowekTokenu())
      )
      const body = await res.json()

      // Bez tego konto istnialoby, a nikt nie moglby wejsc.
      assert.strictEqual(body.invite.sent, false)
      assert.ok(body.invite.url?.includes(portalA.slug), 'link zwrocony do przekazania')
    })

    it('podane haslo pomija zaproszenie i od razu dziala', async () => {
      const email = `z-haslem-${Math.random().toString(36).slice(2, 8)}@example.com`

      const res = await usersPOST(
        post('/api/admin/users',
          { slug: portalA.slug, email, name: 'Z Haslem', password: 'tymczasowe-123' },
          naglowekTokenu())
      )
      const body = await res.json()

      assert.strictEqual(res.status, 201)
      assert.strictEqual(body.invite, null)
      assert.strictEqual(mailer.sendMail.mock.calls.length, 0, 'swiadome pominiecie zaproszenia')

      const logowanie = await loginPOST(
        post('/api/auth/login', { email, password: 'tymczasowe-123', slug: portalA.slug })
      )
      assert.strictEqual(logowanie.status, 200)
    })

    it('nieistniejacy projekt -> 404, konto NIE powstaje', async () => {
      const email = `sierota-${Math.random().toString(36).slice(2, 8)}@example.com`

      const res = await usersPOST(
        post('/api/admin/users', { slug: 'nie-ma-takiego-projektu', email, name: 'X' }, naglowekTokenu())
      )

      assert.strictEqual(res.status, 404)
      const wiersze = await db.select().from(portalUsers).where(eq(portalUsers.email, email))
      assert.strictEqual(wiersze.length, 0, 'konto bez projektu nie moze zostac w bazie')
    })

    /**
     * ZMIERZONA NIESPOJNOSC, nie blad tego testu.
     *
     * Ta trasa sprawdza unikalnosc adresu GLOBALNIE, w calej bazie, a nie
     * w obrebie projektu. Tymczasem `/api/auth/login-any` ma cala galaz `choose`
     * obslugujaca WLASNIE ten przypadek: ten sam adres w kilku projektach.
     *
     * Znaczy to, ze panel nie potrafi utworzyc sytuacji, ktora logowanie
     * obsluguje. Konta z tym samym adresem w bazie sa, wiec powstaly wczesniej
     * albo inna droga. Test pilnuje stanu FAKTYCZNEGO; gdyby ktos swiadomie
     * zmienil te zasade, ma tu zobaczyc, ze rusza dwie rzeczy naraz.
     */
    it('ten sam adres w innym projekcie -> 409 (unikalnosc jest GLOBALNA)', async () => {
      const portalB = await createTestPortal('adm-b')
      try {
        const email = `duplikat-${Math.random().toString(36).slice(2, 8)}@example.com`
        await usersPOST(post('/api/admin/users', { slug: portalA.slug, email, name: 'Pierwszy' }, naglowekTokenu()))

        const res = await usersPOST(
          post('/api/admin/users', { slug: portalB.slug, email, name: 'Drugi' }, naglowekTokenu())
        )

        assert.strictEqual(res.status, 409)
      } finally {
        await dropTestPortal(portalB.id)
      }
    })

    it('pole spoza schematu odrzucone', async () => {
      const res = await usersPOST(
        post('/api/admin/users',
          { slug: portalA.slug, email: 'x@example.com', name: 'X', isAdmin: true },
          naglowekTokenu())
      )

      assert.strictEqual(res.status, 400)
    })
  })

  describe.skipIf(!maToken)('PATCH i DELETE konta', () => {
    it('wylaczenie konta ODBIERA dostep natychmiast', async () => {
      const email = `do-wylaczenia-${Math.random().toString(36).slice(2, 8)}@example.com`
      const userId = await createTestUserWithPassword({
        portalId: portalA.id, email, password: 'dziala-haslo-1',
      })
      assert.strictEqual(
        (await loginPOST(post('/api/auth/login', { email, password: 'dziala-haslo-1', slug: portalA.slug }))).status,
        200,
        'przed wylaczeniem konto dziala'
      )
      cookieJar.clear()

      const res = await userPATCH(
        req(`/api/admin/users/${userId}`, {
          method: 'PATCH',
          headers: { 'Content-Type': 'application/json', ...naglowekTokenu() },
          body: JSON.stringify({ isActive: false }),
        }),
        { params: Promise.resolve({ userId }) }
      )

      assert.strictEqual(res.status, 200)
      const poWylaczeniu = await loginPOST(
        post('/api/auth/login', { email, password: 'dziala-haslo-1', slug: portalA.slug })
      )
      assert.strictEqual(poWylaczeniu.status, 401)
    })

    it('zmiana hasla przez admina UNIEWAZNIA stare haslo', async () => {
      const email = `nowe-haslo-${Math.random().toString(36).slice(2, 8)}@example.com`
      const userId = await createTestUserWithPassword({
        portalId: portalA.id, email, password: 'stare-haslo-1',
      })

      await userPATCH(
        req(`/api/admin/users/${userId}`, {
          method: 'PATCH',
          headers: { 'Content-Type': 'application/json', ...naglowekTokenu() },
          body: JSON.stringify({ password: 'zupelnie-nowe-1' }),
        }),
        { params: Promise.resolve({ userId }) }
      )

      cookieJar.clear()
      assert.strictEqual(
        (await loginPOST(post('/api/auth/login', { email, password: 'stare-haslo-1', slug: portalA.slug }))).status,
        401,
        'stare haslo przestaje dzialac'
      )
      cookieJar.clear()
      assert.strictEqual(
        (await loginPOST(post('/api/auth/login', { email, password: 'zupelnie-nowe-1', slug: portalA.slug }))).status,
        200,
        'nowe haslo dziala'
      )
    })

    it('nieistniejace konto -> 404', async () => {
      const brak = '00000000-0000-0000-0000-000000000000'
      const res = await userPATCH(
        req(`/api/admin/users/${brak}`, {
          method: 'PATCH',
          headers: { 'Content-Type': 'application/json', ...naglowekTokenu() },
          body: JSON.stringify({ isActive: false }),
        }),
        { params: Promise.resolve({ userId: brak }) }
      )

      assert.strictEqual(res.status, 404)
    })

    it('skasowanie konta kasuje TAKZE jego zywe sesje', async () => {
      const email = `do-kasacji-${Math.random().toString(36).slice(2, 8)}@example.com`
      const userId = await createTestUserWithPassword({
        portalId: portalA.id, email, password: 'jakies-haslo-1',
      })
      await loginPOST(post('/api/auth/login', { email, password: 'jakies-haslo-1', slug: portalA.slug }))
      assert.strictEqual((await db.select().from(sessions).where(eq(sessions.userId, userId))).length, 1)

      await userDELETE(
        req(`/api/admin/users/${userId}`, { method: 'DELETE', headers: naglowekTokenu() }),
        { params: Promise.resolve({ userId }) }
      )

      // Konto skasowane, a zywa sesja dzialajaca dalej byla by dostepem
      // dla kogos, komu wlasnie go odebralismy.
      assert.strictEqual((await db.select().from(portalUsers).where(eq(portalUsers.id, userId))).length, 0)
      assert.strictEqual((await db.select().from(sessions).where(eq(sessions.userId, userId))).length, 0)
    })
  })

  describe.skipIf(!maToken)('POST /api/admin/users/invite (ponowne zaproszenie)', () => {
    it('nowe zaproszenie UNIEWAZNIA poprzednie', async () => {
      const email = `ponowne-${Math.random().toString(36).slice(2, 8)}@example.com`
      const res1 = await usersPOST(
        post('/api/admin/users', { slug: portalA.slug, email, name: 'Ponowne' }, naglowekTokenu())
      )
      const userId = (await res1.json()).user.id

      await invitePOST(post('/api/admin/users/invite', { userId }, naglowekTokenu()))

      const wszystkie = await db.select().from(userInvites).where(eq(userInvites.userId, userId))
      const zywe = wszystkie.filter(i => i.usedAt === null && i.expiresAt > new Date())
      // Stary link krazacy w mailu musi przestac dzialac, inaczej odwolanie
      // dostepu przez wyslanie nowego zaproszenia jest pozorne.
      assert.strictEqual(zywe.length, 1, 'zywe jest dokladnie jedno zaproszenie')
    })

    it('nieistniejace konto -> 404, zadnego maila', async () => {
      const res = await invitePOST(
        post('/api/admin/users/invite',
          { userId: '00000000-0000-0000-0000-000000000000' },
          naglowekTokenu())
      )

      assert.strictEqual(res.status, 404)
      assert.strictEqual(mailer.sendMail.mock.calls.length, 0)
    })

    it('userId spoza formatu uuid -> 400', async () => {
      const res = await invitePOST(
        post('/api/admin/users/invite', { userId: 'nie-uuid' }, naglowekTokenu())
      )

      assert.strictEqual(res.status, 400)
    })
  })
})
