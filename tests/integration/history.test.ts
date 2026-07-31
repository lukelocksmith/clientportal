import { describe, it, beforeAll, afterAll, expect } from 'vitest'
import { queryHistory, getHistoryFacets, getRecentlyClosed } from '@/lib/taskIndex'
import { buildSearchText } from '@/lib/textSearch'
import { publicCommentTexts } from '@/lib/publicComments'
import type { ClickUpComment } from '@/lib/types'
import { createTestPortal, dropTestPortal, insertIndexedTask, isDbReachable } from './helpers'

/**
 * Historia i wyszukiwarka na PRAWDZIWEJ bazie.
 *
 * Te rzeczy sa nietestowalne jednostkowo, bo blad siedzi w SQL-u, nie w
 * funkcji: definicja wiersza nadrzednego, wyszukiwanie po zlozonym polu,
 * stronicowanie kursorowe i granica miedzy klientami. Kazda z nich juz raz
 * w tej sesji byla zrodlem realnego bledu albo niespojnosci.
 */
const DAY = 86_400_000
const T0 = 1_750_000_000_000

/**
 * Dostepnosc bazy sprawdzamy PRZED rejestracja testow, zeby moc uzyc skipIf.
 * Wczesniej mialem `if (!reachable) return` w kazdym tescie, co przy
 * niedostepnej bazie dawalo ZIELONY wynik bez wykonania ani jednej asercji.
 * Zielono, ktore nic nie znaczy, jest gorsze niz brak testu.
 */
const reachable = await isDbReachable()

let portalId = ''
let otherPortalId = ''

function comment(text: string): ClickUpComment {
  return { id: 'c', comment: [{ text }], comment_text: text, user: null, resolved: false, date: '0' }
}

beforeAll(async () => {
  if (!reachable) return
  const portal = await createTestPortal('hist')
  const other = await createTestPortal('other')
  portalId = portal.id
  otherPortalId = other.id

  // Zadanie nadrzedne z komentarzem WEWNETRZNYM i publicznym.
  await insertIndexedTask({
    portalId,
    clickupTaskId: 'root-1',
    name: 'Błąd w opisie produktu',
    searchText: buildSearchText({
      name: 'Błąd w opisie produktu',
      description: 'Zła cena na stronie kategorii',
      publicComments: publicCommentTexts([
        comment('[PUBLIC] Poprawione, prosimy o sprawdzenie'),
        comment('UWAGA WEWNĘTRZNA: klient przepłaca, nie mówić'),
      ]),
      attachmentNames: ['zrzut-ekranu.png'],
    }),
    dateCreated: T0,
    dateClosed: T0 + DAY,
  })

  // Zadanie nadrzedne bez tresci, tylko nazwa.
  await insertIndexedTask({
    portalId,
    clickupTaskId: 'root-2',
    name: 'Wtyczka do tłumaczenia strony',
    searchText: buildSearchText({ name: 'Wtyczka do tłumaczenia strony' }),
    status: 'w trakcie',
    statusType: 'custom',
    priority: 'high',
    dateCreated: T0 - DAY,
  })

  // Podzadanie root-2, fraza wystepuje TYLKO tutaj.
  await insertIndexedTask({
    portalId,
    clickupTaskId: 'sub-1',
    name: 'klasy wysyłkowe na podstawie języka',
    searchText: buildSearchText({ name: 'klasy wysyłkowe na podstawie języka' }),
    parentId: 'root-2',
    dateCreated: T0 - 2 * DAY,
  })

  // SIEROTA: rodzic poza indeksem. Ma byc traktowana jak nadrzedna.
  await insertIndexedTask({
    portalId,
    clickupTaskId: 'orphan-1',
    name: 'Sierota bez rodzica w indeksie',
    searchText: buildSearchText({ name: 'Sierota bez rodzica w indeksie' }),
    parentId: 'nie-ma-mnie-w-indeksie',
    dateCreated: T0 - 3 * DAY,
  })

  // Zadanie INNEGO klienta z charakterystyczna fraza.
  await insertIndexedTask({
    portalId: otherPortalId,
    clickupTaskId: 'foreign-1',
    name: 'Zadanie obcego klienta magicznefraza',
    searchText: buildSearchText({ name: 'Zadanie obcego klienta magicznefraza' }),
    dateCreated: T0,
  })
})

