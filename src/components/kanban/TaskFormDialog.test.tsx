// @vitest-environment jsdom
import { describe, it, beforeEach, afterEach, vi } from 'vitest'
import assert from 'node:assert'
import { render, screen, cleanup, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { TaskFormDialog } from './TaskFormDialog'

/**
 * FORMULARZ ZGŁOSZENIA BEZ ASYSTENTA.
 *
 * Powstał 11.09 jako druga droga: do tej pory klient bez SitePinga miał
 * wyłącznie czat z modelem, więc pomyłka modelu zostawiała go bez możliwości
 * zgłoszenia czegokolwiek poza alarmem.
 *
 * Najważniejsze zachowanie: PRZY BŁĘDZIE TREŚĆ ZOSTAJE W POLACH. Klient opisał
 * sprawę raz i nie ma powodu robić tego drugi raz przez awarię po naszej
 * stronie — to jest dokładnie ten rodzaj cichej straty, przed którym cała ta
 * robota powstała.
 *
 *   npx vitest run src/components/kanban/TaskFormDialog.test.tsx
 */
const oryginalnyFetch = global.fetch

beforeEach(() => vi.clearAllMocks())
afterEach(() => {
  cleanup()
  global.fetch = oryginalnyFetch
})

function renderuj(nadpisz: Partial<Parameters<typeof TaskFormDialog>[0]> = {}) {
  const onClose = vi.fn()
  const onCreated = vi.fn()
  render(<TaskFormDialog slug="onyx" onClose={onClose} onCreated={onCreated} {...nadpisz} />)
  return { onClose, onCreated }
}

describe('wysyłka zgłoszenia', () => {
  it('idzie tą samą trasą co SitePing, z poziomem i treścią', async () => {
    const uzytkownik = userEvent.setup()
    const fetchMock = vi.fn().mockResolvedValue({ ok: true, json: async () => ({}) })
    global.fetch = fetchMock as unknown as typeof fetch
    const { onCreated, onClose } = renderuj()

    await uzytkownik.type(screen.getByLabelText(/Czego dotyczy/), 'Podmiana banera')
    await uzytkownik.type(screen.getByLabelText(/Szczegóły/), 'important.is, sekcja na górze')
    await uzytkownik.click(screen.getByRole('button', { name: /Zgłoś zadanie/ }))

    await waitFor(() => assert.strictEqual(fetchMock.mock.calls.length, 1))
    const [adres, opcje] = fetchMock.mock.calls[0]
    assert.strictEqual(adres, '/api/clickup/tasks')
    const cialo = JSON.parse((opcje as { body: string }).body)
    assert.strictEqual(cialo.slug, 'onyx')
    assert.strictEqual(cialo.name, 'Podmiana banera')
    assert.strictEqual(cialo.description, 'important.is, sekcja na górze')
    // Domyślnie najniższy poziom: podnosi się świadomie, nie z rozpędu.
    assert.strictEqual(cialo.priority, 3)

    await waitFor(() => assert.strictEqual(onCreated.mock.calls.length, 1))
    assert.strictEqual(onClose.mock.calls.length, 1)
  })

  it('wybrany poziom trafia do zgłoszenia', async () => {
    const uzytkownik = userEvent.setup()
    const fetchMock = vi.fn().mockResolvedValue({ ok: true, json: async () => ({}) })
    global.fetch = fetchMock as unknown as typeof fetch
    renderuj()

    await uzytkownik.type(screen.getByLabelText(/Czego dotyczy/), 'Nie działa płatność')
    await uzytkownik.click(screen.getByRole('radio', { name: /P1/ }))
    await uzytkownik.click(screen.getByRole('button', { name: /Zgłoś zadanie/ }))

    await waitFor(() => assert.strictEqual(fetchMock.mock.calls.length, 1))
    assert.strictEqual(JSON.parse(fetchMock.mock.calls[0][1].body).priority, 1)
  })

  it('awaria NIE kasuje tego, co klient napisał', async () => {
    const uzytkownik = userEvent.setup()
    global.fetch = vi.fn().mockResolvedValue({ ok: false, status: 500 }) as unknown as typeof fetch
    const { onClose } = renderuj()

    await uzytkownik.type(screen.getByLabelText(/Czego dotyczy/), 'Podmiana banera')
    await uzytkownik.click(screen.getByRole('button', { name: /Zgłoś zadanie/ }))

    assert.ok(await screen.findByRole('alert'))
    assert.strictEqual((screen.getByLabelText(/Czego dotyczy/) as HTMLInputElement).value, 'Podmiana banera')
    assert.strictEqual(onClose.mock.calls.length, 0, 'okno zostaje otwarte, jest co poprawić')
  })

  it('zerwane połączenie też zostawia treść i mówi wprost', async () => {
    const uzytkownik = userEvent.setup()
    global.fetch = vi.fn().mockRejectedValue(new Error('offline')) as unknown as typeof fetch
    renderuj()

    await uzytkownik.type(screen.getByLabelText(/Czego dotyczy/), 'Sprawa klienta')
    await uzytkownik.click(screen.getByRole('button', { name: /Zgłoś zadanie/ }))

    assert.ok(await screen.findByRole('alert'))
    assert.strictEqual((screen.getByLabelText(/Czego dotyczy/) as HTMLInputElement).value, 'Sprawa klienta')
  })

  it('bez nazwy nie da się wysłać', async () => {
    const fetchMock = vi.fn()
    global.fetch = fetchMock as unknown as typeof fetch
    renderuj()

    const przycisk = screen.getByRole('button', { name: /Zgłoś zadanie/ }) as HTMLButtonElement
    assert.strictEqual(przycisk.disabled, true)
    assert.strictEqual(fetchMock.mock.calls.length, 0)
  })
})

describe('treść przeniesiona z rozmowy', () => {
  it('wstawia to, co klient już napisał asystentowi', () => {
    renderuj({ poczatkowaNazwa: 'Baner do podmiany', poczatkowyOpis: 'important.is, góra strony' })

    assert.strictEqual((screen.getByLabelText(/Czego dotyczy/) as HTMLInputElement).value, 'Baner do podmiany')
    assert.strictEqual((screen.getByLabelText(/Szczegóły/) as HTMLTextAreaElement).value, 'important.is, góra strony')
  })
})

describe('poziomy', () => {
  it('pokazuje trzy poziomy i ANI SŁOWA o alarmie', () => {
    renderuj()

    // Awaria ma własny czerwony przycisk, który uruchamia zegar i budzi
    // dyżurną. Gdyby stała tu jako pozycja listy, zgłoszenie awarii wyglądałoby
    // na obsłużone, a powiadomienie nie poszłoby nigdzie.
    assert.strictEqual(screen.getAllByRole('radio').length, 3)
    assert.strictEqual(screen.queryByRole('radio', { name: /P0|alarm/i }), null)
  })

  it('każdy poziom ma definicję, nie sam kod', () => {
    renderuj()
    // Klient nie zna naszej tabeli z oferty; sam kod „P2" nic mu nie mówi.
    assert.ok(screen.getByText(/nie blokuje sprzedaży/))
  })
})
