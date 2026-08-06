import { describe, it, beforeAll, afterAll, beforeEach, vi } from 'vitest'
import assert from 'node:assert'
import { createHmac } from 'node:crypto'
import { eq } from 'drizzle-orm'
import { db } from '@/lib/db'
import { sessions, portalUsers } from '@/lib/db/schema'
import { isDbReachable, createTestPortal, dropTestPortal, createTestUser } from './helpers'

/**
 * `requirePortalApi` na PRAWDZIWYM Postgresie — ŚCIEŻKA SUKCESU.
 *
 * Testy jednostkowe w src/lib/apiSession.test.ts sprawdzają samą regułę z
 * podstawionym `getPortalForSession`, więc dowodzą tylko tego, że brama poprawnie
 * tłumaczy odpowiedź warstwy niżej na kod HTTP. Nie dowodzą, że ta warstwa
 * cokolwiek przepuszcza. Tutaj idzie cały łańcuch: ciasteczko, JOIN po sesji,
 * rekord portalu, prawdziwy HMAC admina.
 *
 * Ta granica jest jedynym, co dzieli dane klientów, i przechodzi przez nią osiem
 * tras API. Odmowa działająca z powodu awarii wygląda tak samo jak odmowa
 * działająca z powodu reguły, dlatego każdy test odmowy ma tu parę, która
 * dowodzi, że ta sama konfiguracja PRZEPUSZCZA uprawnionego.
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

import { createSession, setSessionCookie, hashToken } from '@/lib/auth'
import { requirePortalApi } from '@/lib/apiSession'

const dbUp = await isDbReachable()

function signAdminCookie(): string {
  return createHmac('sha256', process.env.ADMIN_SECRET!).update('admin-session').digest('hex')
}

describe.skipIf(!dbUp)('requirePortalApi na prawdziwym Postgresie', () => {
  let portalA: { id: string; slug: string }
  let portalB: { id: string; slug: string }
  let userA: string

  beforeAll(async () => {
    portalA = await createTestPortal('gate-a')
    portalB = await createTestPortal('gate-b')
    userA = await createTestUser(portalA.id, `user-${portalA.slug}@example.com`)
  })

  afterAll(async () => {
    if (portalA) await dropTestPortal(portalA.id)
    if (portalB) await dropTestPortal(portalB.id)
  })

  beforeEach(() => {
    cookieJar.clear()
  })

  async function loginAs(userId: string): Promise<void> {
    const token = await createSession(userId, '127.0.0.1', 'vitest')
    await setSessionCookie(token)
  }

  it('klient na WLASNYM portalu przechodzi i dostaje wlasciwy rekord', async () => {
    await loginAs(userA)

    const gate = await requirePortalApi(portalA.slug)

    assert.strictEqual(gate.ok, true)
    if (!gate.ok) return
    assert.strictEqual(gate.session.userId, userA)
    assert.strictEqual(gate.portal.id, portalA.id)
    assert.strictEqual(gate.portal.slug, portalA.slug)
    // Rekord portalu jest pelny, bo trasy czytaja z niego clickupFolderId i nazwe.
    assert.strictEqual(gate.portal.clickupFolderId, `fake-${portalA.slug}`)
  })

  it('klient portalu A NIE przechodzi na portal B, mimo waznej sesji', async () => {
    await loginAs(userA)

    const gate = await requirePortalApi(portalB.slug)

    assert.strictEqual(gate.ok, false)
    if (gate.ok) return
    assert.strictEqual(gate.response.status, 401)
  })

  it('wygasla sesja nie przechodzi (realne gt(expiresAt, now))', async () => {
    const token = await createSession(userA, '127.0.0.1', 'vitest')
    await setSessionCookie(token)
    await db
      .update(sessions)
      .set({ expiresAt: new Date(Date.now() - 1000) })
      .where(eq(sessions.tokenHash, hashToken(token)))

    const gate = await requirePortalApi(portalA.slug)

    assert.strictEqual(gate.ok, false)
    if (gate.ok) return
    assert.strictEqual(gate.response.status, 401)
  })

  it('deaktywowany uzytkownik nie przechodzi mimo waznego tokenu', async () => {
    const deactivated = await createTestUser(portalA.id, `deact-gate-${portalA.slug}@example.com`)
    await db.update(portalUsers).set({ isActive: false }).where(eq(portalUsers.id, deactivated))
    await loginAs(deactivated)

    const gate = await requirePortalApi(portalA.slug)

    assert.strictEqual(gate.ok, false)
    if (gate.ok) return
    assert.strictEqual(gate.response.status, 401)
  })

  it('bez zadnego ciasteczka -> 401', async () => {
    const gate = await requirePortalApi(portalA.slug)

    assert.strictEqual(gate.ok, false)
    if (gate.ok) return
    assert.strictEqual(gate.response.status, 401)
  })

  describe('obejscie admina', () => {
    it.skipIf(!process.env.ADMIN_SECRET)(
      'admin (prawdziwy HMAC) przechodzi na DOWOLNY portal klienta',
      async () => {
        cookieJar.set('admin_session', signAdminCookie())

        const gate = await requirePortalApi(portalB.slug)

        assert.strictEqual(gate.ok, true)
        if (!gate.ok) return
        assert.strictEqual(gate.session.userId, 'admin')
        assert.strictEqual(gate.portal.id, portalB.id)
      }
    )

    /**
     * TO JEST TEN BLAD.
     *
     * Obejscie admina w `getSession` jest zabezpieczone przez `if (slug)`, wiec
     * dziala WYLACZNIE dla nazwanego portalu. `TaskDrawer` wolal `/comments` bez
     * `?slug=`, przez co admin ogladajacy portal klienta widzial pusty watek
     * komentarzy, a formularz odpowiedzi cicho odbijal sie o 401. Zalaczniki w
     * tej samej szufladzie dzialaly, bo tamto wywolanie slug mialo.
     *
     * Brama wymaga teraz sluga i mowi to wprost kodem 400, zamiast udawac, ze
     * admin nie ma uprawnien. Ten test pilnuje obu polowek naraz: bez sluga
     * odmowa, z tym samym ciasteczkiem i slugiem przejscie.
     */
    it.skipIf(!process.env.ADMIN_SECRET)(
      'to samo ciasteczko admina BEZ sluga -> 400, nie ciche 401',
      async () => {
        cookieJar.set('admin_session', signAdminCookie())

        const bezSluga = await requirePortalApi(undefined)
        assert.strictEqual(bezSluga.ok, false)
        if (bezSluga.ok) return
        assert.strictEqual(bezSluga.response.status, 400)

        const zeSlugiem = await requirePortalApi(portalB.slug)
        assert.strictEqual(zeSlugiem.ok, true, 'to samo ciasteczko ze slugiem przechodzi')
      }
    )

    /**
     * ZMIERZONE, nie zalozone. Pisalem ten test z oczekiwaniem 404 i dostalem
     * 401 — i 401 jest tu odpowiedzia WLASCIWA.
     *
     * Powod: zanim brama ma sesje, portal jest juz potwierdzony. Dla klienta
     * przez JOIN w `getSession`, dla admina przez jego wlasne wyszukanie portalu
     * po slugu, ktore przy braku portalu zwraca null. Galaz `no-portal` w
     * `getPortalForSession` jest wiec osiagalna praktycznie tylko przy wyscigu
     * (portal skasowany miedzy jednym zapytaniem a drugim).
     *
     * Skutek uboczny jest korzystny i wart pilnowania: odpowiedz na nieistniejacy
     * projekt jest NIEODROZNIALNA od odpowiedzi na brak uprawnien, wiec ta trasa
     * nie jest sposobem na sprawdzanie, ktore projekty istnieja.
     */
    it.skipIf(!process.env.ADMIN_SECRET)(
      'NIEISTNIEJACY portal jest nieodrozninalny od braku uprawnien (401)',
      async () => {
        cookieJar.set('admin_session', signAdminCookie())

        const nieistniejacy = await requirePortalApi('portal-ktorego-nie-ma-xyz')
        assert.strictEqual(nieistniejacy.ok, false)
        if (nieistniejacy.ok) return
        assert.strictEqual(nieistniejacy.response.status, 401)

        // Dla porownania: to samo ciasteczko na ISTNIEJACYM portalu przechodzi,
        // wiec 401 wyzej pochodzi z nieistnienia portalu, a nie z zepsutej sesji.
        const istniejacy = await requirePortalApi(portalB.slug)
        assert.strictEqual(istniejacy.ok, true)
      }
    )

    it('podrobione ciasteczko admina nie przechodzi (HMAC nie zgadza sie)', async () => {
      cookieJar.set('admin_session', 'cokolwiek-nieprawidlowego')

      const gate = await requirePortalApi(portalB.slug)

      assert.strictEqual(gate.ok, false)
      if (gate.ok) return
      assert.strictEqual(gate.response.status, 401)
    })
  })
})
