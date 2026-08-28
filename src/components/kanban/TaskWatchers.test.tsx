// @vitest-environment jsdom
/**
 * Kogo POZA zglaszajacym powiadamiamy o zadaniu.
 *
 * To jest obietnica poczty zlozona klientowi w interfejsie, wiec test pilnuje
 * jej od strony przegladarki: czy lista sie wczytuje, czy dopisanie i zdjecie
 * osoby idzie na wlasciwy adres z slugiem, i czy padniete pobranie NIE udaje,
 * ze nikogo nie powiadamiamy.
 *
 *   npx vitest run src/components/kanban/TaskWatchers.test.tsx
 */
import { describe, it, beforeEach, afterEach, vi } from 'vitest'
import assert from 'node:assert'
import { render, screen, cleanup, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'

const { toast } = vi.hoisted(() => ({ toast: { success: vi.fn(), error: vi.fn() } }))
vi.mock('sonner', () => ({ toast }))

import { TaskWatchers } from './TaskWatchers'

const fetchMock = vi.fn()

type Osoba = { userId: string; name: string | null; email: string }

const DOROTA: Osoba = { userId: '11111111-1111-4111-8111-111111111111', name: 'Dorota Nowak', email: 'dorota@klient.pl' }
const MAREK: Osoba = { userId: '22222222-2222-4222-8222-222222222222', name: 'Marek Bąk', email: 'marek@klient.pl' }

function odpowiadaj(stan: { watchers?: Osoba[]; candidates?: Osoba[] } = {}) {
  fetchMock.mockImplementation(async () => ({
    ok: true,
    json: async () => ({ watchers: stan.watchers ?? [], candidates: stan.candidates ?? [DOROTA, MAREK] }),
  }))
}

beforeEach(() => {
  vi.clearAllMocks()
  vi.stubGlobal('fetch', fetchMock)
  odpowiadaj()
})
afterEach(cleanup)

describe('lista powiadamianych', () => {
  it('pobiera liste ze slugiem i identyfikatorem zadania', async () => {
    render(<TaskWatchers slug="wdf" taskId="abc123" />)

    await waitFor(() => assert.ok(fetchMock.mock.calls.length >= 1))
    const adres = fetchMock.mock.calls[0][0] as string
    assert.match(adres, /\/api\/clickup\/tasks\/abc123\/watchers/)
    assert.match(adres, /slug=wdf/, 'bez sluga trasa odbija 401')
  })

  it('pusta lista mowi, ze idzie tylko do zglaszajacego', async () => {
    render(<TaskWatchers slug="wdf" taskId="abc123" />)
    assert.ok(await screen.findByText(/tylko zgłaszający/))
  })

  it('dopisanie osoby idzie POST-em z jej identyfikatorem', async () => {
    render(<TaskWatchers slug="wdf" taskId="abc123" />)
    await screen.findByText(/tylko zgłaszający/)

    await userEvent.click(screen.getByRole('button', { name: /Dodaj osobę/ }))
    await userEvent.click(await screen.findByText('Marek Bąk'))

    await waitFor(() => {
      const post = fetchMock.mock.calls.find(c => (c[1] as RequestInit | undefined)?.method === 'POST')
      assert.ok(post, 'brak POST-a')
      assert.deepStrictEqual(JSON.parse((post![1] as RequestInit).body as string), { userId: MAREK.userId })
    })
  })

  it('zdjecie osoby idzie DELETE-em z userId w adresie', async () => {
    odpowiadaj({ watchers: [MAREK] })
    render(<TaskWatchers slug="wdf" taskId="abc123" />)

    await userEvent.click(await screen.findByRole('button', { name: /Usuń z listy: Marek Bąk/ }))

    await waitFor(() => {
      const del = fetchMock.mock.calls.find(c => (c[1] as RequestInit | undefined)?.method === 'DELETE')
      assert.ok(del, 'brak DELETE')
      assert.match(del![0] as string, new RegExp(`userId=${MAREK.userId}`))
    })
  })

  it('padniete pobranie NIE udaje, ze nikogo nie powiadamiamy', async () => {
    // Cicha porazka zostawilaby napis „tylko zgłaszający", czyli
    // zdanie o stanie sprawy, ktorego w tym momencie nie znamy.
    fetchMock.mockResolvedValue({ ok: false, json: async () => ({}) })
    render(<TaskWatchers slug="wdf" taskId="abc123" />)

    assert.ok(await screen.findByText(/nie udało się wczytać/))
    assert.strictEqual(screen.queryByText(/tylko zgłaszający/), null)
  })

  it('osoba juz powiadamiana nie jest proponowana drugi raz', async () => {
    odpowiadaj({ watchers: [MAREK], candidates: [DOROTA, MAREK] })
    render(<TaskWatchers slug="wdf" taskId="abc123" />)

    await userEvent.click(await screen.findByRole('button', { name: /Dodaj osobę/ }))
    assert.ok(await screen.findByText('Dorota Nowak'))
    // „Marek Bąk" jest na ekranie jako plakietka, ale NIE jako pozycja do dodania.
    assert.strictEqual(screen.queryAllByText('Marek Bąk').length, 1)
  })

  it('konto bez nazwy pokazuje adres, nie pusty przycisk', async () => {
    odpowiadaj({ watchers: [{ ...MAREK, name: null }] })
    render(<TaskWatchers slug="wdf" taskId="abc123" />)

    assert.ok(await screen.findByText('marek@klient.pl'))
  })
})
