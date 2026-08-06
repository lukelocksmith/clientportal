/**
 * Zaproszenia: czysta logika bez bazy.
 *
 * `checkInvite` importuje `db`, ale jego strażnik długości tokenu wraca
 * PRZED jakimkolwiek zapytaniem SQL, więc jego przypadki brzegowe da się
 * testować tu, bez podstawiania bazy i bez integracyjnego Postgresa.
 * Reszta zachowania opartego na SQL (jednorazowość, wygasanie, izolacja
 * portali) jest w tests/integration/invites.test.ts.
 */
import { describe, it } from 'vitest'
import assert from 'node:assert'
import bcrypt from 'bcryptjs'
import {
  ttlHoursFor,
  hashInviteToken,
  unusablePasswordHash,
  checkInvite,
  INVITE_TTL_HOURS,
  RESET_TTL_HOURS,
} from './invites'

describe('ttlHoursFor', () => {
  it('zaproszenie ("invite") dostaje dlugi czas zycia — klient moze nie zajrzec do skrzynki od razu', () => {
    assert.strictEqual(ttlHoursFor('invite'), INVITE_TTL_HOURS)
    assert.strictEqual(ttlHoursFor('invite'), 72)
  })

  it('reset hasla dostaje krotszy czas zycia — mniejsze okno na przechwycony mail', () => {
    assert.strictEqual(ttlHoursFor('reset'), RESET_TTL_HOURS)
    assert.strictEqual(ttlHoursFor('reset'), 2)
  })

  it('reset jest krotszy niz zwykle zaproszenie', () => {
    assert.ok(ttlHoursFor('reset') < ttlHoursFor('invite'))
  })
})

describe('hashInviteToken', () => {
  it('jest deterministyczny — ten sam token daje ten sam hash', () => {
    const token = 'a'.repeat(64)
    assert.strictEqual(hashInviteToken(token), hashInviteToken(token))
  })

  it('rozne tokeny daja rozne hashe', () => {
    assert.notStrictEqual(hashInviteToken('a'.repeat(64)), hashInviteToken('b'.repeat(64)))
  })

  it('zwraca SHA-256 w hex (64 znaki), nie surowy token', () => {
    const token = 'sekretny-token-uzytkownika'
    const hash = hashInviteToken(token)
    assert.match(hash, /^[0-9a-f]{64}$/)
    assert.notStrictEqual(hash, token)
  })

  it('nie da sie odtworzyc tokenu z hasha przy pomocy tej samej funkcji (jednokierunkowa)', () => {
    // Sedno bezpieczenstwa opisanego w komentarzu modulu: baza trzyma tylko
    // hash, wiec jej wyciek nie odslania tokenu z maila.
    const token = 'inny-token'
    const hash = hashInviteToken(token)
    assert.notStrictEqual(hashInviteToken(hash), hash)
  })
})

describe('unusablePasswordHash', () => {
  it('zwraca bcryptowy hash (format $2*)', async () => {
    const hash = await unusablePasswordHash()
    assert.match(hash, /^\$2[aby]?\$/)
  })

  it('kazde wywolanie daje inny hash (losowe wejscie, losowa sol)', async () => {
    const [a, b] = await Promise.all([unusablePasswordHash(), unusablePasswordHash()])
    assert.notStrictEqual(a, b)
  })

  it('do hasha nie pasuje zadne przewidywalne hoslo — konto nie jest logowalne przed ustawieniem hasla', async () => {
    const hash = await unusablePasswordHash()
    assert.strictEqual(await bcrypt.compare('', hash), false)
    assert.strictEqual(await bcrypt.compare('password', hash), false)
    assert.strictEqual(await bcrypt.compare('123456', hash), false)
  })
})

describe('checkInvite — strażnik dlugosci PRZED zapytaniem do bazy', () => {
  it('pusty token to "not-found", bez pytania bazy', async () => {
    assert.deepStrictEqual(await checkInvite(''), { ok: false, reason: 'not-found' })
  })

  it('token krotszy niz 16 znakow to "not-found"', async () => {
    assert.deepStrictEqual(await checkInvite('krotki'), { ok: false, reason: 'not-found' })
  })

  it('token dokladnie 15 znakow (granica) to nadal "not-found"', async () => {
    assert.deepStrictEqual(await checkInvite('a'.repeat(15)), { ok: false, reason: 'not-found' })
  })
})
