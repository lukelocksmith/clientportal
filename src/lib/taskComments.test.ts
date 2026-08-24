import { describe, it, beforeEach, vi } from 'vitest'
import assert from 'node:assert'

/**
 * Mapowanie i logika taskComments.ts, na podstawionym `db`.
 *
 * Poprawność zapytań SQL (unikalność `clickup_comment_id`, zachowanie
 * `onConflictDoUpdate` na prawdziwym Postgresie, współistnienie
 * `recordClientComment` + `syncPublishedComments` na tym samym wierszu) jest
 * w tests/integration/taskComments.test.ts — tu sprawdzamy to, co jest tanie
 * i szybkie: który komentarz przechodzi filtr, jak liczony jest autor, i że
 * konflikt aktualizuje WYŁĄCZNIE `body`.
 */

const { db } = vi.hoisted(() => ({
  db: { insert: vi.fn() },
}))
vi.mock('@/lib/db', () => ({ db }))

import { recordClientComment, syncPublishedComments } from './taskComments'
import { AGENCY_SENDER } from './publicComments'
import type { ClickUpComment } from './types'

let insertedRows: Record<string, unknown>[]
let conflictSets: Record<string, unknown>[]
let conflictTargets: unknown[]
let doNothingTargets: unknown[]

beforeEach(() => {
  vi.clearAllMocks()
  insertedRows = []
  conflictSets = []
  conflictTargets = []
  doNothingTargets = []

  db.insert = vi.fn(() => ({
    values: (row: Record<string, unknown>) => {
      insertedRows.push(row)
      return {
        onConflictDoUpdate: (opts: { target: unknown; set: Record<string, unknown> }) => {
          conflictTargets.push(opts.target)
          conflictSets.push(opts.set)
          return Promise.resolve()
        },
        onConflictDoNothing: (opts: { target: unknown }) => {
          doNothingTargets.push(opts.target)
          return Promise.resolve()
        },
      }
    },
  }))
})

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

describe('syncPublishedComments — kto wchodzi', () => {
  it('komentarz bez [P] nie trafia do bazy w ogóle', async () => {
    const wynik = await syncPublishedComments('portal-1', 'task-1', [
      komentarz({ comment_text: 'wewnętrzne: klient nie zapłacił' }),
    ])

    assert.strictEqual(insertedRows.length, 0)
    assert.strictEqual(wynik.upserted, 0)
  })

  it('komentarz z [P] trafia, z body bez znacznika', async () => {
    await syncPublishedComments('portal-1', 'task-1', [
      komentarz({ comment_text: '[P] Poprawione, sprawdź proszę' }),
    ])

    assert.strictEqual(insertedRows.length, 1)
    assert.strictEqual(insertedRows[0].body, 'Poprawione, sprawdź proszę')
    assert.strictEqual(insertedRows[0].clickupTaskId, 'task-1')
    assert.strictEqual(insertedRows[0].portalId, 'portal-1')
    assert.strictEqual(insertedRows[0].clickupCommentId, 'c-1')
    assert.strictEqual(insertedRows[0].source, 'clickup')
  })

  it('podpis "(Imię)" rozpoznaje autora jako klienta', async () => {
    await syncPublishedComments('portal-1', 'task-1', [
      komentarz({ comment_text: '[P] (Dorota) dzięki za info' }),
    ])

    assert.strictEqual(insertedRows[0].authorType, 'client')
    assert.strictEqual(insertedRows[0].authorLabel, 'Dorota')
    assert.strictEqual(insertedRows[0].body, 'dzięki za info')
  })

  it('brak podpisu rozpoznaje autora jako agencję', async () => {
    await syncPublishedComments('portal-1', 'task-1', [
      komentarz({ comment_text: '[P] zrobione' }),
    ])

    assert.strictEqual(insertedRows[0].authorType, 'agency')
    assert.strictEqual(insertedRows[0].authorLabel, AGENCY_SENDER)
  })

  it('data komentarza (ms) staje się publishedAt', async () => {
    await syncPublishedComments('portal-1', 'task-1', [
      komentarz({ date: '1700000123000' }),
    ])

    assert.strictEqual((insertedRows[0].publishedAt as Date).getTime(), 1700000123000)
  })

  it('sam znacznik bez treści jest pomijany, nie zapisuje pustego wiersza', async () => {
    const wynik = await syncPublishedComments('portal-1', 'task-1', [
      komentarz({ comment_text: '[P]' }),
    ])

    assert.strictEqual(insertedRows.length, 0)
    assert.strictEqual(wynik.skipped, 1)
  })

  it('kilka komentarzy: publiczne wchodzą, wewnętrzne odpadają, licznik się zgadza', async () => {
    const wynik = await syncPublishedComments('portal-1', 'task-1', [
      komentarz({ id: 'c-1', comment_text: '[P] pierwsza' }),
      komentarz({ id: 'c-2', comment_text: 'wewnętrzna notatka' }),
      komentarz({ id: 'c-3', comment_text: '[P] druga' }),
    ])

    assert.strictEqual(insertedRows.length, 2)
    assert.strictEqual(wynik.upserted, 2)
    assert.deepStrictEqual(insertedRows.map(r => r.clickupCommentId), ['c-1', 'c-3'])
  })
})

describe('syncPublishedComments — konflikt po clickup_comment_id', () => {
  it('aktualizuje WYŁĄCZNIE body, nie rusza author_id ani source', async () => {
    await syncPublishedComments('portal-1', 'task-1', [komentarz()])

    assert.strictEqual(conflictTargets.length, 1)
    assert.deepStrictEqual(Object.keys(conflictSets[0]), ['body'])
  })
})

describe('recordClientComment', () => {
  it('zapisuje jako client/portal, z podanym author_id', async () => {
    await recordClientComment({
      portalId: 'portal-1',
      clickupTaskId: 'task-1',
      clickupCommentId: 'c-9',
      authorType: 'client',
      authorId: 'user-1',
      authorLabel: 'Dorota',
      body: 'Dzięki, sprawdzimy',
    })

    assert.strictEqual(insertedRows.length, 1)
    const row = insertedRows[0]
    assert.strictEqual(row.authorType, 'client')
    assert.strictEqual(row.authorId, 'user-1')
    assert.strictEqual(row.authorLabel, 'Dorota')
    assert.strictEqual(row.source, 'portal')
    assert.strictEqual(row.clickupCommentId, 'c-9')
    assert.strictEqual(doNothingTargets.length, 1)
  })

  it('PM przez obejscie admina zapisuje jako agency, z author_id=null', async () => {
    await recordClientComment({
      portalId: 'portal-1',
      clickupTaskId: 'task-1',
      clickupCommentId: 'c-admin',
      authorType: 'agency',
      authorId: null,
      authorLabel: 'important.is',
      body: 'juz sie tym zajmujemy',
    })

    const row = insertedRows[0]
    assert.strictEqual(row.authorType, 'agency')
    assert.strictEqual(row.authorId, null)
  })

  it('przycina treść i pomija pusty wpis', async () => {
    await recordClientComment({
      portalId: 'portal-1',
      clickupTaskId: 'task-1',
      clickupCommentId: 'c-9',
      authorType: 'client',
      authorId: 'user-1',
      authorLabel: 'Dorota',
      body: '   ',
    })

    assert.strictEqual(insertedRows.length, 0)
  })
})
