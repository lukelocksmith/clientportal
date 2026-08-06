/**
 * Sesje i logowanie: najbardziej ryzykowny modul w portalu — blad tutaj
 * oznacza, ze klient A widzi portal klienta B.
 *
 * Granice wychodzace sa podstawione (`vi.mock`): ciasteczka z next/headers,
 * baza (`./db`) i sprawdzenie admina (`./admin-auth`). `eq`/`and`/`gt` z
 * drizzle-orm sa PRAWDZIWE, tylko owiniete `vi.fn`, zeby moc sprawdzic jakich
 * argumentow uzyto (np. czy do bazy leci HASH tokenu, nigdy surowy token).
 *
 * Zapytania z realnym JOIN-em i realnym `gt(expiresAt, now)` (wygasanie sesji)
 * sa przetestowane osobno, na prawdziwym Postgresie: tests/integration/auth.test.ts.
 *
 *   npx vitest run src/lib/auth.test.ts
 */
import { describe, it, beforeEach, vi } from 'vitest'
import assert from 'node:assert'

const { cookieStore, dbMock, adminAuthMock } = vi.hoisted(() => {
  const cookieStore = {
    get: vi.fn(),
    set: vi.fn(),
    delete: vi.fn(),
  }
  const dbMock = {
    select: vi.fn(),
    insert: vi.fn(),
    update: vi.fn(),
    delete: vi.fn(),
  }
  const adminAuthMock = { getAdminSession: vi.fn() }
  return { cookieStore, dbMock, adminAuthMock }
})

vi.mock('next/headers', () => ({
  cookies: vi.fn(() => Promise.resolve(cookieStore)),
}))
vi.mock('./db', () => ({ db: dbMock }))
vi.mock('./admin-auth', () => adminAuthMock)
vi.mock('drizzle-orm', async (importOriginal) => {
  const actual = await importOriginal<typeof import('drizzle-orm')>()
  // Prawdziwa implementacja (nie dotyka bazy), owinieta spyem do asercji.
  return { ...actual, eq: vi.fn(actual.eq), and: vi.fn(actual.and), gt: vi.fn(actual.gt) }
})

import {
  hashToken,
  createSession,
  getSession,
  setSessionCookie,
  deleteSessionCookie,
} from './auth'
import { sessions, portalUsers, portals } from './db/schema'
import { eq } from 'drizzle-orm'

type Chain = Record<string, unknown> & {
  then: (resolve: (v: unknown) => void, reject?: (e: unknown) => void) => Promise<unknown>
}

/** Lancuch drizzle w wersji "zwraca siebie", ktory na koncu jest thenable. */
function chainable(resolved: unknown): Chain {
  const self: Chain = {} as Chain
  const pass = () => self
  self.from = vi.fn(pass)
  self.innerJoin = vi.fn(pass)
  self.where = vi.fn(pass)
  self.limit = vi.fn(pass)
  self.set = vi.fn(pass)
  self.values = vi.fn(pass)
  self.returning = vi.fn(pass)
  self.then = (resolve, reject) => Promise.resolve(resolved).then(resolve, reject)
  return self
}

/** select(), ktore rozroznia zapytanie po tabeli podanej w `.from(...)`. */
function selectChain(byTable: Map<unknown, unknown[]>): Chain {
  const self: Chain = {} as Chain
  let resolvedRows: unknown[] = []
  self.from = vi.fn((table: unknown) => {
    resolvedRows = byTable.get(table) ?? []
    return self
  })
  self.innerJoin = vi.fn(() => self)
  self.where = vi.fn(() => self)
  self.limit = vi.fn(() => self)
  self.then = (resolve, reject) => Promise.resolve(resolvedRows).then(resolve, reject)
  return self
}

/** select(), ktorego zapytanie odrzuca obietnice — symuluje padly fetch do bazy. */
function rejectingSelectChain(err: Error): Chain {
  const self: Chain = {} as Chain
  self.from = vi.fn(() => self)
  self.innerJoin = vi.fn(() => self)
  self.where = vi.fn(() => self)
  self.limit = vi.fn(() => self)
  self.then = (resolve, reject) => Promise.reject(err).then(resolve, reject)
  return self
}

const FIXED_EXPIRY = new Date('2030-01-01T00:00:00.000Z')

function sessionRow(overrides: Record<string, unknown> = {}) {
  return {
    userId: 'user-1',
    expiresAt: FIXED_EXPIRY,
    email: 'anna@klient.pl',
    name: 'Anna Kowalska',
    isActive: true,
    portalId: 'portal-wdf',
    portalSlug: 'wdf',
    ...overrides,
  }
}

beforeEach(() => {
  vi.clearAllMocks()
  cookieStore.get.mockReturnValue(undefined)
  adminAuthMock.getAdminSession.mockResolvedValue(false)
})

