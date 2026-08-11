// @vitest-environment jsdom
import { describe, it, beforeEach, afterEach, vi } from 'vitest'
import assert from 'node:assert'
import { render, screen, cleanup, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { SitepingCheck } from './SitepingCheck'

/**
 * Wynik testu polaczenia w panelu.
 *
 * Najwazniejsza rzecz do upilnowania nie jest kosmetyczna: `unknown` MUSI
 * wygladac inaczej niz `fail`. Pokazanie „nie udalo sie sprawdzic" jako
 * czerwonego krzyzyka wysyla zespol naprawiac cos, o czym nie wiadomo, czy
 * jest zepsute — a to gorsze niz brak testu.
 *
 *   npx vitest run src/components/admin/SitepingCheck.test.tsx
 */
const fetchMock = vi.fn()

const odpowiedz = (rows: unknown[]) => ({ ok: true, json: async () => ({ rows }) })

const WIERSZE = [
  { key: 'flaga', label: 'Funkcja włączona', state: 'ok', detail: 'zgłoszenia są włączone' },
  { key: 'domeny', label: 'Domeny ustawione', state: 'fail', detail: 'pusta lista' },
  { key: 'tagi', label: 'Tagi w ClickUpie', state: 'unknown', detail: 'nie udało się odpytać' },
]

beforeEach(() => {
  vi.clearAllMocks()
  vi.stubGlobal('fetch', fetchMock)
  fetchMock.mockResolvedValue(odpowiedz(WIERSZE))
})
afterEach(cleanup)

describe('przed sprawdzeniem', () => {
  it('NIE odpytuje serwera przy samym wyswietleniu', () => {
    // Sprawdzenie wychodzi na cudze serwery. Automat przy wejsciu w zakladke
    // generowalby ten ruch przy kazdym otwarciu panelu.
    render(<SitepingCheck slug="wdf" />)

    assert.strictEqual(fetchMock.mock.calls.length, 0)
  })

  it('mowi, co sprawdzenie zrobi i ze potrwa', () => {
    render(<SitepingCheck slug="wdf" />)

    assert.ok(screen.getByText(/kilka sekund/))
  })
})

describe('sprawdzenie', () => {
  it('pyta o TEN projekt', async () => {
    const uzytkownik = userEvent.setup()
    render(<SitepingCheck slug="wdf" />)

    await uzytkownik.click(screen.getByRole('button', { name: /Sprawdź/ }))

    await waitFor(() => assert.strictEqual(fetchMock.mock.calls.length, 1))
    assert.match(String(fetchMock.mock.calls[0][0]), /slug=wdf/)
  })

  it('pokazuje etykiete I powod dla kazdego wiersza', async () => {
    const uzytkownik = userEvent.setup()
    render(<SitepingCheck slug="wdf" />)

    await uzytkownik.click(screen.getByRole('button', { name: /Sprawdź/ }))

    assert.ok(await screen.findByText('Funkcja włączona'))
    // Sam kolor nie odpowiada na pytanie „no dobrze, a co teraz".
    assert.ok(screen.getByText('pusta lista'))
  })

  it('`unknown` NIE wyglada jak bledny wynik', async () => {
    const uzytkownik = userEvent.setup()
    render(<SitepingCheck slug="wdf" />)

    await uzytkownik.click(screen.getByRole('button', { name: /Sprawdź/ }))

    await screen.findByText('Tagi w ClickUpie')
    // Trzy wiersze, trzy rozne stany — kazdy z wlasnym opisem dostepnosci.
    assert.ok(screen.getByLabelText('nie udało się sprawdzić'))
    assert.ok(screen.getByLabelText('nie działa'))
    assert.ok(screen.getByLabelText('w porządku'))
  })

  it('blokuje przycisk na czas sprawdzania', async () => {
    const uzytkownik = userEvent.setup()
    let zwolnij: (v: unknown) => void = () => {}
    fetchMock.mockReturnValue(new Promise(res => { zwolnij = res }))
    render(<SitepingCheck slug="wdf" />)

    await uzytkownik.click(screen.getByRole('button', { name: /Sprawdź/ }))

    // Bez tego kilka klikniec pod rzad wysylaloby kilka zapytan na cudzy serwer.
    const przycisk = await screen.findByRole('button', { name: /Sprawdzam/ })
    assert.ok((przycisk as HTMLButtonElement).disabled)

    zwolnij(odpowiedz(WIERSZE))
    await waitFor(() => assert.ok(!(screen.getByRole('button') as HTMLButtonElement).disabled))
  })

  it('blad trasy nie zostawia pustego okienka', async () => {
    const uzytkownik = userEvent.setup()
    fetchMock.mockResolvedValue({ ok: false, json: async () => ({}) })
    render(<SitepingCheck slug="wdf" />)

    await uzytkownik.click(screen.getByRole('button', { name: /Sprawdź/ }))

    assert.ok(await screen.findByText(/Nie udało się wykonać/))
  })

  it('zerwane polaczenie tez ma komunikat', async () => {
    const uzytkownik = userEvent.setup()
    fetchMock.mockRejectedValue(new Error('offline'))
    render(<SitepingCheck slug="wdf" />)

    await uzytkownik.click(screen.getByRole('button', { name: /Sprawdź/ }))

    assert.ok(await screen.findByText(/Brak połączenia/))
    // Przycisk musi wrocic do uzytku, inaczej jedna wpadka blokuje panel.
    await waitFor(() => assert.ok(!(screen.getByRole('button') as HTMLButtonElement).disabled))
  })

  it('powtorne sprawdzenie podmienia wynik, nie dokleja drugiego', async () => {
    const uzytkownik = userEvent.setup()
    render(<SitepingCheck slug="wdf" />)

    await uzytkownik.click(screen.getByRole('button', { name: /Sprawdź/ }))
    await screen.findByText('Funkcja włączona')

    fetchMock.mockResolvedValue(
      odpowiedz([{ key: 'flaga', label: 'Funkcja włączona', state: 'ok', detail: 'po naprawie' }])
    )
    await uzytkownik.click(screen.getByRole('button', { name: /Sprawdź/ }))

    await screen.findByText('po naprawie')
    assert.strictEqual(screen.queryByText('pusta lista'), null)
  })
})
