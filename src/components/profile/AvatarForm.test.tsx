// @vitest-environment jsdom
import { describe, it, beforeEach, afterEach, vi } from 'vitest'
import assert from 'node:assert'
import { render, screen, cleanup, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'

/**
 * ZDJECIE W PROFILU.
 *
 * Najwazniejsza rzecz do upilnowania jest tutaj taka, ze podglad zdjecia
 * wskazuje na TRASE `/api/avatar`, a nie na data URI wstawione w HTML.
 * Kolumna `avatar_url` ma przy sobie zakaz wstawiania data URI w payloady i
 * profil jest pierwszym miejscem, w ktorym latwo go zlamac, bo tu zdjecie jest
 * tematem strony.
 *
 * Skalowania (canvas) ten test NIE dotyka: jsdom nie ma canvasa, wiec kazde
 * jego udawanie sprawdzaloby atrape, a nie nasz kod. Sprawdzamy to, co dzieje
 * sie PRZED canvasem, czyli odsiew plikow, ktore do niego nie maja trafic.
 *
 *   npx vitest run src/components/profile/AvatarForm.test.tsx
 */
const fetchMock = vi.fn()

import { AvatarForm } from './AvatarForm'

beforeEach(() => {
  vi.clearAllMocks()
  fetchMock.mockResolvedValue({ ok: true, json: async () => ({ ok: true }) })
  vi.stubGlobal('fetch', fetchMock)
})
afterEach(cleanup)

const wejscie = () => document.querySelector('input[type="file"]') as HTMLInputElement

describe('AvatarForm', () => {
  it('podglad idzie TRASA /api/avatar, nie data URI w HTML', async () => {
    render(<AvatarForm slug="onyx" hasAvatar initials="AK" />)

    const img = await screen.findByRole('img')
    const src = img.getAttribute('src') ?? ''
    assert.match(src, /\/api\/avatar\?slug=onyx/)
    assert.strictEqual(src.startsWith('data:'), false)
  })

  it('bez zdjecia nie ma czego usuwac', () => {
    render(<AvatarForm slug="onyx" hasAvatar={false} initials="AK" />)
    // `=== null` w asercji: porownanie zywego wezla DOM do null w PADAJACEJ
    // asercji wywala workera vitest.
    assert.strictEqual(screen.queryByRole('button', { name: /usuń/i }) === null, true)
  })

  it('ze zdjeciem daje sie je usunac, PATCH-em z avatar: null', async () => {
    const uzytkownik = userEvent.setup()
    render(<AvatarForm slug="onyx" hasAvatar initials="AK" />)

    await uzytkownik.click(screen.getByRole('button', { name: /usuń/i }))

    await waitFor(() => assert.strictEqual(fetchMock.mock.calls.length, 1))
    const opcje = fetchMock.mock.calls[0][1] as RequestInit
    assert.deepStrictEqual(JSON.parse(String(opcje.body)), { slug: 'onyx', avatar: null })
  })

  it('ODRZUCA plik, ktory nie jest obrazkiem, i nie woła serwera', async () => {
    // `applyAccept: false` w setupie, bo filtr `accept="image/*"` w oknie
    // wyboru pliku NIE JEST gwarancja: przeciagniecie pliku i starsze
    // przegladarki potrafia go ominac. Sprawdzamy nasz odsiew, nie ich.
    const uzytkownik = userEvent.setup({ applyAccept: false })
    render(<AvatarForm slug="onyx" hasAvatar={false} initials="AK" />)

    await uzytkownik.upload(wejscie(), new File(['nie obrazek'], 'notatka.txt', { type: 'text/plain' }))

    await waitFor(() => assert.ok(screen.getByText(/plik graficzny/i)))
    assert.strictEqual(fetchMock.mock.calls.length, 0)
  })

  it('ODRZUCA plik ponad limit wejscia, zanim dotknie go canvas', async () => {
    // Skalowanie wczytuje caly plik do pamieci przegladarki. Zdjecie z aparatu
    // przepuszczone bez tego progu potrafi zamrozic karte na kilka sekund.
    const uzytkownik = userEvent.setup()
    render(<AvatarForm slug="onyx" hasAvatar={false} initials="AK" />)

    const ogromny = new File(['x'], 'foto.jpg', { type: 'image/jpeg' })
    Object.defineProperty(ogromny, 'size', { value: 40 * 1024 * 1024 })
    await uzytkownik.upload(wejscie(), ogromny)

    await waitFor(() => assert.ok(screen.getByText(/za duż/i)))
    assert.strictEqual(fetchMock.mock.calls.length, 0)
  })

  it('inicjaly zamiast pustego kola, gdy zdjecia nie ma', () => {
    render(<AvatarForm slug="onyx" hasAvatar={false} initials="AK" />)
    assert.ok(screen.getByText('AK'))
  })
})
