// @vitest-environment jsdom
import { describe, it, beforeEach, afterEach, vi } from 'vitest'
import assert from 'node:assert'
import { render, screen, cleanup, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { AutoTagsPicker } from './AutoTagsPicker'

/**
 * Multiselect autoTags w karcie projektu.
 *
 * Zrodlo prawdy o tym, co widnieje na liscie, jest ZEWNETRZNE (ClickUp), wiec
 * ten komponent to w praktyce jeden fetch plus stan ladowania/bledu. Testy
 * pilnuja tego, co latwo popsuc przy zmianie: ze zaznaczenie/odznaczenie leci
 * jako `onChange` do rodzica (komponent NIE trzyma wlasnego stanu wyboru),
 * ze lista zostaje otwarta po pierwszym kliknieciu (inaczej multiselect
 * wymaga otwierania jej raz na tag), ze filtr faktycznie zaweza liste (68
 * tagow w przestrzeni WDF), i ze awaria ClickUpa nie zostawia pustego ekranu
 * bez wyjasnienia.
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

describe('pole wyboru', () => {
  beforeEach(() => {
    fetchMock.mockResolvedValue({ ok: true, json: async () => ({ tags: ['asana', 'portal', 'awaria'] }) })
  })

  it('wybrane tagi widac w polu, bez otwierania listy', async () => {
    render(<AutoTagsPicker spaceId="90100136256" selected={['asana', 'awaria']} onChange={vi.fn()} />)

    assert.ok(await screen.findByRole('button', { name: 'Usuń tag asana' }))
    assert.ok(screen.getByRole('button', { name: 'Usuń tag awaria' }))
    assert.strictEqual(screen.queryByRole('button', { name: 'Usuń tag portal' }), null)
  })

  it('brak wyboru mowi to wprost, nie pustym polem', async () => {
    render(<AutoTagsPicker spaceId="90100136256" selected={[]} onChange={vi.fn()} />)

    assert.ok(await screen.findByRole('button', { name: /Wybierz tagi/ }))
  })

  it('krzyzyk na plakietce USUWA tag, reszta zostaje', async () => {
    const onChange = vi.fn()
    const uzytkownik = userEvent.setup()
    render(<AutoTagsPicker spaceId="90100136256" selected={['asana', 'portal']} onChange={onChange} />)

    await uzytkownik.click(await screen.findByRole('button', { name: 'Usuń tag asana' }))

    assert.deepStrictEqual(onChange.mock.calls[0][0], ['portal'])
  })
})

describe('wybor z listy', () => {
  beforeEach(() => {
    fetchMock.mockResolvedValue({ ok: true, json: async () => ({ tags: ['asana', 'portal', 'awaria'] }) })
  })

  /** Lista jest za przyciskiem, wiec kazdy test wyboru musi ja najpierw otworzyc. */
  async function otworz(uzytkownik: ReturnType<typeof userEvent.setup>) {
    await uzytkownik.click(await screen.findByRole('button', { name: /Wybierz tagi|Dodaj/ }))
  }

  it('zaznacza pozycje zgodnie z propsem `selected`', async () => {
    const uzytkownik = userEvent.setup()
    render(<AutoTagsPicker spaceId="90100136256" selected={['asana']} onChange={vi.fn()} />)
    await otworz(uzytkownik)

    const asana = await screen.findByRole('checkbox', { name: 'asana' })
    const portal = screen.getByRole('checkbox', { name: 'portal' })
    assert.strictEqual(asana.getAttribute('aria-checked'), 'true')
    assert.strictEqual(portal.getAttribute('aria-checked'), 'false')
  })

  it('zaznaczenie DOKLADA tag do listy, nie zamienia jej', async () => {
    const onChange = vi.fn()
    const uzytkownik = userEvent.setup()
    render(<AutoTagsPicker spaceId="90100136256" selected={['asana']} onChange={onChange} />)
    await otworz(uzytkownik)

    await uzytkownik.click(await screen.findByRole('checkbox', { name: 'portal' }))

    assert.deepStrictEqual(onChange.mock.calls[0][0], ['asana', 'portal'])
  })

  it('odznaczenie na liscie USUWA tag, reszta zostaje', async () => {
    const onChange = vi.fn()
    const uzytkownik = userEvent.setup()
    render(<AutoTagsPicker spaceId="90100136256" selected={['asana', 'portal']} onChange={onChange} />)
    await otworz(uzytkownik)

    await uzytkownik.click(await screen.findByRole('checkbox', { name: 'asana' }))

    assert.deepStrictEqual(onChange.mock.calls[0][0], ['portal'])
  })

  it('lista zostaje otwarta po kliknieciu, zeby dalo sie wybrac kilka tagow', async () => {
    const uzytkownik = userEvent.setup()
    render(<AutoTagsPicker spaceId="90100136256" selected={[]} onChange={vi.fn()} />)
    await otworz(uzytkownik)

    await uzytkownik.click(await screen.findByRole('checkbox', { name: 'asana' }))

    assert.ok(screen.getByRole('checkbox', { name: 'portal' }))
  })

  it('wybrane tagi sa na gorze listy, zeby nie trzeba bylo ich szukac', async () => {
    const uzytkownik = userEvent.setup()
    render(<AutoTagsPicker spaceId="90100136256" selected={['awaria']} onChange={vi.fn()} />)
    await otworz(uzytkownik)

    await screen.findByRole('checkbox', { name: 'awaria' })
    const kolejnosc = screen.getAllByRole('checkbox').map(el => el.textContent)
    assert.deepStrictEqual(kolejnosc, ['awaria', 'asana', 'portal'])
  })

  it('„Wyczyść wybór" zeruje cala liste', async () => {
    const onChange = vi.fn()
    const uzytkownik = userEvent.setup()
    render(<AutoTagsPicker spaceId="90100136256" selected={['asana', 'portal']} onChange={onChange} />)
    await otworz(uzytkownik)

    await uzytkownik.click(await screen.findByRole('button', { name: /Wyczyść wybór/ }))

    assert.deepStrictEqual(onChange.mock.calls[0][0], [])
  })

  it('bez wyboru nie ma czego czyscic, wiec nie ma tej pozycji', async () => {
    const uzytkownik = userEvent.setup()
    render(<AutoTagsPicker spaceId="90100136256" selected={[]} onChange={vi.fn()} />)
    await otworz(uzytkownik)

    await screen.findByRole('checkbox', { name: 'asana' })
    assert.strictEqual(screen.queryByRole('button', { name: /Wyczyść wybór/ }), null)
  })

  it('tag usuniety z przestrzeni ClickUp, ale wybrany, nadal da sie odznaczyc', async () => {
    const onChange = vi.fn()
    const uzytkownik = userEvent.setup()
    render(<AutoTagsPicker spaceId="90100136256" selected={['stary-tag']} onChange={onChange} />)
    await otworz(uzytkownik)

    await uzytkownik.click(await screen.findByRole('checkbox', { name: 'stary-tag' }))

    assert.deepStrictEqual(onChange.mock.calls[0][0], [])
  })
})

