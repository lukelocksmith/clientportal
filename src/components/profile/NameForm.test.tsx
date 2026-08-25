// @vitest-environment jsdom
import { describe, it, beforeEach, afterEach, vi } from 'vitest'
import assert from 'node:assert'
import { render, screen, cleanup, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'

/**
 * IMIE W PROFILU.
 *
 * Imie nie jest ozdoba: idzie do stopki zadania w ClickUpie i do podpisu
 * komentarza, czyli do miejsc, w ktorych zespol rozpoznaje, kto z ich strony
 * pisze. Test pilnuje dwoch rzeczy, ktorych trasa nie widzi: czy zadanie
 * niesie slug (bez niego brama sesji odpowie 400) i czy odmowa dociera do oczu.
 *
 *   npx vitest run src/components/profile/NameForm.test.tsx
 */
const fetchMock = vi.fn()

import { NameForm } from './NameForm'

beforeEach(() => {
  vi.clearAllMocks()
  fetchMock.mockResolvedValue({ ok: true, json: async () => ({ ok: true }) })
  vi.stubGlobal('fetch', fetchMock)
})
afterEach(cleanup)

describe('NameForm', () => {
  it('pokazuje imie, ktore juz jest zapisane', () => {
    render(<NameForm slug="onyx" initialName="Anna Kowalska" />)
    assert.strictEqual((screen.getByLabelText(/imię/i) as HTMLInputElement).value, 'Anna Kowalska')
  })

  it('zapisuje PATCH-em, ze slugiem i samym imieniem', async () => {
    const uzytkownik = userEvent.setup()
    render(<NameForm slug="onyx" initialName={null} />)

    await uzytkownik.type(screen.getByLabelText(/imię/i), 'Filip')
    await uzytkownik.click(screen.getByRole('button', { name: /zapisz/i }))

    await waitFor(() => assert.strictEqual(fetchMock.mock.calls.length, 1))
    const [url, opcje] = fetchMock.mock.calls[0]
    assert.match(String(url), /\/api\/profile/)
    assert.strictEqual((opcje as RequestInit).method, 'PATCH')
    // Samo imie i slug. Zdjecia NIE dotykamy: trasa rozroznia „nie ruszaj"
    // (brak pola) od „wyczysc" (null), wiec doklejenie `avatar: null` przy
    // zapisie imienia skasowaloby zdjecie.
    assert.deepStrictEqual(JSON.parse(String((opcje as RequestInit).body)), {
      slug: 'onyx',
      name: 'Filip',
    })
  })

  it('POKAZUJE odmowe z serwera', async () => {
    fetchMock.mockResolvedValue({ ok: false, json: async () => ({ error: 'Nie rozumiem tego żądania.' }) })
    const uzytkownik = userEvent.setup()
    render(<NameForm slug="onyx" initialName="Filip" />)

    await uzytkownik.click(screen.getByRole('button', { name: /zapisz/i }))

    await waitFor(() => assert.ok(screen.getByText(/nie rozumiem/i)))
  })

  it('potwierdza zapis, zeby klient wiedzial, ze cos sie stalo', async () => {
    const uzytkownik = userEvent.setup()
    render(<NameForm slug="onyx" initialName="Filip" />)

    await uzytkownik.type(screen.getByLabelText(/imię/i), 'ek')
    await uzytkownik.click(screen.getByRole('button', { name: /zapisz/i }))

    await waitFor(() => assert.ok(screen.getByText(/zapisane/i)))
  })
})
