// @vitest-environment jsdom
import { describe, it, beforeEach, afterEach, vi } from 'vitest'
import assert from 'node:assert'
import { render, screen, cleanup, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'

/**
 * DZWONEK POWIADOMIEN.
 *
 * Powstal 2026-08-24, przy dokladaniu rodzaju `created` (nowe zadanie zalozone
 * przez agencje). Dzwonek wybiera ikone i nazwe rodzaju z obiektow indeksowanych
 * po `kind`, wiec rodzaj, ktorego tam nie ma, konczy sie proba wyrenderowania
 * `undefined` jako komponentu, czyli BIALYM EKRANEM zamiast listy. Nowy rodzaj
 * w bazie i stary dzwonek to dokladnie ta sytuacja, dlatego test jest tutaj.
 *
 *   npx vitest run src/components/NotificationBell.test.tsx
 */
const fetchMock = vi.fn()

vi.mock('next/navigation', () => ({ usePathname: () => '/onyx' }))

import { NotificationBell } from './NotificationBell'

/** Odpowiedz trasy dzwonka z podanymi pozycjami. */
function odpowiadaj(items: Array<Record<string, unknown>>) {
  fetchMock.mockResolvedValue({
    ok: true,
    json: async () => ({ items, unread: items.filter(i => !i.read).length }),
  })
}

function pozycja(nadpisz: Record<string, unknown> = {}) {
  return {
    id: 'n1',
    kind: 'comment',
    taskId: '869abc',
    taskName: 'Nie działające filtry mobile',
    payload: {},
    createdAt: new Date('2026-08-24T10:00:00Z').toISOString(),
    read: false,
    ...nadpisz,
  }
}

beforeEach(() => {
  vi.clearAllMocks()
  vi.stubGlobal('fetch', fetchMock)
})
afterEach(cleanup)

/** Lista siedzi w rozwinietym dzwonku, wiec kazdy test musi go najpierw otworzyc. */
async function pokazDzwonek() {
  const uzytkownik = userEvent.setup()
  render(<NotificationBell slug="onyx" />)
  await waitFor(() => assert.ok(fetchMock.mock.calls.length >= 1))
  await uzytkownik.click(screen.getByRole('button'))
}

describe('rodzaje zdarzen', () => {
  it('KAZDY rodzaj z bazy renderuje sie bez wywalenia dzwonka', async () => {
    // Petla, nie cztery osobne testy: chodzi o to, ze zbior rodzajow w bazie i
    // w dzwonku sie nie rozjezdza, a nie o tresc pojedynczego wpisu.
    odpowiadaj([
      pozycja({ id: 'n1', kind: 'comment', payload: { author: 'Artem', excerpt: 'poprawione' } }),
      pozycja({ id: 'n2', kind: 'created' }),
      pozycja({ id: 'n3', kind: 'status', payload: { from: 'nowe', to: 'w trakcie' } }),
      pozycja({ id: 'n4', kind: 'closed' }),
      pozycja({ id: 'n5', kind: 'panic_ack' }),
    ])
    await pokazDzwonek()

    await waitFor(() => assert.ok(fetchMock.mock.calls.length >= 1))
    // Piec pozycji, kazda z nazwa zadania. Gdyby ktorykolwiek rodzaj nie mial
    // ikony, React wywalilby caly komponent i nie byloby ani jednej.
    await waitFor(() =>
      assert.strictEqual(screen.getAllByText(/Nie działające filtry mobile/).length, 5)
    )
  })

  it('nowe zadanie od agencji opisane jest po polsku, nie surowym kluczem', async () => {
    odpowiadaj([pozycja({ kind: 'created' })])
    await pokazDzwonek()

    // Dwa miejsca naraz: etykieta rodzaju i opis zdarzenia, wiec getAll.
    await waitFor(() => assert.ok(screen.getAllByText(/Nowe zadanie/i).length >= 1))
    assert.strictEqual(screen.queryByText('created') === null, true, 'surowy klucz na ekranie')
  })

  it('rodzaj NIEZNANY dzwonkowi nie kasuje calej listy', async () => {
    // Baza moze dostac nowy rodzaj przed wdrozeniem nowego dzwonka. Pozycja
    // moze wygladac ubogo, ale reszta listy MUSI sie pokazac.
    odpowiadaj([pozycja({ id: 'n1', kind: 'z_przyszlosci' }), pozycja({ id: 'n2', kind: 'comment' })])
    await pokazDzwonek()

    await waitFor(() =>
      assert.ok(screen.getAllByText(/Nie działające filtry mobile/).length >= 1, 'lista zniknela')
    )
  })
})