describe('filtr', () => {
  beforeEach(() => {
    fetchMock.mockResolvedValue({
      ok: true,
      json: async () => ({ tags: ['asana', 'portal', 'awaria', 'ui-ux'] }),
    })
  })

  async function otworzZFiltrem(uzytkownik: ReturnType<typeof userEvent.setup>, fraza: string) {
    await uzytkownik.click(await screen.findByRole('button', { name: /Wybierz tagi|Dodaj/ }))
    await uzytkownik.type(await screen.findByRole('textbox', { name: 'Szukaj tagu' }), fraza)
  }

  it('zaweza liste do pasujacych tagow', async () => {
    const uzytkownik = userEvent.setup()
    render(<AutoTagsPicker spaceId="90100136256" selected={[]} onChange={vi.fn()} />)
    await otworzZFiltrem(uzytkownik, 'a')

    const widoczne = screen.getAllByRole('checkbox').map(el => el.textContent)
    assert.deepStrictEqual(widoczne, ['asana', 'portal', 'awaria'])
  })

  it('szuka bez wzgledu na wielkosc liter', async () => {
    const uzytkownik = userEvent.setup()
    render(<AutoTagsPicker spaceId="90100136256" selected={[]} onChange={vi.fn()} />)
    await otworzZFiltrem(uzytkownik, 'UI')

    const widoczne = screen.getAllByRole('checkbox').map(el => el.textContent)
    assert.deepStrictEqual(widoczne, ['ui-ux'])
  })

  it('brak trafien mowi to wprost, nie pusta lista', async () => {
    const uzytkownik = userEvent.setup()
    render(<AutoTagsPicker spaceId="90100136256" selected={[]} onChange={vi.fn()} />)
    await otworzZFiltrem(uzytkownik, 'nieistniejacy')

    assert.ok(await screen.findByText(/Brak tagów pasujących/))
  })

  it('zamkniecie zeruje filtr, zeby nastepne otwarcie pokazalo cala liste', async () => {
    const uzytkownik = userEvent.setup()
    render(<AutoTagsPicker spaceId="90100136256" selected={[]} onChange={vi.fn()} />)
    await otworzZFiltrem(uzytkownik, 'ui')
    await uzytkownik.keyboard('{Escape}')

    await uzytkownik.click(await screen.findByRole('button', { name: /Wybierz tagi|Dodaj/ }))

    await screen.findByRole('checkbox', { name: 'asana' })
    assert.strictEqual(screen.getAllByRole('checkbox').length, 4)
  })
})
