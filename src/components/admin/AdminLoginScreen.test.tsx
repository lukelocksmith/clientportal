// @vitest-environment jsdom
import { describe, it, beforeEach, afterEach, vi } from 'vitest'
import assert from 'node:assert'
import { render, screen, cleanup, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { AdminLoginScreen } from './AdminLoginScreen'

/**
 * Ekran logowania do panelu admina.
 *
 * Wydzielony z `AdminPanel`, ktory mial 26 stanow, z czego trzy dotyczyly
 * wylacznie tego formularza — czyli ekranu, ktory po zalogowaniu przestaje
 * istniec. Testy sa tu wlasnie po to, ze wydzielenie bylo REFAKTOREM: zachowanie
 * ma zostac identyczne, a bez testu nikt tego nie sprawdzil.
 *
 * `fetch` jest podstawiony, bo to wyjscie na serwer. Reszta prawdziwa: render,
 * zdarzenia klawiatury i myszy przez `user-event`, czyli tak, jak robi to
 * czlowiek — a nie przez wolanie handlerow z reki.
 *
 *   npx vitest run src/components/admin/AdminLoginScreen.test.tsx
 */
const fetchMock = vi.fn()

beforeEach(() => {
  vi.clearAllMocks()
  vi.stubGlobal('fetch', fetchMock)
})
afterEach(cleanup)

const odpowiedz = (ok: boolean, body: unknown = {}) =>
  Promise.resolve({ ok, json: async () => body } as Response)

describe('AdminLoginScreen', () => {
  it('pola maja POWIAZANE etykiety, wiec da sie w nie trafic po nazwie', async () => {
    render(<AdminLoginScreen onLoggedIn={vi.fn()} />)

    // Przed wydzieleniem etykiety byly samym tekstem, bez `htmlFor` i `id`,
    // wiec klikniecie w napis nie ustawiało kursora w polu, a czytnik ekranu
    // nie wiedzial, ktore pole jest ktore.
    assert.ok(screen.getByLabelText('Email'))
    assert.ok(screen.getByLabelText('Hasło'))
  })

  it('pole hasla jest typu password, wiec tresc nie jest widoczna', () => {
    render(<AdminLoginScreen onLoggedIn={vi.fn()} />)

    assert.strictEqual(screen.getByLabelText('Hasło').getAttribute('type'), 'password')
  })

  it('poprawne dane wolaja trase logowania i zglaszaja sukces wyzej', async () => {
    const uzytkownik = userEvent.setup()
    const onLoggedIn = vi.fn()
    fetchMock.mockReturnValue(odpowiedz(true))
    render(<AdminLoginScreen onLoggedIn={onLoggedIn} />)

    await uzytkownik.type(screen.getByLabelText('Email'), 'admin@important.is')
    await uzytkownik.type(screen.getByLabelText('Hasło'), 'tajne-haslo')
    await uzytkownik.click(screen.getByRole('button', { name: 'Zaloguj' }))

    await waitFor(() => assert.strictEqual(onLoggedIn.mock.calls.length, 1))
    const [adres, opcje] = fetchMock.mock.calls[0]
    assert.strictEqual(adres, '/api/admin/login')
    assert.deepStrictEqual(JSON.parse(opcje.body), {
      email: 'admin@important.is',
      password: 'tajne-haslo',
    })
  })

  it('odmowa pokazuje komunikat z serwera i NIE przepuszcza dalej', async () => {
    const uzytkownik = userEvent.setup()
    const onLoggedIn = vi.fn()
    fetchMock.mockReturnValue(odpowiedz(false, { error: 'Nieprawidłowy email lub hasło' }))
    render(<AdminLoginScreen onLoggedIn={onLoggedIn} />)

    await uzytkownik.type(screen.getByLabelText('Email'), 'admin@important.is')
    await uzytkownik.type(screen.getByLabelText('Hasło'), 'zle')
    await uzytkownik.click(screen.getByRole('button', { name: 'Zaloguj' }))

    assert.ok(await screen.findByText('Nieprawidłowy email lub hasło'))
    assert.strictEqual(onLoggedIn.mock.calls.length, 0, 'panel NIE zostal otwarty')
  })

  it('odmowa BEZ tresci JSON tez daje czytelny komunikat', async () => {
    const uzytkownik = userEvent.setup()
    fetchMock.mockReturnValue(
      Promise.resolve({ ok: false, json: async () => { throw new Error('to nie JSON') } } as unknown as Response)
    )
    render(<AdminLoginScreen onLoggedIn={vi.fn()} />)

    await uzytkownik.type(screen.getByLabelText('Email'), 'a@b.c')
    await uzytkownik.type(screen.getByLabelText('Hasło'), 'x')
    await uzytkownik.click(screen.getByRole('button', { name: 'Zaloguj' }))

    // Serwer za posrednikiem potrafi oddac HTML zamiast JSON-a. Bez tego
    // formularz milczalby, a uzytkownik klikalby dalej w przekonaniu, ze nic
    // sie nie dzieje.
    assert.ok(await screen.findByText('Błąd logowania'))
  })

  it('poprawne logowanie po nieudanym KASUJE stary komunikat', async () => {
    const uzytkownik = userEvent.setup()
    fetchMock.mockReturnValueOnce(odpowiedz(false, { error: 'Nieprawidłowy email lub hasło' }))
    render(<AdminLoginScreen onLoggedIn={vi.fn()} />)

    await uzytkownik.type(screen.getByLabelText('Email'), 'a@b.c')
    await uzytkownik.type(screen.getByLabelText('Hasło'), 'zle')
    await uzytkownik.click(screen.getByRole('button', { name: 'Zaloguj' }))
    await screen.findByText('Nieprawidłowy email lub hasło')

    fetchMock.mockReturnValue(odpowiedz(true))
    await uzytkownik.click(screen.getByRole('button', { name: 'Zaloguj' }))

    // Komunikat, ktory zostal po udanej probie, mowilby nieprawde.
    await waitFor(() =>
      assert.strictEqual(screen.queryByText('Nieprawidłowy email lub hasło'), null)
    )
  })

  it('Enter w polu hasla wysyla formularz, bez siegania po mysz', async () => {
    const uzytkownik = userEvent.setup()
    const onLoggedIn = vi.fn()
    fetchMock.mockReturnValue(odpowiedz(true))
    render(<AdminLoginScreen onLoggedIn={onLoggedIn} />)

    await uzytkownik.type(screen.getByLabelText('Email'), 'admin@important.is')
    await uzytkownik.type(screen.getByLabelText('Hasło'), 'tajne{Enter}')

    await waitFor(() => assert.strictEqual(onLoggedIn.mock.calls.length, 1))
  })

  it('puste pola nie wysylaja zadania — pilnuje tego przegladarka', async () => {
    const uzytkownik = userEvent.setup()
    render(<AdminLoginScreen onLoggedIn={vi.fn()} />)

    await uzytkownik.click(screen.getByRole('button', { name: 'Zaloguj' }))

    // Oba pola maja `required`, wiec zgloszenie w ogole nie wychodzi.
    assert.strictEqual(fetchMock.mock.calls.length, 0)
  })
})
