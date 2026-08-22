// @vitest-environment jsdom
import { describe, it, beforeEach, afterEach, vi } from 'vitest'
import assert from 'node:assert'
import { render, screen, cleanup, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { AutoTagsPicker } from './AutoTagsPicker'

/**
 * Checkboxy autoTags w karcie projektu.
 *
 * Zrodlo prawdy o tym, co widnieje na liscie, jest ZEWNETRZNE (ClickUp), wiec
 * ten komponent to w praktyce jeden fetch plus stan ladowania/bledu. Testy
 * pilnuja tego, co latwo popsuc przy zmianie: ze zaznaczenie/odznaczenie leci
 * jako `onChange` do rodzica (komponent NIE trzyma wlasnego stanu wyboru),
 * i ze awaria ClickUpa nie zostawia pustego ekranu bez wyjasnienia.
 *
 *   npx vitest run src/components/admin/AutoTagsPicker.test.tsx
 */
const fetchMock = vi.fn()

beforeEach(() => {
  vi.clearAllMocks()
  vi.stubGlobal('fetch', fetchMock)
})
afterEach(cleanup)

describe('ladowanie', () => {
  it('pokazuje stan ladowania przed odpowiedzia ClickUpa', () => {
    fetchMock.mockReturnValue(new Promise(() => {})) // nigdy sie nie rozstrzyga
    render(<AutoTagsPicker spaceId="90100136256" selected={[]} onChange={vi.fn()} />)

    assert.ok(screen.getByText(/Wczytuję tagi/))
  })

  it('pyta o WLASCIWA przestrzen, przekazana propsem', async () => {
    fetchMock.mockResolvedValue({ ok: true, json: async () => ({ tags: [] }) })
    render(<AutoTagsPicker spaceId="12345" selected={[]} onChange={vi.fn()} />)

    await waitFor(() => assert.strictEqual(fetchMock.mock.calls.length, 1))
    assert.match(String(fetchMock.mock.calls[0][0]), /spaceId=12345/)
  })

  it('pusta lista tagow pokazuje komunikat, nie pusty ekran', async () => {
    fetchMock.mockResolvedValue({ ok: true, json: async () => ({ tags: [] }) })
    render(<AutoTagsPicker spaceId="90100136256" selected={[]} onChange={vi.fn()} />)

    assert.ok(await screen.findByText(/nie ma jeszcze żadnych tagów/))
  })

  it('blad ClickUpa pokazuje komunikat, nie wywala komponentu', async () => {
    fetchMock.mockResolvedValue({ ok: false })
    render(<AutoTagsPicker spaceId="90100136256" selected={[]} onChange={vi.fn()} />)

    assert.ok(await screen.findByText(/Nie udało się pobrać tagów/))
  })
})

describe('wybor tagow', () => {
  beforeEach(() => {
    fetchMock.mockResolvedValue({ ok: true, json: async () => ({ tags: ['asana', 'portal', 'awaria'] }) })
  })

  it('zaznacza checkboxy zgodnie z propsem `selected`', async () => {
    render(<AutoTagsPicker spaceId="90100136256" selected={['asana']} onChange={vi.fn()} />)

    const asana = await screen.findByRole('checkbox', { name: 'asana' })
    const portal = screen.getByRole('checkbox', { name: 'portal' })
    assert.strictEqual((asana as HTMLInputElement).checked, true)
    assert.strictEqual((portal as HTMLInputElement).checked, false)
  })

  it('zaznaczenie DOKLADA tag do listy, nie zamienia jej', async () => {
    const onChange = vi.fn()
    const uzytkownik = userEvent.setup()
    render(<AutoTagsPicker spaceId="90100136256" selected={['asana']} onChange={onChange} />)

    await uzytkownik.click(await screen.findByRole('checkbox', { name: 'portal' }))

    assert.deepStrictEqual(onChange.mock.calls[0][0], ['asana', 'portal'])
  })

  it('odznaczenie USUWA tag, reszta zostaje', async () => {
    const onChange = vi.fn()
    const uzytkownik = userEvent.setup()
    render(<AutoTagsPicker spaceId="90100136256" selected={['asana', 'portal']} onChange={onChange} />)

    await uzytkownik.click(await screen.findByRole('checkbox', { name: 'asana' }))

    assert.deepStrictEqual(onChange.mock.calls[0][0], ['portal'])
  })
})
