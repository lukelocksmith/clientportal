/**
 * Zaproszenia na prawdziwym Postgresie.
 *
 * Ryzyko tego modulu: token wielokrotnego uzytku albo niewygasajacy oznacza
 * obce wejscie na konto klienta. Testy jednostkowe w src/lib/invites.test.ts
 * pilnuja czystej logiki (TTL, hash, straznik dlugosci). Tutaj sprawdzamy to,
 * co siedzi w zapytaniach SQL: jednorazowosc pod wyscigiem, wygasanie,
 * uniewaznianie starych zaproszen i izolacje miedzy portalami.
 *
 *   docker start cp-test-pg && npm run test:integration
 *
 * Kazdy test ma wlasny portal/uzytkownika o losowym slugu i kasuje po sobie.
 */
import { describe, it, beforeAll, afterAll, expect } from 'vitest'
import assert from 'node:assert'
import { eq, sql } from 'drizzle-orm'
import { db } from '@/lib/db'
import { userInvites, portalUsers } from '@/lib/db/schema'
import {
  createInvite,
  checkInvite,
  consumeInvite,
  resetRequestedRecently,
  hasPendingInvite,
  hashInviteToken,
  RESET_COOLDOWN_MINUTES,
} from '@/lib/invites'
import { isDbReachable, createTestPortal, dropTestPortal, createTestUser } from './helpers'
import bcrypt from 'bcryptjs'

const dbUp = await isDbReachable()

