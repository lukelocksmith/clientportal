import { describe, it, beforeAll, afterAll, beforeEach, vi } from 'vitest'
import assert from 'node:assert'
import { and, eq } from 'drizzle-orm'
import { db } from '@/lib/db'
import { auditLog, portalUsers, sessions, portals } from '@/lib/db/schema'
import {
  isDbReachable,
  createTestPortal,
  dropTestPortal,
  createTestUserWithPassword,
} from './helpers'

/**
 * WEJSCIE DO SYSTEMU: logowanie, wylogowanie, ustawienie hasla, reset.
 *
 * To sa trasy PUBLICZNE — jedyne, ktore odpowiadaja komukolwiek z internetu bez
 * sesji. Do tej pory nie mialy ani jednego testu. Logika pod spodem
 * (`lib/auth`, `lib/loginAttempts`, `lib/invites`) byla pokryta, ale to nie to
 * samo: pokryta funkcja wolana z zlym argumentem albo w zlej kolejnosci daje
 * dziure, ktorej jej wlasne testy nie widza.
 *
 * Poczta jest podstawiona, bo to wyjscie na swiat. Reszta prawdziwa: bcrypt,
 * Postgres, ciasteczka, licznik nieudanych prob, zapis do audit_log.
 *
 *   docker start cp-test-pg && npm run test:integration
 */
const { cookieJar, mailer, passwordNotice } = vi.hoisted(() => ({
  cookieJar: new Map<string, string>(),
  mailer: { sendMail: vi.fn() },
  passwordNotice: { sendPasswordChangedNotice: vi.fn() },
}))

vi.mock('next/headers', () => ({
  cookies: vi.fn(async () => ({
    get: (name: string) => (cookieJar.has(name) ? { value: cookieJar.get(name)! } : undefined),
    set: (name: string, value: string) => { cookieJar.set(name, value) },
    delete: (name: string) => { cookieJar.delete(name) },
  })),
}))
vi.mock('@/lib/mailer', () => mailer)
vi.mock('@/lib/passwordNotice', () => passwordNotice)

import { NextRequest } from 'next/server'
import { hashToken } from '@/lib/auth'
import { createInvite } from '@/lib/invites'
import { MAX_ATTEMPTS } from '@/lib/loginAttempts'
import { POST as loginPOST } from '@/app/api/auth/login/route'
import { POST as loginAnyPOST } from '@/app/api/auth/login-any/route'
import { POST as logoutPOST } from '@/app/api/auth/logout/route'
import { POST as setPasswordPOST } from '@/app/api/auth/set-password/route'
import { POST as forgotPOST } from '@/app/api/auth/forgot-password/route'

const dbUp = await isDbReachable()

const HASLO = 'poprawne-haslo-123'

