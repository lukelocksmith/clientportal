import { describe, it, beforeAll, afterAll, expect } from 'vitest'
import { eq } from 'drizzle-orm'
import { db } from '@/lib/db'
import { portals } from '@/lib/db/schema'
import {
  queryHistory,
  getHistoryFacets,
  getRecentlyClosed,
  getIndexedTaskNames,
  recomputePortalVisibility,
  isIndexedTaskVisible,
} from '@/lib/taskIndex'
import { buildSearchText } from '@/lib/textSearch'
import { createTestPortal, dropTestPortal, insertIndexedTask, isDbReachable } from './helpers'

/**
 * Historia przy filtrze po tagu `portal`, na PRAWDZIWEJ bazie.
 *
 * Warunek widoczności siedzi w SQL-u (`visibleIn` w lib/taskIndex.ts) i czyta
 * flagę projektu w zapytaniu, więc jednostkowo nie da się go sprawdzić.
 * Odtwarzamy przypadek `869eprajy`: wewnętrzna notatka bez tagu obok zgłoszeń
 * klienta z tagiem.
 */
const DAY = 86_400_000
const T0 = 1_760_000_000_000

const reachable = await isDbReachable()

let portalId = ''

async function setTagOnly(value: boolean) {
  await db.update(portals).set({ portalTagOnly: value }).where(eq(portals.id, portalId))
}

beforeAll(async () => {
  if (!reachable) return
  const portal = await createTestPortal('vis')
  portalId = portal.id

  // Zgłoszenie klienta z tagiem i jego podzadanie bez tagu (dziedziczy).
  await insertIndexedTask({
    portalId, clickupTaskId: 'zgl', name: 'Zmiana mnożnika cen',
    searchText: buildSearchText({ name: 'Zmiana mnożnika cen' }),
    dateCreated: T0, dateClosed: T0 + DAY, hasPortalTag: true,
  })
  await insertIndexedTask({
    portalId, clickupTaskId: 'zgl-krok', name: 'sprawdzić Baselinker',
    searchText: buildSearchText({ name: 'sprawdzić Baselinker' }),
    parentId: 'zgl', dateCreated: T0 - DAY, hasPortalTag: false,
  })
  // Wewnętrzna notatka, bez tagu, z podzadaniem bez tagu i podzadaniem Z tagiem.
  await insertIndexedTask({
    portalId, clickupTaskId: 'notatka', name: 'Onyx: przeanalizować odpowiedzi nt. serwera',
    searchText: buildSearchText({ name: 'Onyx: przeanalizować odpowiedzi', description: 'porównuje z WP Opieki' }),
    status: 'w trakcie', statusType: 'custom', priority: 'high',
    dateCreated: T0 - 2 * DAY, dateClosed: T0 + 2 * DAY, hasPortalTag: false,
  })
  await insertIndexedTask({
    portalId, clickupTaskId: 'notatka-sub', name: 'argumenty na rozmowę',
    searchText: buildSearchText({ name: 'argumenty na rozmowę WP Opieki' }),
    parentId: 'notatka', dateCreated: T0 - 3 * DAY, hasPortalTag: false,
  })
  await insertIndexedTask({
    portalId, clickupTaskId: 'notatka-pokazany', name: 'Pokazany krok',
    searchText: buildSearchText({ name: 'Pokazany krok' }),
    parentId: 'notatka', dateCreated: T0 - 4 * DAY, hasPortalTag: true,
  })

  const changed = await recomputePortalVisibility(portalId)
  // zgl, zgl-krok (dziedziczy), notatka-pokazany (własny tag).
  expect(changed).toBe(3)
})

afterAll(async () => {
  if (reachable && portalId) await dropTestPortal(portalId)
})

describe.skipIf(!reachable)('Historia a tag portal', () => {
  it('flaga WYŁĄCZONA: klient widzi wszystko, jak przed zmianą', async () => {
    await setTagOnly(false)
    const page = await queryHistory(portalId)
    expect(page.rows.map(r => r.clickupTaskId).sort()).toEqual(['notatka', 'zgl'])
    expect(await isIndexedTaskVisible(portalId, 'notatka')).toBe(true)
  })

  it('flaga WŁĄCZONA: notatki nie ma w liście, a otagowane podzadanie staje się wierszem', async () => {
    await setTagOnly(true)
    const page = await queryHistory(portalId)
    expect(page.rows.map(r => r.clickupTaskId).sort()).toEqual(['notatka-pokazany', 'zgl'])
    expect(page.total).toBe(2)
  })

  it('wyszukiwarka nie znajduje ukrytej treści ani przez podzadanie', async () => {
    await setTagOnly(true)
    expect((await queryHistory(portalId, { q: 'WP Opieki' })).rows).toEqual([])
    const hit = await queryHistory(portalId, { q: 'Baselinker' })
    expect(hit.rows.map(r => r.clickupTaskId)).toEqual(['zgl'])
    expect(hit.rows[0].matchedSubtasks).toEqual(['sprawdzić Baselinker'])
  })

  it('liczniki, ostatnio domknięte i nazwy wzmianek pomijają ukryte', async () => {
    await setTagOnly(true)
    const facets = await getHistoryFacets(portalId)
    expect(facets.statuses.find(s => s.status === 'w trakcie')).toBeUndefined()
    expect(facets.priorities).toEqual([])
    expect(facets.indexedCount).toBe(3)

    const closed = await getRecentlyClosed(portalId)
    expect(closed.map(c => c.clickupTaskId)).toEqual(['zgl'])

    const names = await getIndexedTaskNames(portalId, ['zgl', 'notatka', 'notatka-sub'])
    expect([...names.keys()]).toEqual(['zgl'])

    expect(await isIndexedTaskVisible(portalId, 'notatka')).toBe(false)
    expect(await isIndexedTaskVisible(portalId, 'zgl-krok')).toBe(true)
    expect(await isIndexedTaskVisible(portalId, 'nie-ma-takiego')).toBe(false)
  })

  it('tag dodany rodzicowi odsłania poddrzewo po przeliczeniu, zdjęty chowa', async () => {
    await setTagOnly(true)
    const { taskIndex } = await import('@/lib/db/schema')
    const { and } = await import('drizzle-orm')
    const where = and(eq(taskIndex.portalId, portalId), eq(taskIndex.clickupTaskId, 'notatka'))

    await db.update(taskIndex).set({ hasPortalTag: true }).where(where)
    expect(await recomputePortalVisibility(portalId)).toBe(2) // notatka + notatka-sub
    expect(await isIndexedTaskVisible(portalId, 'notatka-sub')).toBe(true)

    await db.update(taskIndex).set({ hasPortalTag: false }).where(where)
    expect(await recomputePortalVisibility(portalId)).toBe(2)
    expect(await isIndexedTaskVisible(portalId, 'notatka-sub')).toBe(false)
    expect(await recomputePortalVisibility(portalId)).toBe(0)
  })
})