describe.skipIf(!dbUp)('zaproszenia w bazie', () => {
  let portalId: string
  let portalSlug: string
  let userId: string

  beforeAll(async () => {
    const portal = await createTestPortal('invite')
    portalId = portal.id
    portalSlug = portal.slug
    userId = await createTestUser(portalId, `user-${portal.slug}@example.com`)
  })

  afterAll(async () => {
    if (portalId) await dropTestPortal(portalId)
  })

  it('tokenu nie da sie uzyc drugi raz', async () => {
    const { token } = await createInvite(userId, portalId, 'invite')

    const pierwszy = await consumeInvite(token, 'NoweHaslo123!')
    assert.strictEqual(pierwszy.ok, true)

    const drugi = await consumeInvite(token, 'InneHaslo456!')
    assert.deepStrictEqual(drugi, { ok: false, reason: 'used' })
  })

  it('surowy token nie trafia do bazy — zapisany jest tylko jego hash', async () => {
    const { token } = await createInvite(userId, portalId, 'invite')

    const [row] = await db
      .select({ tokenHash: userInvites.tokenHash })
      .from(userInvites)
      .where(eq(userInvites.tokenHash, hashInviteToken(token)))
      .limit(1)

    assert.ok(row, 'wiersz zaproszenia powinien istniec')
    assert.strictEqual(row.tokenHash, hashInviteToken(token))
    assert.notStrictEqual(row.tokenHash, token)

    // Szukanie surowego tokenu jako gdyby byl hashem nie powinno trafic w nic.
    const [obcy] = await db
      .select({ id: userInvites.id })
      .from(userInvites)
      .where(eq(userInvites.tokenHash, token))
      .limit(1)
    assert.strictEqual(obcy, undefined)
  })

  it('wygasly token jest odrzucany, mimo ze nigdy nie zostal uzyty', async () => {
    const { token } = await createInvite(userId, portalId, 'invite')

    // Cofamy wygasniecie w przeszlosc bezposrednio w bazie — jedyny sposob,
    // zeby przetestowac wygasanie bez czekania realnych godzin.
    await db.execute(
      sql`UPDATE user_invites SET expires_at = now() - interval '1 hour' WHERE token_hash = ${hashInviteToken(token)}`
    )

    const sprawdzenie = await checkInvite(token)
    assert.deepStrictEqual(sprawdzenie, { ok: false, reason: 'expired' })

    const proba = await consumeInvite(token, 'CosNowego123!')
    assert.deepStrictEqual(proba, { ok: false, reason: 'expired' })
  })

  it('nieistniejacy (wymyslony) token to "not-found"', async () => {
    const wymyslony = 'f'.repeat(64)
    assert.deepStrictEqual(await checkInvite(wymyslony), { ok: false, reason: 'not-found' })
  })

  it('nowe zaproszenie uniewaznia poprzednie, niewykorzystane zaproszenie TEGO SAMEGO uzytkownika', async () => {
    const pierwsze = await createInvite(userId, portalId, 'invite')
    const drugie = await createInvite(userId, portalId, 'invite')

    assert.deepStrictEqual(await checkInvite(pierwsze.token), { ok: false, reason: 'used' })

    const sprawdzenieDrugiego = await checkInvite(drugie.token)
    assert.strictEqual(sprawdzenieDrugiego.ok, true)
  })

  it('zaproszenie jednego portalu nie otwiera innego', async () => {
    const innyPortal = await createTestPortal('invite-other')
    const innyUser = await createTestUser(innyPortal.id, `obcy-${innyPortal.slug}@example.com`)
    try {
      const wlasny = await createInvite(userId, portalId, 'invite')
      const obcy = await createInvite(innyUser, innyPortal.id, 'invite')

      const sprawdzenieWlasnego = await checkInvite(wlasny.token)
      assert.strictEqual(sprawdzenieWlasnego.ok, true)
      if (sprawdzenieWlasnego.ok) {
        assert.strictEqual(sprawdzenieWlasnego.portalId, portalId)
        assert.strictEqual(sprawdzenieWlasnego.portalSlug, portalSlug)
        assert.notStrictEqual(sprawdzenieWlasnego.portalId, innyPortal.id)
      }

      const sprawdzenieObcego = await checkInvite(obcy.token)
      assert.strictEqual(sprawdzenieObcego.ok, true)
      if (sprawdzenieObcego.ok) {
        assert.strictEqual(sprawdzenieObcego.portalId, innyPortal.id)
        assert.notStrictEqual(sprawdzenieObcego.portalId, portalId)
      }

      // Uzycie tokenu z obcego portalu NIE zuzywa tokenu wlasnego portalu.
      await consumeInvite(obcy.token, 'HasloObce123!')
      const wciazWazny = await checkInvite(wlasny.token)
      assert.strictEqual(wciazWazny.ok, true)
    } finally {
      await dropTestPortal(innyPortal.id)
    }
  })

  it('rownoczesne zuzycie tego samego tokenu: dokladnie jedno powodzenie', async () => {
    const { token } = await createInvite(userId, portalId, 'invite')

    const [a, b] = await Promise.all([
      consumeInvite(token, 'WyscigA123!'),
      consumeInvite(token, 'WyscigB123!'),
    ])

    const wyniki = [a, b]
    const udane = wyniki.filter(r => r.ok === true)
    const nieudane = wyniki.filter(r => r.ok === false)
    assert.strictEqual(udane.length, 1, 'dokladnie jedno z rownoleglych zuzyc powinno przejsc')
    assert.strictEqual(nieudane.length, 1)
    assert.deepStrictEqual(nieudane[0], { ok: false, reason: 'used' })
  })

  it('zuzycie zaproszenia ustawia nowe haslo i odblokowuje konto', async () => {
    const zablokowany = await createTestUser(portalId, `zablokowany-${Math.random()}@example.com`)
    await db.execute(
      sql`UPDATE portal_users SET is_active = false, failed_attempts = 5, locked_until = now() + interval '1 hour' WHERE id = ${zablokowany}`
    )

    const { token } = await createInvite(zablokowany, portalId, 'invite')
    const wynik = await consumeInvite(token, 'NoweBezpieczneHaslo1!')
    assert.strictEqual(wynik.ok, true)

    const [row] = await db
      .select()
      .from(portalUsers)
      .where(eq(portalUsers.id, zablokowany))
      .limit(1)

    assert.strictEqual(row.isActive, true)
    assert.strictEqual(row.failedAttempts, 0)
    assert.strictEqual(row.lockedUntil, null)
    assert.strictEqual(await bcrypt.compare('NoweBezpieczneHaslo1!', row.passwordHash), true)
  })

  it('limit czestotliwosci resetu liczy TYLKO zaproszenia typu "reset"', async () => {
    const swiezy = await createTestUser(portalId, `reset-limit-${Math.random()}@example.com`)

    assert.strictEqual(await resetRequestedRecently(swiezy), false)

    // Zwykle zaproszenie (invite) nie powinno wliczac sie do limitu resetu.
    await createInvite(swiezy, portalId, 'invite')
    assert.strictEqual(await resetRequestedRecently(swiezy), false)

    await createInvite(swiezy, portalId, 'reset')
    assert.strictEqual(await resetRequestedRecently(swiezy), true)
  })

  it('po uplywie okna czasu reset przestaje byc "niedawny"', async () => {
    const swiezy = await createTestUser(portalId, `reset-window-${Math.random()}@example.com`)
    const { token } = await createInvite(swiezy, portalId, 'reset')

    assert.strictEqual(await resetRequestedRecently(swiezy, RESET_COOLDOWN_MINUTES), true)

    // Cofamy moment prosby poza okno cooldownu.
    await db.execute(
      sql`UPDATE user_invites SET created_at = now() - interval '1 hour' WHERE token_hash = ${hashInviteToken(token)}`
    )

    assert.strictEqual(await resetRequestedRecently(swiezy, RESET_COOLDOWN_MINUTES), false)
  })

  it('hasPendingInvite: prawda dopoki nie zuzyte i nie wygasle, falsz po zuzyciu', async () => {
    const swiezy = await createTestUser(portalId, `pending-${Math.random()}@example.com`)
    assert.strictEqual(await hasPendingInvite(swiezy), false)

    const { token } = await createInvite(swiezy, portalId, 'invite')
    assert.strictEqual(await hasPendingInvite(swiezy), true)

    await consumeInvite(token, 'JakiesHaslo123!')
    assert.strictEqual(await hasPendingInvite(swiezy), false)
  })

  it('hasPendingInvite: falsz, gdy jedyne zaproszenie jest wygasle', async () => {
    const swiezy = await createTestUser(portalId, `pending-expired-${Math.random()}@example.com`)
    const { token } = await createInvite(swiezy, portalId, 'invite')

    await db.execute(
      sql`UPDATE user_invites SET expires_at = now() - interval '1 minute' WHERE token_hash = ${hashInviteToken(token)}`
    )

    assert.strictEqual(await hasPendingInvite(swiezy), false)
  })
})

// Gdy baza nie stoi, testy same sie pomijaja. Ten komunikat ma sprawic, ze
// pominiecie nie przejdzie niezauwazone: `npm run verify` konczy sie wtedy
// na zielono, mimo ze nic z tego pliku nie zostalo sprawdzone.
if (!dbUp) {
  describe('zaproszenia w bazie', () => {
    it.skip('POMINIETE: brak Postgresa na localhost:5433 (docker start cp-test-pg)', () => {
      expect(true).toBe(true)
    })
  })
}
