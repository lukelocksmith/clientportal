// @vitest-environment jsdom
import { describe, it, beforeEach, afterEach, vi } from 'vitest'
import assert from 'node:assert'
import { render, screen, cleanup, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'

/**
 * FORMULARZ ZMIANY HASLA.
 *
 * Trzy rzeczy, ktorych nie widzi ani `tsc`, ani test trasy:
 *
 *   1. Czy pole „obecne haslo" w ogole jest i czy jego brak zatrzymuje wysylke.
 *      To jest cala istota tej strony: przejeta sesja nie moze przejac konta.
 *      Trasa tego pilnuje, ale formularz, ktory pola nie ma, znaczy funkcje
 *      nie do uzycia.
 *   2. CO komponent wysyla na serwer. TaskDrawer wolal kiedys trase komentarzy
 *      bez `?slug=` i byl to blad widoczny dla uzytkownika, ktorego zaden test
 *      serwera nie mogl zlapac.
 *   3. Czy odmowa z serwera („obecne haslo jest nieprawidlowe") dociera do
 *      oczu uzytkownika. Cicha porazka wyglada jak zmiana, ktora sie udala.
 *
 *   npx vitest run src/components/profile/PasswordForm.test.tsx
 */
const fetchMock = vi.fn()

import { PasswordForm } from './PasswordForm'

beforeEach(() => {
  vi.clearAllMocks()
  fetchMock.mockResolvedValue({ ok: true, json: async () => ({ ok: true }) })
  vi.stubGlobal('fetch', fetchMock)
})
afterEach(cleanup)

/** Wypelnia trzy pola formularza i klika „Zmien haslo". */
async function wyslij(pola: { obecne: string; nowe: string; powtorz: string }) {
  const uzytkownik = userEvent.setup()
  if (pola.obecne) await uzytkownik.type(screen.getByLabelText(/obecne hasło/i), pola.obecne)
  if (pola.nowe) await uzytkownik.type(screen.getByLabelText(/^nowe hasło/i), pola.nowe)
  if (pola.powtorz) await uzytkownik.type(screen.getByLabelText(/powtórz/i), pola.powtorz)
  await uzytkownik.click(screen.getByRole('button', { name: /zmień hasło/i }))
}

describe('PasswordForm', () => {
  it('ma pole na OBECNE haslo', () => {
    render(<PasswordForm slug="onyx" />)
    // `=== null` w asercji, nie `assert.strictEqual(el, null)`: porownanie
    // zywego wezla DOM do null w PADAJACEJ asercji wywala workera vitest.
    assert.strictEqual(screen.queryByLabelText(/obecne hasło/i) === null, false)
  })

  it('NIE woła serwera, gdy powtorzenie sie nie zgadza', async () => {
    render(<PasswordForm slug="onyx" />)

    await wyslij({ obecne: 'stare-haslo-1', nowe: 'nowe-haslo-2026', powtorz: 'inne-haslo-2026' })

    assert.strictEqual(fetchMock.mock.calls.length, 0, 'formularz wyslal zadanie skazane na odmowe')
    await waitFor(() => assert.ok(screen.getByText(/takie same/i)))
  })

  it('NIE woła serwera bez obecnego hasla', async () => {
    render(<PasswordForm slug="onyx" />)

    await wyslij({ obecne: '', nowe: 'nowe-haslo-2026', powtorz: 'nowe-haslo-2026' })

    assert.strictEqual(fetchMock.mock.calls.length, 0)
  })

  it('wysyla komplet pol RAZEM ZE SLUGIEM', async () => {
    render(<PasswordForm slug="onyx" />)

    await wyslij({ obecne: 'stare-haslo-1', nowe: 'nowe-haslo-2026', powtorz: 'nowe-haslo-2026' })

    await waitFor(() => assert.strictEqual(fetchMock.mock.calls.length, 1))
    const [url, opcje] = fetchMock.mock.calls[0]
    assert.match(String(url), /\/api\/profile\/password/)
    const cialo = JSON.parse(String((opcje as RequestInit).body))
    assert.deepStrictEqual(cialo, {
      slug: 'onyx',
      current: 'stare-haslo-1',
      next: 'nowe-haslo-2026',
      confirm: 'nowe-haslo-2026',
    })
    // Zadnego `userId` w ciele: trasa bierze konto z sesji i odrzuca nieznane
    // pola, wiec doklejenie go tutaj zamienia formularz w martwy przycisk.
    assert.strictEqual('userId' in cialo, false)
  })

  it('POKAZUJE odmowe z serwera zamiast udawac sukces', async () => {
    fetchMock.mockResolvedValue({
      ok: false,
      json: async () => ({ error: 'Obecne hasło jest nieprawidłowe.' }),
    })
    render(<PasswordForm slug="onyx" />)

    await wyslij({ obecne: 'zle-haslo-123', nowe: 'nowe-haslo-2026', powtorz: 'nowe-haslo-2026' })

    await waitFor(() => assert.ok(screen.getByText(/nieprawidłowe/i)))
  })

  it('po zmianie potwierdza i CZYSCI pola', async () => {
    render(<PasswordForm slug="onyx" />)

    await wyslij({ obecne: 'stare-haslo-1', nowe: 'nowe-haslo-2026', powtorz: 'nowe-haslo-2026' })

    // Pola z haslem zostawione po zmianie to gotowy material do przypadkowego
    // wyslania drugi raz, tym razem ze starym haslem juz nieaktualnym.
    await waitFor(() => {
      assert.strictEqual((screen.getByLabelText(/obecne hasło/i) as HTMLInputElement).value, '')
      assert.strictEqual((screen.getByLabelText(/^nowe hasło/i) as HTMLInputElement).value, '')
    })
    assert.ok(screen.getByText(/hasło zmienione/i))
  })

  it('pola sa typu password, wiec haslo nie zostaje na ekranie', () => {
    render(<PasswordForm slug="onyx" />)
    for (const etykieta of [/obecne hasło/i, /^nowe hasło/i, /powtórz/i]) {
      assert.strictEqual((screen.getByLabelText(etykieta) as HTMLInputElement).type, 'password')
    }
  })
})
