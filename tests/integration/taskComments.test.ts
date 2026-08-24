/**
 * ROZMOWA Z KLIENTEM na prawdziwym Postgresie.
 *
 * Jednostkowe testy w src/lib/taskComments.test.ts pilnują mapowania (kto
 * jest autorem, co wchodzi do body). Tutaj sprawdzamy to, co jednostkowy test
 * z podstawionym `db` nie może udowodnić naprawdę: czy unikalny indeks na
 * `clickup_comment_id` faktycznie dedupuje, i czy dwa źródła zapisu
 * (klient z portalu, potem sync tego samego komentarza z ClickUpa) nie gryzą
 * się o ten sam wiersz.
 *
 *   docker start clientportal-postgres-1 && npm run test:integration
 */
import { describe, it, beforeAll, afterAll, afterEach } from 'vitest'
import assert from 'node:assert'
import { eq } from 'drizzle-orm'
import { db } from '@/lib/db'
import { taskComments } from '@/lib/db/schema'
import { recordClientComment, syncPublishedComments } from '@/lib/taskComments'
import type { ClickUpComment } from '@/lib/types'
import { isDbReachable, createTestPortal, dropTestPortal, createTestUser } from './helpers'

const dbUp = await isDbReachable()

function komentarz(overrides: Partial<ClickUpComment> = {}): ClickUpComment {
  return {
    id: 'c-1',
    comment_text: '[P] gotowe',
    date: '1700000000000',
    user: null,
    resolved: false,
    ...overrides,
  }
}

describe.skipIf(!dbUp)('task_comments na prawdziwej bazie', () => {
  let portalId: string
  let userId: string

  beforeAll(async () => {
    const portal = await createTestPortal('tc')
    portalId = portal.id
    userId = await createTestUser(portalId, `klient-${portal.slug}@example.com`)
  })

  afterAll(async () => {
    if (portalId) await dropTestPortal(portalId)
  })

  afterEach(async () => {
    await db.delete(taskComments).where(eq(taskComments.portalId, portalId))
  })

  async function wiersze() {
    return db.select().from(taskComments).where(eq(taskComments.portalId, portalId))
  }

  it('sync tego samego komentarza dwa razy nie tworzy duplikatu', async () => {
    await syncPublishedComments(portalId, 'task-1', [komentarz({ comment_text: '[P] pierwsza wersja' })])
    await syncPublishedComments(portalId, 'task-1', [komentarz({ comment_text: '[P] pierwsza wersja' })])

    const rows = await wiersze()
    assert.strictEqual(rows.length, 1)
  })

  it('edycja treści w ClickUpie aktualizuje body, ale NIE rusza published_at', async () => {
    await syncPublishedComments(portalId, 'task-1', [
      komentarz({ comment_text: '[P] wersja pierwsza', date: '1700000000000' }),
    ])
    const [przed] = await wiersze()

    await syncPublishedComments(portalId, 'task-1', [
      komentarz({ comment_text: '[P] wersja POPRAWIONA', date: '1700000000000' }),
    ])
    const [po] = await wiersze()

    assert.strictEqual(po.body, 'wersja POPRAWIONA')
    assert.strictEqual(po.publishedAt.getTime(), przed.publishedAt.getTime())
  })

  it('komentarz klienta zapisany z portalu, potem wciągnięty z powrotem przez sync, zostaje jednym wierszem z zachowanym author_id', async () => {
    // Krok 1: klient pisze w portalu. Trasa POST woła to PRZED synchronizacją.
    await recordClientComment({
      portalId,
      clickupTaskId: 'task-1',
      clickupCommentId: 'c-mirror',
      authorType: 'client',
      authorId: userId,
      authorLabel: 'Dorota',
      body: 'Dzięki, sprawdzimy jutro',
    })

    // Krok 2: webhook taskCommentPosted przychodzi chwilę później i sync
    // czyta ten sam komentarz z ClickUpa (już z podpisem "(Dorota)").
    await syncPublishedComments(portalId, 'task-1', [
      komentarz({
        id: 'c-mirror',
        comment_text: '[P] (Dorota) Dzięki, sprawdzimy jutro',
        date: '1700000000000',
      }),
    ])

    const rows = await wiersze()
    assert.strictEqual(rows.length, 1, 'sync z ClickUpa nie może zdublować wiersza klienta')
    assert.strictEqual(rows[0].source, 'portal', 'sync nie może odebrać portalowi własności wiersza')
    assert.strictEqual(rows[0].authorId, userId, 'sync nie może wyzerować author_id')
    assert.strictEqual(rows[0].authorType, 'client')
  })

  it('dwa różne komentarze tego samego zadania to dwa wiersze', async () => {
    await syncPublishedComments(portalId, 'task-1', [
      komentarz({ id: 'c-1', comment_text: '[P] pierwsza' }),
      komentarz({ id: 'c-2', comment_text: '[P] druga' }),
    ])

    const rows = await wiersze()
    assert.strictEqual(rows.length, 2)
  })

  it('komentarz bez [P] nigdy nie trafia do bazy, nawet po wielu synchronizacjach', async () => {
    for (let i = 0; i < 3; i++) {
      await syncPublishedComments(portalId, 'task-1', [
        komentarz({ comment_text: 'wewnętrzna notatka zespołu' }),
      ])
    }

    const rows = await wiersze()
    assert.strictEqual(rows.length, 0)
  })
})
