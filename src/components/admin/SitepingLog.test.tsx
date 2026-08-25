// @vitest-environment jsdom
import { describe, it, beforeEach, afterEach, vi } from 'vitest'
import assert from 'node:assert'
import { render, screen, cleanup, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { SitepingLog } from './SitepingLog'

/**
 * Log diagnostyczny w panelu.
 *
 * Rzecz do upilnowania: log ma odpowiadac na „czemu klientowi nie dochodza
 * zgloszenia", wiec domyslnie pokazuje ODMOWY, a nie udane odczyty panelu
 * widgetu — tych jest najwiecej i wypchnelyby z widoku wszystko inne.
 *
 * Druga rzecz: kody HTTP nie sa odpowiedzia dla czlowieka. Wiersz ma mowic
 * „zgloszenie z niedozwolonej domeny", a nie „403".
 *
 *   npx vitest run src/components/admin/SitepingLog.test.tsx
 */
const fetchMock = vi.fn()

const WPIS = {
  id: 'w1',
  createdAt: '2026-08-25T10:00:00.000Z',
  method: 'POST',
  status: 403,
  outcome: 'origin_not_allowed',
  origin: 'https://staging.wodadlafirmy.pl',
  ipPrefix: '89.64.12',
  durationMs: 12,
  clickupTaskId: null,
  detail: null,
}

const odpowiedz = (entries: unknown[], summary: Record<string, unknown> = {}) => ({
  ok: true,
  json: async () => ({
    entries,
    summary: {
      days: 30,
      byOutcome: [{ outcome: 'origin_not_allowed', ile: 4, ostatni: '2026-08-25T10:00:00.000Z' }],
      lastFeedbackAt: null,
      ...summary,
    },
  }),
})

beforeEach(() => {
  vi.clearAllMocks()
  vi.stubGlobal('fetch', fetchMock)
  fetchMock.mockResolvedValue(odpowiedz([WPIS]))
})
afterEach(cleanup)

describe('pobieranie', () => {
  it('pyta o log TEGO projektu i domyslnie tylko o problemy', async () => {
    render(<SitepingLog slug="wdf" />)

    await waitFor(() => assert.ok(fetchMock.mock.calls.length > 0))
    const adres = String(fetchMock.mock.calls[0][0])
    assert.match(adres, /slug=wdf/)
    // Domyslny widok to „co nie dziala". Udane odczyty panelu widgetu sa
    // najczestszym zdarzeniem i zaslonilyby odmowy.
    assert.match(adres, /only=problems/)
  })

  it('przelacznik „pokaz wszystko" pyta o pelny log', async () => {
    const uzytkownik = userEvent.setup()
    render(<SitepingLog slug="wdf" />)
    await waitFor(() => assert.ok(fetchMock.mock.calls.length > 0))

    await uzytkownik.click(screen.getByRole('button', { name: /wszystkie/i }))

    await waitFor(() => assert.strictEqual(fetchMock.mock.calls.length, 2))
    assert.strictEqual(String(fetchMock.mock.calls[1][0]).includes('only=problems'), false)
  })
})

describe('czytelnosc wpisu', () => {
  it('wynik jest opisany po polsku, nie kodem HTTP', async () => {
    render(<SitepingLog slug="wdf" />)

    // „403" nikomu nie mowi, co zrobic. „Zgloszenie z niedozwolonej domeny"
    // prowadzi wprost do pola z domenami w konfiguracji.
    await waitFor(() => assert.ok(screen.getByText(/niedozwolonej domeny/i)))
  })

  it('pokazuje domene, z ktorej przyszlo odrzucone zadanie', async () => {
    render(<SitepingLog slug="wdf" />)

    // To jest cala wartosc tego wiersza: widac, ze widget siedzi na stagingu,
    // ktorego nie ma na liscie domen.
    await waitFor(() => assert.ok(screen.getByText(/staging\.wodadlafirmy\.pl/)))
  })

  it('adres IP jest pokazany jako prefiks, nigdy w calosci', async () => {
    render(<SitepingLog slug="wdf" />)

    await waitFor(() => assert.ok(screen.getByText('89.64.12.x')))
  })
})

describe('pusty log', () => {
  it('mowi, ze nic nie przyszlo, zamiast pokazywac pusta tabele', async () => {
    fetchMock.mockResolvedValue(odpowiedz([], { byOutcome: [] }))
    render(<SitepingLog slug="wdf" />)

    await waitFor(() => assert.ok(screen.getByText(/Brak wpisów/i)))
    // Pusta tabela z samymi naglowkami wyglada jak awaria panelu.
    assert.strictEqual(screen.queryByRole('table') === null, true)
  })
})

describe('gdy log nie odpowiada', () => {
  it('mowi o tym wprost, zamiast udawac pusty log', async () => {
    fetchMock.mockResolvedValue({ ok: false, status: 500, json: async () => ({}) })
    render(<SitepingLog slug="wdf" />)

    // „Nie udalo sie sprawdzic" i „nic nie przyszlo" to dwie rozne odpowiedzi,
    // a tylko druga znaczy, ze cos jest do naprawienia u klienta.
    await waitFor(() => assert.ok(screen.getByText(/Nie udało się pobrać/i)))
  })
})