describe('hashToken', () => {
  it('jest deterministyczny: ten sam token daje ten sam hash', () => {
    const token = 'abc123'
    assert.strictEqual(hashToken(token), hashToken(token))
  })

  it('rozne tokeny daja rozne hashe', () => {
    assert.notStrictEqual(hashToken('token-a'), hashToken('token-b'))
  })

  it('nigdy nie zwraca surowego tokenu (to nie jest tozsamosc, tylko sha256 hex)', () => {
    const token = 'super-tajny-token'
    assert.notStrictEqual(hashToken(token), token)
    assert.strictEqual(hashToken(token).length, 64)
    assert.match(hashToken(token), /^[0-9a-f]{64}$/)
  })
})

describe('getSession', () => {
  it('brak ciasteczka i brak sluga -> null, bez pytania o admina', async () => {
    const result = await getSession()
    assert.strictEqual(result, null)
    assert.strictEqual(adminAuthMock.getAdminSession.mock.calls.length, 0)
  })

  it('brak ciasteczka, slug podany, admin niezalogowany -> null', async () => {
    const result = await getSession('wdf')
    assert.strictEqual(result, null)
  })

  it('brak ciasteczka, slug podany, admin zalogowany, portal istnieje -> sesja admina do TEGO portalu', async () => {
    adminAuthMock.getAdminSession.mockResolvedValue(true)
    dbMock.select.mockReturnValue(selectChain(new Map([[portals, [{ id: 'portal-onyx', slug: 'onyx' }]]])))

    const result = await getSession('onyx')

    assert.ok(result)
    assert.strictEqual(result?.userId, 'admin')
    assert.strictEqual(result?.portalId, 'portal-onyx')
    assert.strictEqual(result?.portalSlug, 'onyx')
  })

  it('admin zalogowany, ale portal o podanym slugu nie istnieje -> null', async () => {
    adminAuthMock.getAdminSession.mockResolvedValue(true)
    dbMock.select.mockReturnValue(selectChain(new Map([[portals, []]])))

    const result = await getSession('nieistniejacy')
    assert.strictEqual(result, null)
  })

  it('wazna sesja wlasnego portalu -> zwraca dane sesji z bazy', async () => {
    cookieStore.get.mockReturnValue({ value: 'raw-token' })
    dbMock.select.mockReturnValue(selectChain(new Map([[sessions, [sessionRow()]]])))

    const result = await getSession('wdf')

    assert.deepStrictEqual(result, {
      userId: 'user-1',
      portalId: 'portal-wdf',
      portalSlug: 'wdf',
      email: 'anna@klient.pl',
      name: 'Anna Kowalska',
      expiresAt: FIXED_EXPIRY,
    })
  })

  it('deaktywowany uzytkownik nie loguje sie mimo poprawnego tokenu (bez sluga, wiec admin nawet nie jest sprawdzany)', async () => {
    cookieStore.get.mockReturnValue({ value: 'raw-token' })
    dbMock.select.mockReturnValue(selectChain(new Map([[sessions, [sessionRow({ isActive: false })]]])))

    const result = await getSession()
    assert.strictEqual(result, null)
  })

  it('sesja klienta A NIE odblokowuje portalu B, gdy admin nie jest zalogowany', async () => {
    cookieStore.get.mockReturnValue({ value: 'raw-token' })
    dbMock.select.mockReturnValue(selectChain(new Map([[sessions, [sessionRow({ portalSlug: 'wdf' })]]])))
    adminAuthMock.getAdminSession.mockResolvedValue(false)

    const result = await getSession('onyx')
    assert.strictEqual(result, null, 'sesja portalu wdf nie moze przejsc jako sesja portalu onyx')
  })

  it('sesja klienta A + admin zalogowany + slug portalu B -> dostaje sesje ADMINA do B, nie przemycona sesje klienta A', async () => {
    cookieStore.get.mockReturnValue({ value: 'raw-token' })
    adminAuthMock.getAdminSession.mockResolvedValue(true)
    dbMock.select.mockReturnValue(
      selectChain(
        // Jawny typ klucza: bez niego TypeScript wnioskuje go z PIERWSZEGO
        // wpisu (tabela sessions) i odrzuca drugi (portals) jako niezgodny.
        new Map<unknown, unknown[]>([
          [sessions, [sessionRow({ portalSlug: 'wdf', portalId: 'portal-wdf' })]],
          [portals, [{ id: 'portal-onyx', slug: 'onyx' }]],
        ])
      )
    )

    const result = await getSession('onyx')

    assert.ok(result)
    assert.strictEqual(result?.userId, 'admin')
    assert.strictEqual(result?.portalId, 'portal-onyx')
    assert.strictEqual(result?.portalSlug, 'onyx')
  })

  it('brak dopasowanego wiersza sesji (np. token sfalszowany albo wygasly) -> null, bez sluga admin sie nie wlacza', async () => {
    cookieStore.get.mockReturnValue({ value: 'nieznany-token' })
    dbMock.select.mockReturnValue(selectChain(new Map([[sessions, []]])))

    const result = await getSession()
    assert.strictEqual(result, null)
    assert.strictEqual(adminAuthMock.getAdminSession.mock.calls.length, 0)
  })

  it('blad zapytania do bazy jest wychwytywany i zwraca null, nie wywala funkcji', async () => {
    cookieStore.get.mockReturnValue({ value: 'raw-token' })
    dbMock.select.mockReturnValue(rejectingSelectChain(new Error('connection refused')))

    const result = await getSession('wdf')
    assert.strictEqual(result, null)
  })
})