const post = (url: string, body: unknown) =>
  new NextRequest(`http://localhost${url}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'user-agent': 'vitest' },
    body: JSON.stringify(body),
  } as ConstructorParameters<typeof NextRequest>[1])

describe.skipIf(!dbUp)('trasy logowania na prawdziwej bazie', () => {
  let portalA: { id: string; slug: string }
  let portalB: { id: string; slug: string }

  beforeAll(async () => {
    portalA = await createTestPortal('auth-r-a')
    portalB = await createTestPortal('auth-r-b')
  })

  afterAll(async () => {
    if (portalA) await dropTestPortal(portalA.id)
    if (portalB) await dropTestPortal(portalB.id)
  })

  beforeEach(() => {
    cookieJar.clear()
    vi.clearAllMocks()
    mailer.sendMail.mockResolvedValue({ sent: true })
    passwordNotice.sendPasswordChangedNotice.mockResolvedValue(undefined)
  })

  /** Nowe konto na kazdy test, zeby licznik prob jednego nie psul drugiego. */
  async function konto(portalId: string, prefix: string): Promise<{ id: string; email: string }> {
    const email = `${prefix}-${Math.random().toString(36).slice(2, 8)}@example.com`
    const id = await createTestUserWithPassword({ portalId, email, password: HASLO })
    return { id, email }
  }

  async function zdarzenia(portalId: string, userId: string, action: string) {
    return db
      .select()
      .from(auditLog)
      .where(and(
        eq(auditLog.portalId, portalId),
        eq(auditLog.userId, userId),
        eq(auditLog.action, action)
      ))
  }

  describe('POST /api/auth/login (logowanie w projekcie)', () => {
    it('poprawne haslo zaklada sesje w bazie i zapisuje wejscie do historii', async () => {
      const u = await konto(portalA.id, 'login-ok')

      const res = await loginPOST(post('/api/auth/login', { email: u.email, password: HASLO, slug: portalA.slug }))

      assert.strictEqual(res.status, 200)

      // Ciasteczko to za malo: sesja musi istniec w bazie, bo to ona rozstrzyga.
      const ciastko = cookieJar.get('portal_session')
      assert.ok(ciastko, 'ciasteczko sesji ustawione')
      const wiersze = await db.select().from(sessions).where(eq(sessions.tokenHash, hashToken(ciastko!)))
      assert.strictEqual(wiersze.length, 1)
      assert.strictEqual(wiersze[0].userId, u.id)

      assert.strictEqual((await zdarzenia(portalA.id, u.id, 'login')).length, 1)
    })

    it('WIELKOSC LITER w adresie nie blokuje logowania', async () => {
      const u = await konto(portalA.id, 'login-case')

      const res = await loginPOST(
        post('/api/auth/login', { email: u.email.toUpperCase(), password: HASLO, slug: portalA.slug })
      )

      assert.strictEqual(res.status, 200)
    })

    it('zle haslo nie zaklada sesji i zostawia slad w historii', async () => {
      const u = await konto(portalA.id, 'login-zle')

      const res = await loginPOST(
        post('/api/auth/login', { email: u.email, password: 'nie-to-haslo', slug: portalA.slug })
      )

      assert.strictEqual(res.status, 401)
      assert.strictEqual(cookieJar.has('portal_session'), false)
      assert.strictEqual((await zdarzenia(portalA.id, u.id, 'login_failed')).length, 1)
    })

    it('konto portalu A nie zaloguje sie na slugu portalu B', async () => {
      const u = await konto(portalA.id, 'login-obcy')

      const res = await loginPOST(
        post('/api/auth/login', { email: u.email, password: HASLO, slug: portalB.slug })
      )

      // Haslo POPRAWNE, a mimo to odmowa: konto nalezy do innego projektu.
      assert.strictEqual(res.status, 401)
      assert.strictEqual(cookieJar.has('portal_session'), false)
    })

    it('konto wylaczone nie zaloguje sie mimo poprawnego hasla', async () => {
      const u = await konto(portalA.id, 'login-off')
      await db.update(portalUsers).set({ isActive: false }).where(eq(portalUsers.id, u.id))

      const res = await loginPOST(post('/api/auth/login', { email: u.email, password: HASLO, slug: portalA.slug }))

      assert.strictEqual(res.status, 401)
    })

    it('portal wylaczony nie wpuszcza nikogo', async () => {
      const portalC = await createTestPortal('auth-r-c')
      try {
        const u = await konto(portalC.id, 'login-portal-off')
        await db.update(portals).set({ isActive: false }).where(eq(portals.id, portalC.id))

        const res = await loginPOST(post('/api/auth/login', { email: u.email, password: HASLO, slug: portalC.slug }))

        assert.strictEqual(res.status, 401)
      } finally {
        await dropTestPortal(portalC.id)
      }
    })

    it('brak pola -> 400, bez dotykania bazy', async () => {
      const res = await loginPOST(post('/api/auth/login', { email: 'a@b.c', slug: portalA.slug }))
      assert.strictEqual(res.status, 400)
    })

    describe('blokada po nieudanych probach', () => {
      it(`${MAX_ATTEMPTS} pomylek blokuje konto (429)`, async () => {
        const u = await konto(portalA.id, 'login-lock')

        for (let i = 0; i < MAX_ATTEMPTS; i++) {
          await loginPOST(post('/api/auth/login', { email: u.email, password: 'zle', slug: portalA.slug }))
        }

        const res = await loginPOST(post('/api/auth/login', { email: u.email, password: 'zle', slug: portalA.slug }))
        assert.strictEqual(res.status, 429)

        const [wiersz] = await db.select().from(portalUsers).where(eq(portalUsers.id, u.id))
        assert.ok(wiersz.lockedUntil && wiersz.lockedUntil > new Date(), 'blokada zapisana w bazie')
      })

      it('zablokowane konto odmawia takze przy POPRAWNYM hasle', async () => {
        const u = await konto(portalA.id, 'login-lock-ok')
        for (let i = 0; i < MAX_ATTEMPTS; i++) {
          await loginPOST(post('/api/auth/login', { email: u.email, password: 'zle', slug: portalA.slug }))
        }

        const res = await loginPOST(post('/api/auth/login', { email: u.email, password: HASLO, slug: portalA.slug }))

        // Gdyby poprawne haslo przechodzilo mimo blokady, blokada bylaby ozdoba.
        // Gdyby odpowiadalo INACZEJ niz zle, byloby wygodnym potwierdzeniem,
        // ze zgadywane haslo jest tym wlasciwym.
        assert.strictEqual(res.status, 429)
        assert.strictEqual(cookieJar.has('portal_session'), false)
      })

      it('udane logowanie ZERUJE licznik pomylek', async () => {
        const u = await konto(portalA.id, 'login-reset')
        for (let i = 0; i < MAX_ATTEMPTS - 1; i++) {
          await loginPOST(post('/api/auth/login', { email: u.email, password: 'zle', slug: portalA.slug }))
        }

        await loginPOST(post('/api/auth/login', { email: u.email, password: HASLO, slug: portalA.slug }))

        const [wiersz] = await db.select().from(portalUsers).where(eq(portalUsers.id, u.id))
        assert.strictEqual(wiersz.failedAttempts, 0)
        assert.strictEqual(wiersz.lockedUntil, null)
        // Inaczej cztery pomylki rozlozone na tygodnie zablokowalyby konto przy
        // piatej, mimo poprawnych logowan pomiedzy nimi.
      })
    })
  })

  describe('POST /api/auth/login-any (logowanie ze strony glownej)', () => {
    it('jedno dopasowanie -> od razu sesja i wskazanie projektu', async () => {
      const u = await konto(portalA.id, 'any-jeden')

      const res = await loginAnyPOST(post('/api/auth/login-any', { email: u.email, password: HASLO }))
      const body = await res.json()

      assert.strictEqual(res.status, 200)
      assert.strictEqual(body.kind, 'portal')
      assert.strictEqual(body.slug, portalA.slug)
      assert.ok(cookieJar.has('portal_session'))
    })

    /**
     * `email` w `portal_users` NIE jest globalnie unikalny: ta sama osoba bywa
     * kontem w kilku projektach. Sesja jest przypisana do KONKRETNEGO wiersza,
     * wiec zgadniecie za uzytkownika, ktory to projekt, wpuscilo by go do
     * projektu, ktorego nie wskazal.
     */
    it('ten sam adres w dwoch projektach -> lista wyboru i ZADNEJ sesji', async () => {
      const email = `wspolny-${Math.random().toString(36).slice(2, 8)}@example.com`
      await createTestUserWithPassword({ portalId: portalA.id, email, password: HASLO })
      await createTestUserWithPassword({ portalId: portalB.id, email, password: HASLO })

      const res = await loginAnyPOST(post('/api/auth/login-any', { email, password: HASLO }))
      const body = await res.json()

      assert.strictEqual(body.kind, 'choose')
      assert.strictEqual(body.portals.length, 2)
      // To jest istota tego testu.
      assert.strictEqual(cookieJar.has('portal_session'), false, 'sesja NIE powstala przed wyborem')
    })

    it('wybor projektu w drugim kroku zaklada sesje TYLKO tam', async () => {
      const email = `wybor-${Math.random().toString(36).slice(2, 8)}@example.com`
      const idA = await createTestUserWithPassword({ portalId: portalA.id, email, password: HASLO })
      await createTestUserWithPassword({ portalId: portalB.id, email, password: HASLO })

      const res = await loginAnyPOST(
        post('/api/auth/login-any', { email, password: HASLO, slug: portalA.slug })
      )
      const body = await res.json()

      assert.strictEqual(body.kind, 'portal')
      assert.strictEqual(body.slug, portalA.slug)
      const ciastko = cookieJar.get('portal_session')!
      const [wiersz] = await db.select().from(sessions).where(eq(sessions.tokenHash, hashToken(ciastko)))
      assert.strictEqual(wiersz.userId, idA, 'sesja wskazuje konto z WYBRANEGO projektu')
    })

    it('nieznany adres -> 401 bez sesji', async () => {
      const res = await loginAnyPOST(
        post('/api/auth/login-any', { email: 'nie-ma-takiego@example.com', password: HASLO })
      )

      assert.strictEqual(res.status, 401)
      assert.strictEqual(cookieJar.has('portal_session'), false)
    })

    it('blokada dziala TAKZE tym wejsciem, nie tylko przez formularz projektu', async () => {
      const u = await konto(portalA.id, 'any-lock')

      for (let i = 0; i < MAX_ATTEMPTS; i++) {
        await loginAnyPOST(post('/api/auth/login-any', { email: u.email, password: 'zle' }))
      }
      const res = await loginAnyPOST(post('/api/auth/login-any', { email: u.email, password: 'zle' }))

      // Gdyby to wejscie mialo wlasny licznik albo zaden, byloby obejsciem
      // limitu z drugiego wejscia, a napastnik wybralby to slabsze.
      assert.strictEqual(res.status, 429)
    })

    it('brak hasla -> 400', async () => {
      const res = await loginAnyPOST(post('/api/auth/login-any', { email: 'a@b.c' }))
      assert.strictEqual(res.status, 400)
    })
  })

  describe('POST /api/auth/logout', () => {
    it('kasuje wiersz sesji z bazy, nie tylko ciasteczko', async () => {
      const u = await konto(portalA.id, 'wyloguj')
      await loginPOST(post('/api/auth/login', { email: u.email, password: HASLO, slug: portalA.slug }))
      const ciastko = cookieJar.get('portal_session')!

      await logoutPOST()

      const wiersze = await db.select().from(sessions).where(eq(sessions.tokenHash, hashToken(ciastko)))
      // Samo skasowanie ciasteczka zostawialoby wazny token: kto go przechwycil
      // wczesniej, dalej by go uzywal.
      assert.strictEqual(wiersze.length, 0)
      assert.strictEqual(cookieJar.has('portal_session'), false)
    })
  })

  describe('POST /api/auth/set-password (haslo z zaproszenia)', () => {
    it('ustawia haslo, loguje od razu i zapisuje DWA osobne zdarzenia', async () => {
      const u = await konto(portalA.id, 'set-ok')
      const { token } = await createInvite(u.id, portalA.id, 'invite')

      const res = await setPasswordPOST(
        post('/api/auth/set-password', { token, password: 'nowe-dlugie-haslo' })
      )

      assert.strictEqual(res.status, 200)
      assert.ok(cookieJar.has('portal_session'), 'zalogowany od razu, bez drugiego wpisywania hasla')

      // Ustawienie hasla i wejscie to osobne fakty. Bez pierwszego nie da sie
      // odpowiedziec "czy on kiedykolwiek odebral zaproszenie".
      assert.strictEqual((await zdarzenia(portalA.id, u.id, 'password_set')).length, 1)
      assert.strictEqual((await zdarzenia(portalA.id, u.id, 'login')).length, 1)

      // Powiadomienie o zmianie hasla to zabezpieczenie, nie uprzejmosc:
      // bez niego przejecie konta przez skrzynke jest ciche.
      assert.strictEqual(passwordNotice.sendPasswordChangedNotice.mock.calls.length, 1)
    })

    it('nowe haslo faktycznie dziala przy logowaniu', async () => {
      const u = await konto(portalA.id, 'set-dziala')
      const { token } = await createInvite(u.id, portalA.id, 'invite')
      await setPasswordPOST(post('/api/auth/set-password', { token, password: 'calkiem-nowe-haslo' }))
      cookieJar.clear()

      const res = await loginPOST(
        post('/api/auth/login', { email: u.email, password: 'calkiem-nowe-haslo', slug: portalA.slug })
      )

      // Bez tego test wyzej przechodzilby takze wtedy, gdyby haslo zapisalo sie
      // w postaci, ktorej bcrypt nigdy nie potwierdzi.
      assert.strictEqual(res.status, 200)
    })

    it('ten sam token drugi raz -> odmowa', async () => {
      const u = await konto(portalA.id, 'set-dwa-razy')
      const { token } = await createInvite(u.id, portalA.id, 'invite')
      await setPasswordPOST(post('/api/auth/set-password', { token, password: 'pierwsze-haslo-x' }))
      cookieJar.clear()

      const res = await setPasswordPOST(post('/api/auth/set-password', { token, password: 'drugie-haslo-x' }))

      assert.ok(res.status >= 400, 'zuzyty link nie ustawia hasla po raz drugi')
      assert.strictEqual(cookieJar.has('portal_session'), false)
    })

    it('za krotkie haslo odrzucone i token NIE zostaje zuzyty', async () => {
      const u = await konto(portalA.id, 'set-krotkie')
      const { token } = await createInvite(u.id, portalA.id, 'invite')

      const odrzucone = await setPasswordPOST(post('/api/auth/set-password', { token, password: 'krotkie' }))
      assert.strictEqual(odrzucone.status, 400)

      // Gdyby literowka w hasle spalala zaproszenie, uzytkownik zostawalby
      // z martwym linkiem i musial prosic o nowy.
      const drugie = await setPasswordPOST(
        post('/api/auth/set-password', { token, password: 'tym-razem-dosc-dlugie' })
      )
      assert.strictEqual(drugie.status, 200)
    })

    it('nieznany token -> 400', async () => {
      const res = await setPasswordPOST(
        post('/api/auth/set-password', { token: 'x'.repeat(40), password: 'jakies-dlugie-haslo' })
      )
      assert.strictEqual(res.status, 400)
    })
  })

  /**
   * RESET HASLA — trasa publiczna, wiec odpowiedz nie moze zdradzac, czy konto
   * istnieje. Inaczej formularz „nie pamietam hasla" byl by narzedziem do
   * sprawdzania, kto jest klientem important.is.
   */
  describe('POST /api/auth/forgot-password', () => {
    it('istniejace konto dostaje maila', async () => {
      const u = await konto(portalA.id, 'reset-ok')

      const res = await forgotPOST(post('/api/auth/forgot-password', { email: u.email, slug: portalA.slug }))

      assert.strictEqual(res.status, 200)
      assert.strictEqual(mailer.sendMail.mock.calls.length, 1)
      assert.strictEqual(mailer.sendMail.mock.calls[0][0].kind, 'reset')
    })

    it('NIEISTNIEJACE konto dostaje IDENTYCZNA odpowiedz i zadnego maila', async () => {
      const u = await konto(portalA.id, 'reset-porownanie')
      const istniejace = await forgotPOST(
        post('/api/auth/forgot-password', { email: u.email, slug: portalA.slug })
      )
      const trescIstniejacego = await istniejace.json()
      vi.clearAllMocks()

      const nieistniejace = await forgotPOST(
        post('/api/auth/forgot-password', { email: 'nikt@example.com', slug: portalA.slug })
      )

      assert.strictEqual(nieistniejace.status, istniejace.status)
      assert.deepStrictEqual(await nieistniejace.json(), trescIstniejacego, 'odpowiedzi nie do odroznienia')
      assert.strictEqual(mailer.sendMail.mock.calls.length, 0, 'nie zasypujemy cudzej skrzynki')
    })

    it('konto wylaczone nie dostaje linku, ale odpowiedz jest ta sama', async () => {
      const u = await konto(portalA.id, 'reset-off')
      await db.update(portalUsers).set({ isActive: false }).where(eq(portalUsers.id, u.id))

      const res = await forgotPOST(post('/api/auth/forgot-password', { email: u.email, slug: portalA.slug }))

      // Dostep odebrany to dostep odebrany; reset hasla nie moze byc droga powrotna.
      assert.strictEqual(res.status, 200)
      assert.strictEqual(mailer.sendMail.mock.calls.length, 0)
    })

    it('druga prosba pod rzad NIE wysyla drugiego maila', async () => {
      const u = await konto(portalA.id, 'reset-odstep')

      await forgotPOST(post('/api/auth/forgot-password', { email: u.email, slug: portalA.slug }))
      const res = await forgotPOST(post('/api/auth/forgot-password', { email: u.email, slug: portalA.slug }))

      // Bez odstepu kazdy moglby w petli zasypywac cudza skrzynke naszymi
      // mailami, co konczy sie naszym serwerem na czarnej liscie.
      assert.strictEqual(res.status, 200)
      assert.strictEqual(mailer.sendMail.mock.calls.length, 1, 'tylko pierwszy mail wyszedl')
    })

    it('nieistniejacy projekt tez odpowiada neutralnie', async () => {
      const res = await forgotPOST(
        post('/api/auth/forgot-password', { email: 'ktos@example.com', slug: 'nie-ma-projektu' })
      )

      assert.strictEqual(res.status, 200)
      assert.strictEqual(mailer.sendMail.mock.calls.length, 0)
    })

    it('popsute wejscie tez nie zdradza niczego', async () => {
      const res = await forgotPOST(post('/api/auth/forgot-password', { email: 'to-nie-adres' }))

      assert.strictEqual(res.status, 200)
      assert.strictEqual(mailer.sendMail.mock.calls.length, 0)
    })
  })
})
