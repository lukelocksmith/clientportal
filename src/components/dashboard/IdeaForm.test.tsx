// @vitest-environment jsdom
import { describe, it, beforeEach, afterEach, vi } from 'vitest'
import assert from 'node:assert'
import { render, screen, cleanup, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'

/**
 * FORMULARZ POMYSLU na Dashboardzie.
 *
 * REGRESJA warta wlasnego testu: trasa /api/portal-ideas przeszla z JSON-a na
 * multipart/form-data (zeby dalo sie dolaczyc obraz — plik nie zakoduje sie w
 * JSON-ie bez base64). Klient zglosil, ze nie mogl dolaczyc grafiki do
 * pomyslu; to ten sam mechanizm zalacznikow co w AI Czacie i w komentarzach
 * zadania (paperclip + wklej ze schowka + podglad z X do usuniecia).
 *
 *   npx vitest run src/components/dashboard/IdeaForm.test.tsx
 */
import { IdeaForm } from './IdeaForm'

const fetchMock = vi.fn()

beforeEach(() => {
  vi.clearAllMocks()
  vi.stubGlobal('fetch', fetchMock)
  fetchMock.mockResolvedValue({ ok: true, json: async () => ({ ok: true, attachmentsFailed: 0 }) })
  URL.createObjectURL = vi.fn(() => 'blob:mock-url')
  URL.revokeObjectURL = vi.fn()
})
afterEach(cleanup)

const TRESC = 'Przydalby sie eksport historii do PDF'

describe('wysylka pomyslu', () => {
  it('REGRESJA: idzie multipart/form-data (nie JSON), z slugiem i tekstem', async () => {
    const uzytkownik = userEvent.setup()
    render(<IdeaForm slug="wdf" />)

    await uzytkownik.type(screen.getByPlaceholderText(/przydałby się filtr/), TRESC)
    await uzytkownik.click(screen.getByRole('button', { name: /Wyślij pomysł/ }))

    await waitFor(() => assert.strictEqual(fetchMock.mock.calls.length, 1))
    const [adres, opcje] = fetchMock.mock.calls[0]
    assert.strictEqual(adres, '/api/portal-ideas')
    assert.strictEqual(opcje.method, 'POST')
    assert.ok(opcje.body instanceof FormData, 'plik nie zakoduje sie w JSON-ie bez base64')
    assert.strictEqual(opcje.body.get('slug'), 'wdf')
    assert.strictEqual(opcje.body.get('text'), TRESC)
  })

  it('przycisk wysylki jest zablokowany ponizej minimalnej dlugosci', async () => {
    const uzytkownik = userEvent.setup()
    render(<IdeaForm slug="wdf" />)
    const przycisk = screen.getByRole('button', { name: /Wyślij pomysł/ }) as HTMLButtonElement
    assert.strictEqual(przycisk.disabled, true)

    await uzytkownik.type(screen.getByPlaceholderText(/przydałby się filtr/), 'za krotko')
    assert.strictEqual(przycisk.disabled, true)
    assert.ok(screen.getByText('Napisz jeszcze kilka słów, żebyśmy zrozumieli.'))
  })

  it('po udanej wysylce pokazuje potwierdzenie zamiast formularza', async () => {
    const uzytkownik = userEvent.setup()
    render(<IdeaForm slug="wdf" />)

    await uzytkownik.type(screen.getByPlaceholderText(/przydałby się filtr/), TRESC)
    await uzytkownik.click(screen.getByRole('button', { name: /Wyślij pomysł/ }))

    assert.ok(await screen.findByText('Dzięki, mamy to.'))
  })

  it('blad z API pokazuje komunikat i NIE czysci wpisanej tresci', async () => {
    const uzytkownik = userEvent.setup()
    fetchMock.mockResolvedValue({ ok: false, json: async () => ({ error: 'Poczekaj 2 minuty' }) })
    render(<IdeaForm slug="wdf" />)

    const pole = screen.getByPlaceholderText(/przydałby się filtr/)
    await uzytkownik.type(pole, TRESC)
    await uzytkownik.click(screen.getByRole('button', { name: /Wyślij pomysł/ }))

    assert.ok(await screen.findByText('Poczekaj 2 minuty'))
    assert.strictEqual((pole as HTMLTextAreaElement).value, TRESC, 'blad nie ma prawa zjesc tego, co klient napisal')
  })
})

describe('zalaczanie obrazu do pomyslu', () => {
  function wybierzObraz(): File {
    return new File(['dane obrazu'], 'zrzut.png', { type: 'image/png' })
  }

  it('wybrany obraz pokazuje podglad z miniatura', async () => {
    const uzytkownik = userEvent.setup()
    render(<IdeaForm slug="wdf" />)

    const wejscie = document.querySelector('input[type="file"]') as HTMLInputElement
    await uzytkownik.upload(wejscie, wybierzObraz())

    assert.ok(screen.getByAltText('zrzut.png'), 'miniatura podgladu obrazu')
  })

  it('obraz leci w tym samym zgloszeniu co tekst, w polu files', async () => {
    const uzytkownik = userEvent.setup()
    render(<IdeaForm slug="wdf" />)

    const wejscie = document.querySelector('input[type="file"]') as HTMLInputElement
    await uzytkownik.upload(wejscie, wybierzObraz())
    await uzytkownik.type(screen.getByPlaceholderText(/przydałby się filtr/), TRESC)
    await uzytkownik.click(screen.getByRole('button', { name: /Wyślij pomysł/ }))

    await waitFor(() => assert.strictEqual(fetchMock.mock.calls.length, 1))
    const body = fetchMock.mock.calls[0][1].body as FormData
    const plik = body.get('files') as File
    assert.strictEqual(plik.name, 'zrzut.png')
  })

  it('usuniecie obrazu z podgladu PRZED wyslaniem zdejmuje go z FormData', async () => {
    const uzytkownik = userEvent.setup()
    render(<IdeaForm slug="wdf" />)

    const wejscie = document.querySelector('input[type="file"]') as HTMLInputElement
    await uzytkownik.upload(wejscie, wybierzObraz())
    await uzytkownik.click(screen.getByLabelText('Usuń obraz'))
    await uzytkownik.type(screen.getByPlaceholderText(/przydałby się filtr/), TRESC)
    await uzytkownik.click(screen.getByRole('button', { name: /Wyślij pomysł/ }))

    await waitFor(() => assert.strictEqual(fetchMock.mock.calls.length, 1))
    const body = fetchMock.mock.calls[0][1].body as FormData
    assert.strictEqual(body.get('files'), null, 'usuniety obraz nie ma prawa wrocic przy wysylce')
  })

  it('sam tekst bez obrazu nadal dziala (zalacznik jest dodatkiem, nie wymogiem)', async () => {
    const uzytkownik = userEvent.setup()
    render(<IdeaForm slug="wdf" />)

    await uzytkownik.type(screen.getByPlaceholderText(/przydałby się filtr/), TRESC)
    await uzytkownik.click(screen.getByRole('button', { name: /Wyślij pomysł/ }))

    await waitFor(() => assert.strictEqual(fetchMock.mock.calls.length, 1))
    const body = fetchMock.mock.calls[0][1].body as FormData
    assert.strictEqual(body.get('files'), null)
  })
})