describe('setSessionCookie', () => {
  it('ustawia httpOnly cookie na 7 dni scieszki "/"', async () => {
    await setSessionCookie('raw-token-value')

    assert.strictEqual(cookieStore.set.mock.calls.length, 1)
    const [name, value, options] = cookieStore.set.mock.calls[0] as [string, string, Record<string, unknown>]

    assert.strictEqual(name, 'portal_session')
    assert.strictEqual(value, 'raw-token-value')
    assert.strictEqual(options.httpOnly, true, 'token czytelny z JS = podatnosc na kradziez sesji przez XSS')
    assert.strictEqual(options.sameSite, 'lax')
    assert.strictEqual(options.path, '/')
    assert.strictEqual(options.maxAge, 7 * 24 * 60 * 60)
  })
})

describe('deleteSessionCookie', () => {
  it('usuwa ciasteczko i kasuje sesje w bazie po HASHU tokenu, nigdy po surowym tokenie', async () => {
    cookieStore.get.mockReturnValue({ value: 'raw-token-xyz' })
    dbMock.delete.mockReturnValue(chainable(undefined))

    await deleteSessionCookie()

    assert.strictEqual(cookieStore.delete.mock.calls[0][0], 'portal_session')
    assert.strictEqual(dbMock.delete.mock.calls[0][0], sessions)

    const eqSpy = eq as unknown as { mock: { calls: unknown[][] } }
    const usedHash = eqSpy.mock.calls.find(call => call[0] === sessions.tokenHash)?.[1]
    assert.strictEqual(usedHash, hashToken('raw-token-xyz'))
    assert.notStrictEqual(usedHash, 'raw-token-xyz')
  })

  it('brak ciasteczka -> czysci cookie, ale nie odpytuje bazy', async () => {
    cookieStore.get.mockReturnValue(undefined)

    await deleteSessionCookie()

    assert.strictEqual(cookieStore.delete.mock.calls.length, 1)
    assert.strictEqual(dbMock.delete.mock.calls.length, 0)
  })
})

describe('createSession', () => {
  it('zapisuje w bazie HASH tokenu, a surowy token zwraca tylko wolajacemu', async () => {
    const insertChain = chainable(undefined)
    const updateChain = chainable(undefined)
    dbMock.insert.mockReturnValue(insertChain)
    dbMock.update.mockReturnValue(updateChain)

    const before = Date.now()
    const token = await createSession('user-1', '1.2.3.4', 'Mozilla/5.0')
    const after = Date.now()

    assert.strictEqual(typeof token, 'string')
    assert.strictEqual(token.length, 64, 'randomBytes(32).toString(hex) daje 64 znaki')

    assert.strictEqual(dbMock.insert.mock.calls[0][0], sessions)
    const valuesArg = (insertChain.values as ReturnType<typeof vi.fn>).mock.calls[0][0] as Record<
      string,
      unknown
    >

    assert.strictEqual(valuesArg.tokenHash, hashToken(token))
    assert.notStrictEqual(valuesArg.tokenHash, token, 'surowy token nigdy nie powinien trafic do bazy')
    assert.strictEqual(valuesArg.userId, 'user-1')
    assert.strictEqual(valuesArg.ip, '1.2.3.4')
    assert.strictEqual(valuesArg.userAgent, 'Mozilla/5.0')

    const expiresAt = valuesArg.expiresAt as Date
    const sevenDays = 7 * 24 * 60 * 60 * 1000
    assert.ok(expiresAt.getTime() >= before + sevenDays)
    assert.ok(expiresAt.getTime() <= after + sevenDays + 1000)
  })

  it('przy tworzeniu sesji aktualizuje lastLoginAt WLASCIWEGO uzytkownika', async () => {
    const insertChain = chainable(undefined)
    const updateChain = chainable(undefined)
    dbMock.insert.mockReturnValue(insertChain)
    dbMock.update.mockReturnValue(updateChain)

    await createSession('user-42')

    assert.strictEqual(dbMock.update.mock.calls[0][0], portalUsers)
    const setArg = (updateChain.set as ReturnType<typeof vi.fn>).mock.calls[0][0] as Record<string, unknown>
    assert.ok(setArg.lastLoginAt instanceof Date)

    const eqSpy = eq as unknown as { mock: { calls: unknown[][] } }
    const updatedUserId = eqSpy.mock.calls.find(call => call[0] === portalUsers.id)?.[1]
    assert.strictEqual(updatedUserId, 'user-42')
  })
})
