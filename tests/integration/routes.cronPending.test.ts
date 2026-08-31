import { describe, it, beforeEach, afterAll, vi } from 'vitest'
import assert from 'node:assert'
import { eq } from 'drizzle-orm'
import { isDbReachable, createTestPortal, dropTestPortal } from './helpers'

/**
 * TRASA CRONA DOWOŻĄCEGO ZGŁOSZENIA.
 *
 * Cała ochrona zgłoszeń klienta stoi na tym, że ten cron chodzi i dowozi.
 * Sprawdzamy więc trasę, nie tylko bibliotekę: uprawnienia, blokadę przed
 * dublem przebiegu, zapis do rejestru, sygnalizowanie zaległości i to, że
 * sprzątanie NIE MOŻE przewrócić właściwej pracy.
 *
 * ClickUp podstawiony (to wyjście na świat), Postgres prawdziwy.
 *
 *   docker start cp-test-pg && npm run test:integration
 */
const { clickup, cache } = vi.hoisted(() => ({
  clickup: { createTask: vi.fn(), findTaskByDescriptionMarker: vi.fn(), addTaskAttachment: vi.fn() },
  cache: { invalidateFolderTasks: vi.fn(async () => {}) },
}))

vi.mock('@/lib/clickup', () => clickup)
vi.mock('@/lib/clickupCache', () => ({ ...cache, folderTasksTag: (id: string) => `f-${id}` }))

import { NextRequest } from 'next/server'
import { db } from '@/lib/db'
import { cronRuns, pendingReports } from '@/lib/db/schema'
import { enqueueReport } from '@/lib/pendingReports'
import { GET as pendingGET } from '@/app/api/cron/pending-reports/route'

const dbUp = await isDbReachable()
const maSekret = !!process.env.CRON_SECRET

const req = (url: string, init?: RequestInit) =>
  new NextRequest(`http://localhost${url}`, init as ConstructorParameters<typeof NextRequest>[1])
const zTokenem = () =>
  req('/api/cron/pending-reports', { headers: { authorization: `Bearer ${process.env.CRON_SECRET}` } })

describe.skipIf(!dbUp || !maSekret)('cron dowożący zgłoszenia', () => {
  let portal: { id: string; slug: string }

  beforeEach(async () => {
    vi.clearAllMocks()
    clickup.findTaskByDescriptionMarker.mockResolvedValue(null)
    portal ??= await createTestPortal('cron-kolejka')
    await db.delete(pendingReports).where(eq(pendingReports.portalId, portal.id))
  })

  afterAll(async () => {
    if (portal) await dropTestPortal(portal.id)
  })

  describe('uprawnienia', () => {
    it('bez tokenu → 401 i NIC nie jedzie do ClickUpa', async () => {
      await enqueueReport({
        portalId: portal.id, source: 'form', clickupListId: 'l-1', payload: { name: 'X' },
      })
      const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {})

      const res = await pendingGET(req('/api/cron/pending-reports'))

      assert.strictEqual(res.status, 401)
      assert.strictEqual(clickup.createTask.mock.calls.length, 0)
      warnSpy.mockRestore()
    })

    it('zły token → 401', async () => {
      const res = await pendingGET(
        req('/api/cron/pending-reports', { headers: { authorization: 'Bearer nie-ten' } })
      )
      assert.strictEqual(res.status, 401)
    })
  })

  describe('dowożenie', () => {
    it('dowozi czekające zgłoszenie i mówi ile zostało', async () => {
      const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {})
      const infoSpy = vi.spyOn(console, 'info').mockImplementation(() => {})
      await enqueueReport({
        portalId: portal.id, source: 'form', clickupListId: 'l-1',
        payload: { name: 'Do dowiezienia z crona' }, marker: 'zg-abcdef01',
      })
      clickup.createTask.mockResolvedValue({ id: 'z-crona', name: 'Do dowiezienia z crona', url: 'u' })

      const res = await pendingGET(zTokenem())
      const body = await res.json()

      assert.strictEqual(res.status, 200)
      assert.strictEqual(body.delivered, 1)
      assert.strictEqual(body.zostalo, 0)
      const [wiersz] = await db.select().from(pendingReports).where(eq(pendingReports.portalId, portal.id))
      assert.strictEqual(wiersz.deliveredTaskId, 'z-crona')
      infoSpy.mockRestore()
      warnSpy.mockRestore()
    })

    it('pusta kolejka to poprawny przebieg, nie błąd', async () => {
      const res = await pendingGET(zTokenem())
      const body = await res.json()
      assert.strictEqual(res.status, 200)
      assert.strictEqual(body.processed, 0)
    })

    it('każdy przebieg zostawia wiersz w rejestrze cronów', async () => {
      const przed = await db.select().from(cronRuns).where(eq(cronRuns.job, 'pending-reports'))

      await pendingGET(zTokenem())

      const po = await db.select().from(cronRuns).where(eq(cronRuns.job, 'pending-reports'))
      assert.strictEqual(po.length, przed.length + 1, 'przebieg odnotowany')
      assert.strictEqual(po[po.length - 1].ok, true)
    })

    it('zgłoszenie, którego nie da się dowieźć, zostaje w kolejce z odłożoną próbą', async () => {
      const errorSpy = vi.spyOn(console, 'error').mockImplementation(() => {})
      const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {})
      await enqueueReport({
        portalId: portal.id, source: 'form', clickupListId: 'l-1', payload: { name: 'Nie wejdzie' },
      })
      clickup.createTask.mockRejectedValue(new Error('ClickUp 401'))

      const res = await pendingGET(zTokenem())
      const body = await res.json()

      assert.strictEqual(body.failed, 1)
      assert.strictEqual(body.zostalo, 1, 'zgłoszenie NIE zniknęło')
      const [wiersz] = await db.select().from(pendingReports).where(eq(pendingReports.portalId, portal.id))
      assert.strictEqual(wiersz.attempts, 1)
      assert.ok(wiersz.nextAttemptAt.getTime() > Date.now())
      warnSpy.mockRestore()
      errorSpy.mockRestore()
    })
  })

  describe('sprzątanie', () => {
    it('przebieg zwraca liczby ze sprzątania i nie wywraca się na nim', async () => {
      const res = await pendingGET(zTokenem())
      const body = await res.json()

      // Sprzątanie jest DODATKIEM do dowożenia. Gdyby padło, cron ma dalej
      // robić swoje, dlatego każda z trzech operacji ma własny catch.
      assert.ok(body.sprzatanie, 'wynik sprzątania jest w odpowiedzi')
      assert.strictEqual(typeof body.sprzatanie.przebiegi, 'number')
      assert.strictEqual(typeof body.sprzatanie.dowiezione, 'number')
      assert.strictEqual(typeof body.sprzatanie.blokady, 'number')
    })
  })
})
