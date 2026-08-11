// @vitest-environment jsdom
import { describe, it, beforeEach, afterEach, vi } from 'vitest'
import assert from 'node:assert'
import { render, screen, cleanup, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { SitepingConfigSection } from './SitepingConfigSection'

/**
 * Konfiguracja SitePinga w karcie projektu.
 *
 * Ta sekcja istnieje po to, zeby wlaczenie funkcji u klienta nie wymagalo
 * curla. Testy pilnuja rzeczy, ktore przy klikaniu latwo przeoczyc, a ktore
 * konczyly sie „czemu zgloszenia nie dochodza": ostrzezenia o tagu, ktore
 * trzeba przeczytac PRZED wlaczeniem, i sygnalu, ze wlaczona flaga bez domen
 * nie robi nic.
 *
 *   npx vitest run src/components/admin/SitepingConfigSection.test.tsx
 */
const fetchMock = vi.fn()
/**
 * Trzymany osobno: `userEvent.setup()` tez podstawia schowek.
 *
 * GOLE `vi.fn()`, bez implementacji: `vi.fn(async () => {})` zawezalby typ
 * wywolan do sygnatury bezargumentowej i `mock.calls[0][0]` przestaloby
 * istniec dla TypeScriptu.
 */
const writeText = vi.fn()

const portal = (nadpisz: Partial<{ sitepingEnabled: boolean; siteDomains: string | null }> = {}) => ({
  slug: 'wdf',
  sitepingEnabled: false,
  siteDomains: null,
  ...nadpisz,
})

const wlasciwosci = { appUrl: 'https://portal.important.is', onSaved: vi.fn() }

beforeEach(() => {
  vi.clearAllMocks()
  vi.stubGlobal('fetch', fetchMock)
  fetchMock.mockResolvedValue({
    ok: true,
    json: async () => ({ portal: portal({ sitepingEnabled: true }) }),
  })
  writeText.mockResolvedValue(undefined)
  vi.stubGlobal('navigator', { clipboard: { writeText } })
})
afterEach(cleanup)

describe('ostrzezenie o tagu', () => {
  it('jest widoczne TAKZE przy wylaczonej fladze', () => {
    render(<SitepingConfigSection portal={portal()} {...wlasciwosci} />)

    // Tag trzeba zalozyc ZANIM ktokolwiek wlaczy funkcje. Ostrzezenie
    // pokazywane dopiero po wlaczeniu przyszloby po tym, jak pierwsze
    // zgloszenie po cichu straci oznaczenie.
    assert.ok(screen.getByText(/po cichu pomija/))
    assert.ok(screen.getByText(/siteping/))
  })

  it('wymienia WSZYSTKIE wymagane tagi, nie tylko `siteping`', () => {
    render(<SitepingConfigSection portal={portal()} {...wlasciwosci} />)

    for (const tag of ['błąd', 'zmiana', 'pytanie', 'inne']) {
      assert.ok(screen.getByText(tag), `brak tagu ${tag} w ostrzezeniu`)
    }
  })
})

describe('wlaczona flaga bez domen', () => {
  it('mowi wprost, ze endpoint pozostaje zamkniety', () => {
    render(<SitepingConfigSection portal={portal({ sitepingEnabled: true })} {...wlasciwosci} />)

    // To jest stan, ktory wyglada na dzialajacy (ptaszek zaznaczony), a nie
    // dziala. Bez tego komunikatu diagnoza wymaga wejscia w kod trasy.
    assert.ok(screen.getByText(/endpoint pozostaje zamknięty/))
  })

  it('przy uzupelnionych domenach ostrzezenia NIE ma', () => {
    render(
      <SitepingConfigSection
        portal={portal({ sitepingEnabled: true, siteDomains: 'wodadlafirmy.pl' })}
        {...wlasciwosci}
      />
    )

    assert.strictEqual(screen.queryByText(/endpoint pozostaje zamknięty/), null)
  })

  it('przy WYLACZONEJ fladze ostrzezenia tez nie ma', () => {
    render(<SitepingConfigSection portal={portal()} {...wlasciwosci} />)

    assert.strictEqual(screen.queryByText(/endpoint pozostaje zamknięty/), null)
  })
})

describe('zapis', () => {
  it('przelacznik wysyla PATCH ze slugiem i flaga', async () => {
    const uzytkownik = userEvent.setup()
    render(<SitepingConfigSection portal={portal()} {...wlasciwosci} />)

    await uzytkownik.click(screen.getByRole('checkbox'))

    await waitFor(() => assert.strictEqual(fetchMock.mock.calls.length, 1))
    const [adres, opcje] = fetchMock.mock.calls[0]
    assert.strictEqual(adres, '/api/admin/portals')
    assert.strictEqual(opcje.method, 'PATCH')
    assert.deepStrictEqual(JSON.parse(opcje.body), { slug: 'wdf', sitepingEnabled: true })
  })

  it('domeny zapisuja sie po opuszczeniu pola, nie przy kazdym znaku', async () => {
    const uzytkownik = userEvent.setup()
    render(<SitepingConfigSection portal={portal()} {...wlasciwosci} />)

    const pole = screen.getByPlaceholderText(/wodadlafirmy/)
    await uzytkownik.type(pole, 'demo.pl')
    // Zapis przy kazdym znaku bilby w trase kilkanascie razy na jedno pole.
    assert.strictEqual(fetchMock.mock.calls.length, 0)

    await uzytkownik.tab()
    await waitFor(() => assert.strictEqual(fetchMock.mock.calls.length, 1))
    assert.deepStrictEqual(JSON.parse(fetchMock.mock.calls[0][1].body), {
      slug: 'wdf', siteDomains: 'demo.pl',
    })
  })

  it('BEZ zmiany tresci opuszczenie pola nie zapisuje niczego', async () => {
    const uzytkownik = userEvent.setup()
    render(
      <SitepingConfigSection portal={portal({ siteDomains: 'demo.pl' })} {...wlasciwosci} />
    )

    await uzytkownik.click(screen.getByPlaceholderText(/wodadlafirmy/))
    await uzytkownik.tab()

    assert.strictEqual(fetchMock.mock.calls.length, 0)
  })

  it('odrzucona domena pokazuje POWOD z serwera, nie ogolny komunikat', async () => {
    const uzytkownik = userEvent.setup()
    fetchMock.mockResolvedValue({
      ok: false,
      json: async () => ({
        error: { fieldErrors: { siteDomains: ['Podaj nazwy hostów po przecinku, bez https://'] } },
      }),
    })
    render(<SitepingConfigSection portal={portal()} {...wlasciwosci} />)

    await uzytkownik.type(screen.getByPlaceholderText(/wodadlafirmy/), 'https://demo.pl')
    await uzytkownik.tab()

    // „Nie udalo sie zapisac" kazaloby zgadywac, co jest zle w domenie.
    assert.ok(await screen.findByText(/bez https:\/\//))
  })
})

describe('kod do wklejenia', () => {
  it('jest ZWINIETY na starcie', () => {
    render(<SitepingConfigSection portal={portal()} {...wlasciwosci} />)

    // Sekcja konfiguracji ma sie dac przejrzec jednym spojrzeniem; snippet
    // to kilkadziesiat linii, ktore rozpychaja karte projektu.
    assert.strictEqual(screen.queryByText(/mu-plugins/), null)
  })

  it('po rozwinieciu domyslnie pokazuje wariant WordPress', async () => {
    const uzytkownik = userEvent.setup()
    render(<SitepingConfigSection portal={portal()} {...wlasciwosci} />)

    await uzytkownik.click(screen.getByRole('button', { name: /Kod do wklejenia/ }))

    // Wszyscy klienci siedza na WordPressie, a tylko ten wariant podstawia
    // tozsamosc — czyli robi to, co widget ma robic po ostatniej zmianie.
    assert.ok(await screen.findByText(/mu-plugins\/siteping\.php/))
    assert.ok(screen.getByText(/podstawia dane\s+zgłaszającego/))
  })

  it('wariant HTML mowi WPROST, ze NIE podstawia tozsamosci', async () => {
    const uzytkownik = userEvent.setup()
    render(<SitepingConfigSection portal={portal()} {...wlasciwosci} />)
    await uzytkownik.click(screen.getByRole('button', { name: /Kod do wklejenia/ }))

    await uzytkownik.click(screen.getByRole('button', { name: 'Zwykły HTML' }))

    // Bez tego zdania ktos wklei prostszy wariant i zdziwi sie, ze widget
    // pyta klienta o imie mimo calej zbudowanej wymiany tokenu.
    assert.ok(await screen.findByText(/nie podstawia tożsamości/))
  })

  it('kod niesie slug TEGO projektu', async () => {
    const uzytkownik = userEvent.setup()
    render(<SitepingConfigSection portal={portal()} {...wlasciwosci} />)
    await uzytkownik.click(screen.getByRole('button', { name: /Kod do wklejenia/ }))

    const kod = await screen.findByText(/api\/siteping\/wdf/)
    assert.ok(kod)
  })

  it('ostrzezenie o zbieraniu konsoli stoi PRZY kodzie', async () => {
    const uzytkownik = userEvent.setup()
    render(<SitepingConfigSection portal={portal()} {...wlasciwosci} />)

    await uzytkownik.click(screen.getByRole('button', { name: /Kod do wklejenia/ }))

    // Snippet bedzie kopiowany bez czytania reszty karty, wiec ostrzezenie
    // musi byc widoczne razem z nim, a nie w osobnym miejscu.
    assert.ok(await screen.findByText(/danymi jego użytkowników/))
  })

  it('kopiowanie wklada kod do schowka', async () => {
    const uzytkownik = userEvent.setup()
    // Schowek podstawiamy PO `setup()`: ono instaluje wlasny i nadpisaloby nasz.
    vi.stubGlobal('navigator', { clipboard: { writeText } })
    render(<SitepingConfigSection portal={portal()} {...wlasciwosci} />)
    await uzytkownik.click(screen.getByRole('button', { name: /Kod do wklejenia/ }))

    await uzytkownik.click(await screen.findByRole('button', { name: /Kopiuj/ }))

    await waitFor(() => assert.ok(writeText.mock.calls.length > 0))
    assert.match(String(writeText.mock.calls[0][0]), /Plugin Name: SitePing \(wdf\)/)
  })
})
