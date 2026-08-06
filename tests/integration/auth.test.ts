import { describe, it, beforeAll, afterAll, beforeEach, vi } from 'vitest'
import assert from 'node:assert'
import { createHmac } from 'node:crypto'
import { eq } from 'drizzle-orm'
import { db } from '@/lib/db'
import { sessions, portalUsers } from '@/lib/db/schema'
import { isDbReachable, createTestPortal, dropTestPortal, createTestUser } from './helpers'

/**
 * Sesje i logowanie na PRAWDZIWYM Postgresie.
 *
 * Testy jednostkowe w src/lib/auth.test.ts pilnuja logiki decyzyjnej z
 * podstawionym zapytaniem. Tutaj sprawdzamy rzeczy, ktorych mock nie widzi,
 * bo blad siedzi w SQL-u, nie w funkcji:
 * - realny JOIN sessions/portal_users/portals (nie kanciasta atrapa),
 * - realne `gt(expiresAt, now)`, czyli faktyczne wygasanie sesji,
 * - realne kasowanie wiersza przy wylogowaniu,
 * - obejscie admina liczone prawdziwym HMAC-iem, nie mockiem `admin-auth`.
 *
 * `cookies()` z next/headers dziala tylko w request scope Next.js, wiec jest
 * podstawione w pamieci — to jedyna czesc tego modulu, ktora NIE jest o SQL.
 *
 *   docker start cp-test-pg && npm run test:integration
 */
const { cookieJar } = vi.hoisted(() => ({ cookieJar: new Map<string, string>() }))

vi.mock('next/headers', () => ({
  cookies: vi.fn(async () => ({
    get: (name: string) => (cookieJar.has(name) ? { value: cookieJar.get(name)! } : undefined),
    set: (name: string, value: string) => {
      cookieJar.set(name, value)
    },
    delete: (name: string) => {
      cookieJar.delete(name)
    },
  })),
}))

import { createSession, getSession, setSessionCookie, deleteSessionCookie, hashToken } from '@/lib/auth'

const dbUp = await isDbReachable()

function signAdminCookie(): string {
  // Ten sam algorytm co src/lib/admin-auth.ts — celowo zduplikowany, zeby test
  // sprawdzal prawdziwy HMAC, a nie podstawiony `getAdminSession`.
  return createHmac('sha256', process.env.ADMIN_SECRET!).update('admin-session').digest('hex')
}

describe.skipIf(!dbUp)('sesje na prawdziwym Postgresie', () => {
  let portalA: { id: string; slug: string }
  let portalB: { id: string; slug: string }
  let userA: string

  beforeAll(async () => {
    portalA = await createTestPortal('auth-a')
    portalB = await createTestPortal('auth-b')
    userA = await createTestUser(portalA.id, `user-${portalA.slug}@example.com`)
  })

  afterAll(async () => {
    if (portalA) await dropTestPortal(portalA.id)
    if (portalB) await dropTestPortal(portalB.id)
  })

  beforeEach(() => {
    cookieJar.clear()
  })

  it('utworzona sesja pozwala odczytac dane wlasnego portalu (realny JOIN)', async () => {
    const token = await createSession(userA, '127.0.0.1', 'vitest')
    await setSessionCookie(token)

    const session = await getSession(portalA.slug)

    assert.ok(session)
    assert.strictEqual(session?.userId, userA)
    assert.strictEqual(session?.portalId, portalA.id)
    assert.strictEqual(session?.portalSlug, portalA.slug)
  })

  it('sesja klienta A nie dziala na portalu B, mimo waznego tokenu (bez admina)', async () => {
    const token = await createSession(userA, '127.0.0.1', 'vitest')
    await setSessionCookie(token)

    const session = await getSession(portalB.slug)
    assert.strictEqual(session, null)
  })

  it('wygasla sesja nie loguje, mimo poprawnego hasha w bazie (realne gt(expiresAt, now))', async () => {
    const token = await createSession(userA, '127.0.0.1', 'vitest')
    await setSessionCookie(token)

    await db
      .update(sessions)
      .set({ expiresAt: new Date(Date.now() - 1000) })
      .where(eq(sessions.tokenHash, hashToken(token)))

    const session = await getSession(portalA.slug)
    assert.strictEqual(session, null)
  })

  it('wylogowanie faktycznie usuwa wiersz sesji z bazy, nie tylko ciasteczko', async () => {
    const token = await createSession(userA, '127.0.0.1', 'vitest')
    await setSessionCookie(token)

    await deleteSessionCookie()

    const rows = await db.select().from(sessions).where(eq(sessions.tokenHash, hashToken(token)))
    assert.strictEqual(rows.length, 0)
    assert.strictEqual(await getSession(portalA.slug), null)
  })

  it('deaktywowany uzytkownik traci dostep mimo waznego, niewygaslego tokenu', async () => {
    const deactivated = await createTestUser(portalA.id, `deact-${portalA.slug}@example.com`)
    await db.update(portalUsers).set({ isActive: false }).where(eq(portalUsers.id, deactivated))

    const token = await createSession(deactivated, '127.0.0.1', 'vitest')
    await setSessionCookie(token)

    const session = await getSession(portalA.slug)
    assert.strictEqual(session, null)
  })

  it.skipIf(!process.env.ADMIN_SECRET)(
    'sesja admina (prawdziwy HMAC, nie mock) daje dostep do dowolnego portalu klienta',
    async () => {
      cookieJar.set('admin_session', signAdminCookie())

      const session = await getSession(portalB.slug)

      assert.ok(session)
      assert.strictEqual(session?.userId, 'admin')
      assert.strictEqual(session?.portalId, portalB.id)
      assert.strictEqual(session?.portalSlug, portalB.slug)
    }
  )

  it('ciasteczko admina z bledna wartoscia nie daje dostepu (HMAC nie przechodzi)', async () => {
    cookieJar.set('admin_session', 'cokolwiek-nieprawidlowego')

    const session = await getSession(portalB.slug)
    assert.strictEqual(session, null)
  })
})
