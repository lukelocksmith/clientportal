import { describe, it, beforeEach, afterAll, vi } from 'vitest'
import assert from 'node:assert'
import { eq, inArray } from 'drizzle-orm'
import { db } from '@/lib/db'
import { cronRuns, pendingReports } from '@/lib/db/schema'
import { isDbReachable, createTestPortal, dropTestPortal } from './helpers'
import { GET as healthGET } from '@/app/api/health/zgloszenia/route'
import { enqueueReport } from '@/lib/pendingReports'

/**
 * ENDPOINT ZDROWIA drogi zgłoszeń.
 *
 * Istnieje dla czujnika Z ZEWNĄTRZ, bo cron, który przestał być wołany, nie
 * alarmuje o niczym — jego cisza wygląda identycznie jak spokój. Najważniejszy
 * test w tym pliku sprawdza więc, że endpoint UMIE ZAŚWIECIĆ NA CZERWONO.
 * Zielone „OK", które nie potrafi się zaczerwienić, nie mierzy niczego.
 *
 *   docker start cp-test-pg && npm run test:integration
 */
const dbUp = await isDbReachable()

async function ustawPrzebieg(job: string, minutTemu: number) {
  const kiedy = new Date(Date.now() - minutTemu * 60_000)
  await db.delete(cronRuns).where(eq(cronRuns.job, job))
  await db.insert(cronRuns).values({
    job, ok: true, itemsProcessed: 0, detail: 'test', startedAt: kiedy, finishedAt: kiedy,
  })
}

describe.skipIf(!dbUp)('endpoint zdrowia', () => {
  let portal: { id: string; slug: string }
  const PILNOWANE = ['pending-reports', 'panic-escalation', 'task-index']
  let kopia: Array<typeof cronRuns.$inferSelect> = []

  beforeEach(async () => {
    portal ??= await createTestPortal('health')
    // CALA tabela: endpoint zdrowia liczy kolejke globalnie, wiec wiersz
    // zostawiony przez inny plik testowy zaswiecilby tu na czerwono.
    await db.delete(pendingReports)
  })

  afterAll(async () => {
    // Przywracamy rejestr, bo w tej bazie moga byc prawdziwe przebiegi.
    await db.delete(cronRuns).where(inArray(cronRuns.job, PILNOWANE))
    if (kopia.length > 0) await db.insert(cronRuns).values(kopia)
    if (portal) await dropTestPortal(portal.id)
  })

  it('świeże przebiegi i pusta kolejka → OK i kod 200', async () => {
    kopia = await db.select().from(cronRuns).where(inArray(cronRuns.job, PILNOWANE))
    await ustawPrzebieg('pending-reports', 1)
    await ustawPrzebieg('panic-escalation', 3)
    await ustawPrzebieg('task-index', 120)

    const res = await healthGET()
    const tekst = await res.text()

    assert.strictEqual(res.status, 200, `oczekiwano 200, bylo ${res.status}: ${tekst}`)
    assert.ok(tekst.startsWith('OK'), `oczekiwano OK, bylo: ${tekst}`)
  })

  it('MILCZĄCY cron dowożenia → PROBLEM i kod 503', async () => {
    await ustawPrzebieg('pending-reports', 60)
    await ustawPrzebieg('panic-escalation', 3)
    await ustawPrzebieg('task-index', 120)

    const res = await healthGET()
    const tekst = await res.text()

    assert.strictEqual(res.status, 503)
    assert.match(tekst, /^PROBLEM/)
    assert.match(tekst, /pending-reports/)
  })

  it('milcząca eskalacja alarmów → PROBLEM', async () => {
    await ustawPrzebieg('pending-reports', 1)
    await ustawPrzebieg('panic-escalation', 45)
    await ustawPrzebieg('task-index', 120)

    const res = await healthGET()
    assert.strictEqual(res.status, 503)
    assert.match(await res.text(), /panic-escalation/)
  })

  it('cron, który NIGDY nie chodził, nie udaje zdrowego', async () => {
    await ustawPrzebieg('pending-reports', 1)
    await ustawPrzebieg('panic-escalation', 3)
    await db.delete(cronRuns).where(eq(cronRuns.job, 'task-index'))

    const res = await healthGET()
    assert.strictEqual(res.status, 503)
    assert.match(await res.text(), /ani jednego przebiegu/)
  })

  it('zgłoszenie stojące w kolejce zbyt długo → PROBLEM', async () => {
    await ustawPrzebieg('pending-reports', 1)
    await ustawPrzebieg('panic-escalation', 3)
    await ustawPrzebieg('task-index', 120)
    const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {})
    await enqueueReport({
      portalId: portal.id, source: 'form', clickupListId: 'l-1', payload: { name: 'stoi i stoi' },
    })
    await db
      .update(pendingReports)
      .set({ createdAt: new Date(Date.now() - 60 * 60_000) })
      .where(eq(pendingReports.portalId, portal.id))

    const res = await healthGET()
    const tekst = await res.text()

    assert.strictEqual(res.status, 503)
    assert.match(tekst, /kolejka zgłoszeń/)
    warnSpy.mockRestore()
  })

  it('odpowiedź NIE zawiera nazw projektów ani treści zgłoszeń', async () => {
    // Trasa jest bez tokenu, żeby czujnik mógł ją odpytywać. Nie ma prawa
    // wypuszczać niczego o klientach.
    await ustawPrzebieg('pending-reports', 1)
    await ustawPrzebieg('panic-escalation', 3)
    await ustawPrzebieg('task-index', 120)
    const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {})
    await enqueueReport({
      portalId: portal.id, source: 'form', clickupListId: 'l-1',
      payload: { name: 'TAJNA TRESC KLIENTA' },
    })

    const tekst = await (await healthGET()).text()

    assert.ok(!tekst.includes('TAJNA'), `wyciekla tresc: ${tekst}`)
    assert.ok(!tekst.includes(portal.slug), `wyciekl slug: ${tekst}`)
    warnSpy.mockRestore()
  })
})
