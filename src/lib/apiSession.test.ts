/**
 * apiSession: jedyna brama tras API portalu klienta.
 *
 * Te testy pilnują GRANICY MIĘDZY KLIENTAMI, więc sprawdzają nie tylko wynik
 * pozytywny, ale też każdą odmowę z osobna i jej kod HTTP. Sześć tras API
 * przechodzi teraz przez tę funkcję, więc rozjazd tutaj rozjeżdża wszystkie.
 *
 * Podstawiamy `portalSession` (odczyt sesji + portalu z bazy), `portalScopeStore`
 * i `clickup`, bo test ma dotyczyć reguły, a nie Postgresa ani sieci.
 *
 *   npx vitest run src/lib/apiSession.test.ts
 */
import { describe, it, beforeEach, vi } from 'vitest'
import assert from 'node:assert'

const { portalSession, scopeStore, clickup } = vi.hoisted(() => ({
  portalSession: { getPortalForSession: vi.fn() },
  scopeStore: { getPortalScope: vi.fn() },
  clickup: { verifyTaskBelongsToFolder: vi.fn() },
}))

vi.mock('./portalSession', () => portalSession)
vi.mock('./portalScopeStore', () => scopeStore)
vi.mock('./clickup', () => clickup)

import { requirePortalApi, requireTaskInPortal } from './apiSession'

const portalRow = {
  id: 'portal-wdf',
  slug: 'wdf',
  name: 'Woda dla Firm',
  clickupFolderId: 'folder-1',
} as unknown as Parameters<typeof requireTaskInPortal>[1]

const sessionRow = {
  userId: 'user-1',
  portalId: 'portal-wdf',
  portalSlug: 'wdf',
  email: 'klient@wdf.pl',
  name: 'Klient',
  expiresAt: new Date('2030-01-01'),
}

beforeEach(() => {
  vi.clearAllMocks()
})

describe('requirePortalApi', () => {
  it('brak sluga -> 400, BEZ pytania bazy o sesje', async () => {
    const result = await requirePortalApi(null)

    assert.strictEqual(result.ok, false)
    if (result.ok) return
    assert.strictEqual(result.response.status, 400)
    // Istotne: nie wchodzimy do bazy, zanim wiemy o jaki portal chodzi.
    assert.strictEqual(portalSession.getPortalForSession.mock.calls.length, 0)
  })

  it('pusty slug traktujemy jak brak', async () => {
    const result = await requirePortalApi('')

    assert.strictEqual(result.ok, false)
    if (result.ok) return
    assert.strictEqual(result.response.status, 400)
  })

  it('brak sesji -> 401', async () => {
    portalSession.getPortalForSession.mockResolvedValue({ ok: false, reason: 'no-session' })

    const result = await requirePortalApi('wdf')

    assert.strictEqual(result.ok, false)
    if (result.ok) return
    assert.strictEqual(result.response.status, 401)
  })

  it('nieistniejacy portal -> 404, nie 401', async () => {
    portalSession.getPortalForSession.mockResolvedValue({ ok: false, reason: 'no-portal' })

    const result = await requirePortalApi('nie-ma-takiego')

    assert.strictEqual(result.ok, false)
    if (result.ok) return
    assert.strictEqual(result.response.status, 404)
  })

  it('sesja wlasciwego portalu -> ok, oddaje sesje i rekord portalu', async () => {
    portalSession.getPortalForSession.mockResolvedValue({
      ok: true,
      session: sessionRow,
      portal: portalRow,
      flags: {},
      branding: {},
    })

    const result = await requirePortalApi('wdf')

    assert.strictEqual(result.ok, true)
    if (!result.ok) return
    assert.strictEqual(result.session.portalSlug, 'wdf')
    assert.strictEqual(result.portal.id, 'portal-wdf')
  })

  it('slug z zadania idzie do sprawdzenia DOKLADNIE taki, jaki przyszedl', async () => {
    portalSession.getPortalForSession.mockResolvedValue({ ok: false, reason: 'no-session' })

    await requirePortalApi('onyx')

    assert.strictEqual(portalSession.getPortalForSession.mock.calls[0][0], 'onyx')
  })

  /**
   * Granica miedzy klientami. Zawezenie sesji klienta do JEGO portalu robi
   * `getSession(slug)` wewnatrz `getPortalForSession`, wiec tutaj sprawdzamy
   * kontrakt: gdy tamta warstwa mowi "nie ta sesja", brama NIE przepuszcza i
   * NIE probuje ratowac sytuacji wlasnym zapytaniem o portal.
   */
  it('odmowa warstwy nizej nie jest obchodzona wlasnym zapytaniem o portal', async () => {
    portalSession.getPortalForSession.mockResolvedValue({ ok: false, reason: 'no-session' })

    const result = await requirePortalApi('onyx')

    assert.strictEqual(result.ok, false)
    assert.strictEqual(portalSession.getPortalForSession.mock.calls.length, 1)
  })
})

describe('requireTaskInPortal', () => {
  it('zadanie w folderze i zakresie -> ok', async () => {
    scopeStore.getPortalScope.mockResolvedValue([])
    clickup.verifyTaskBelongsToFolder.mockResolvedValue(true)

    const result = await requireTaskInPortal('task-1', portalRow)

    assert.strictEqual(result.ok, true)
  })

  it('zadanie spoza portalu -> 403', async () => {
    scopeStore.getPortalScope.mockResolvedValue([])
    clickup.verifyTaskBelongsToFolder.mockResolvedValue(false)

    const result = await requireTaskInPortal('task-obcy', portalRow)

    assert.strictEqual(result.ok, false)
    if (result.ok) return
    assert.strictEqual(result.response.status, 403)
  })

  it('zakres list portalu jest przekazywany do sprawdzenia, nie pomijany', async () => {
    scopeStore.getPortalScope.mockResolvedValue(['lista-a', 'lista-b'])
    clickup.verifyTaskBelongsToFolder.mockResolvedValue(true)

    await requireTaskInPortal('task-1', portalRow)

    const [taskId, folderId, scope] = clickup.verifyTaskBelongsToFolder.mock.calls[0]
    assert.strictEqual(taskId, 'task-1')
    assert.strictEqual(folderId, 'folder-1')
    assert.deepStrictEqual(scope, ['lista-a', 'lista-b'])
  })

  it('zakres pytamy o id portalu z sesji, nie o folder', async () => {
    scopeStore.getPortalScope.mockResolvedValue([])
    clickup.verifyTaskBelongsToFolder.mockResolvedValue(true)

    await requireTaskInPortal('task-1', portalRow)

    assert.strictEqual(scopeStore.getPortalScope.mock.calls[0][0], 'portal-wdf')
  })
})