afterAll(async () => {
  if (portalId) await dropTestPortal(portalId)
  if (otherPortalId) await dropTestPortal(otherPortalId)
})

describe.skipIf(!reachable)('historia (integracja)', () => {
  it('komentarz bez prefiksu [PUBLIC] jest NIEODNAJDYWALNY', async () => {
    const leak = await queryHistory(portalId, { q: 'przepłaca' })
    expect(leak.total).toBe(0)
    const leak2 = await queryHistory(portalId, { q: 'wewnętrzna' })
    expect(leak2.total).toBe(0)

    // A komentarz publiczny JEST odnajdywalny, wiec test nie przechodzi
    // przypadkiem przez zepsute wyszukiwanie.
    const found = await queryHistory(portalId, { q: 'prosimy o sprawdzenie' })
    expect(found.total).toBe(1)
  })

  it('szukanie dziala z ogonkami i bez, po obu stronach', async () => {
    const withMarks = await queryHistory(portalId, { q: 'tłumaczenia' })
    const without = await queryHistory(portalId, { q: 'tlumaczenia' })
    expect(withMarks.total).toBe(1)
    expect(without.total).toBe(withMarks.total)

    // `ł` nie jest rozkladalne przez NFD, wiec to najwazniejszy przypadek.
    const l1 = await queryHistory(portalId, { q: 'wysyłkowe' })
    const l2 = await queryHistory(portalId, { q: 'wysylkowe' })
    expect(l2.total).toBe(l1.total)
  })

  it('fraza z podzadania zwraca wiersz RODZICA z adnotacja', async () => {
    const page = await queryHistory(portalId, { q: 'wysyłkowe' })
    expect(page.rows).toHaveLength(1)
    expect(page.rows[0].clickupTaskId).toBe('root-2')
    expect(page.rows[0].matchedSubtasks).toContain('klasy wysyłkowe na podstawie języka')
  })

  it('sierota jest wierszem, a licznik filtra zgadza sie z liczba wierszy', async () => {
    const all = await queryHistory(portalId, { limit: 100 })
    const ids = all.rows.map(r => r.clickupTaskId)
    expect(ids).toContain('orphan-1')
    expect(ids).not.toContain('sub-1')

    // To byla realna niespojnosc: liczniki uzywaly innej definicji wiersza.
    const facets = await getHistoryFacets(portalId)
    const sumFromFacets = facets.statuses.reduce((s, x) => s + x.count, 0)
    expect(sumFromFacets).toBe(all.total)
  })

  it('granica miedzy klientami: fraza obcego zadania nie wychodzi', async () => {
    const mine = await queryHistory(portalId, { q: 'magicznefraza' })
    expect(mine.total).toBe(0)
    const theirs = await queryHistory(otherPortalId, { q: 'magicznefraza' })
    expect(theirs.total).toBe(1)
  })

  it('stronicowanie kursorowe nie powtarza ani nie gubi wierszy', async () => {
    const first = await queryHistory(portalId, { limit: 2 })
    expect(first.rows).toHaveLength(2)
    expect(first.nextCursor).toBeTruthy()

    const second = await queryHistory(portalId, { limit: 2, cursor: first.nextCursor })
    const overlap = first.rows
      .map(r => r.clickupTaskId)
      .filter(id => second.rows.some(r => r.clickupTaskId === id))
    expect(overlap).toHaveLength(0)

    const seen = new Set([...first.rows, ...second.rows].map(r => r.clickupTaskId))
    expect(seen.size).toBe(first.total)
  })

  it('escapowanie LIKE: znak procenta nie dopasowuje wszystkiego', async () => {
    const page = await queryHistory(portalId, { q: '%' })
    expect(page.total).toBe(0)
  })

  it('filtry statusu i priorytetu zwezaja wynik', async () => {
    const open = await queryHistory(portalId, { onlyOpen: true })
    const closed = await queryHistory(portalId, { onlyClosed: true })
    expect(open.total + closed.total).toBeGreaterThan(0)

    const high = await queryHistory(portalId, { priority: 'high' })
    expect(high.rows.every(r => r.priority === 'high')).toBe(true)
  })

  it('ostatnio domkniete pokazuje tylko zadania z data domkniecia', async () => {
    const recent = await getRecentlyClosed(portalId, 5)
    expect(recent.length).toBeGreaterThan(0)
    expect(recent.every(r => r.dateClosed > 0)).toBe(true)
  })
})
