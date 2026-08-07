// @vitest-environment jsdom
import { describe, it, beforeEach, afterEach, vi } from 'vitest'
import assert from 'node:assert'
import { render, screen, cleanup, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import type { ClickUpTask } from '@/lib/types'

/**
 * SZUFLADA ZADANIA — panel, ktory klient otwiera przy kazdym zadaniu.
 *
 * Tu siedzial blad widoczny dla uzytkownika: `TaskDrawer` wolal trase
 * komentarzy BEZ `?slug=`, a obejscie admina dziala wylacznie dla nazwanego
 * portalu. Admin ogladajacy portal klienta widzial zalaczniki (tamto wywolanie
 * slug mialo) i PUSTY watek komentarzy, a formularz odpowiedzi cicho odbijal
 * sie o 401. Test „oba wywolania niosa slug" pilnuje tego od strony
 * przegladarki; jego para po stronie serwera jest w routes.clickupTasks.
 *
 * Drugi powod istnienia tego pliku: `MarkdownLite` renderuje OPIS ZADANIA,
 * czyli tresc pochodzaca z ClickUpa, w tym z formularza klienta. To jest
 * miejsce, w ktorym wstrzykniecie znacznika bylo by widoczne u kazdego, kto
 * otworzy zadanie.
 *
 *   npx vitest run src/components/kanban/TaskDrawer.test.tsx
 */
const { toast } = vi.hoisted(() => ({
  toast: { success: vi.fn(), error: vi.fn() },
}))
vi.mock('sonner', () => ({ toast }))

import { TaskDrawer } from './TaskDrawer'

const fetchMock = vi.fn()

/** Zadanie w ksztalcie, jaki oddaje ClickUp — pola nieistotne pominiete. */
function zadanie(nadpisz: Partial<ClickUpTask> = {}): ClickUpTask {
  return {
    id: 'zad-1',
    name: 'Poprawic formularz kontaktowy',
    description: '',
    status: { status: 'w trakcie', color: '#3b6fe8', type: 'custom' },
    priority: null,
    tags: [],
    date_created: '1700000000000',
    date_updated: '1700000000000',
    ...nadpisz,
  } as unknown as ClickUpTask
}

/** Odpowiedzi trasy: komentarze i szczegoly zadania rozpoznawane po adresie. */
function odpowiadaj(opts: {
  komentarze?: Array<Record<string, unknown>>
  zalaczniki?: Array<Record<string, unknown>>
  reporter?: Record<string, unknown> | null
} = {}) {
  fetchMock.mockImplementation(async (url: string) => ({
    ok: true,
    json: async () =>
      url.includes('/comments')
        ? { comments: opts.komentarze ?? [] }
        : { attachments: opts.zalaczniki ?? [], reporter: opts.reporter ?? null },
  }))
}

const wlasciwosci = {
  slug: 'wdf',
  onClose: vi.fn(),
}

beforeEach(() => {
  vi.clearAllMocks()
  vi.stubGlobal('fetch', fetchMock)
  odpowiadaj()
  // jsdom nie implementuje przewijania, a szuflada przewija do konca watku.
  Element.prototype.scrollIntoView = vi.fn()
})
afterEach(cleanup)

describe('wczytywanie watku', () => {
  it('REGRESJA: OBA wywolania niosa ?slug, nie tylko jedno', async () => {
    render(<TaskDrawer task={zadanie()} {...wlasciwosci} />)

    await waitFor(() => assert.strictEqual(fetchMock.mock.calls.length, 2))

    const adresy = fetchMock.mock.calls.map(c => c[0] as string)
    // Bez sluga przy komentarzach admin widzial pusty watek obok dzialajacych
    // zalacznikow — i nic nie wskazywalo, ze to blad, a nie brak komentarzy.
    for (const adres of adresy) {
      assert.match(adres, /slug=wdf/, `brak sluga w ${adres}`)
    }
    assert.ok(adresy.some(a => a.includes('/comments')), 'watek komentarzy pobrany')
  })

  it('slug jest kodowany, wiec znaki specjalne nie rozbijaja adresu', async () => {
    render(<TaskDrawer task={zadanie()} {...wlasciwosci} slug="a b&c" />)

    await waitFor(() => assert.ok(fetchMock.mock.calls.length >= 1))
    assert.match(fetchMock.mock.calls[0][0] as string, /slug=a%20b%26c/)
  })

  it('pusty watek mowi „Brak komentarzy", a nie miga w nieskonczonosc', async () => {
    render(<TaskDrawer task={zadanie()} {...wlasciwosci} />)

    assert.ok(await screen.findByText('Brak komentarzy'))
  })

  it('komentarze pokazuja tresc, autora i licznik', async () => {
    odpowiadaj({
      komentarze: [
        { id: 'k1', comment_text: 'Zajmujemy sie tym', sender: 'important.is', date: '1700000000000' },
        { id: 'k2', comment_text: 'Dziekuje', sender: 'Klient', date: '1700000100000' },
      ],
    })
    render(<TaskDrawer task={zadanie()} {...wlasciwosci} />)

    assert.ok(await screen.findByText('Zajmujemy sie tym'))
    assert.ok(screen.getByText('Dziekuje'))
    assert.ok(screen.getByText(/Komentarze \(2\)/))
  })

  it('padniete pobranie NIE zostawia szuflady w stanie ladowania', async () => {
    fetchMock.mockResolvedValue({ ok: false, json: async () => ({}) })
    render(<TaskDrawer task={zadanie()} {...wlasciwosci} />)

    // Wczesniej w innym miejscu tej aplikacji brak obslugi odrzucenia zostawial
    // ekran na „Ladowanie..." NA ZAWSZE. Tutaj musi skonczyc sie komunikatem.
    assert.ok(await screen.findByText('Brak komentarzy'))
  })
})

describe('wysylanie komentarza', () => {
  it('komentarz idzie POST-em ze slugiem i dopisuje sie na KONCU watku', async () => {
    const uzytkownik = userEvent.setup()
    odpowiadaj({
      komentarze: [{ id: 'k1', comment_text: 'Pierwszy', sender: 'Klient', date: '1700000000000' }],
    })
    render(<TaskDrawer task={zadanie()} {...wlasciwosci} />)
    await screen.findByText('Pierwszy')

    fetchMock.mockImplementation(async () => ({
      ok: true,
      json: async () => ({ comment: { id: 'k2', comment_text: 'Nowy', sender: 'Klient', date: '1700000200000' } }),
    }))
    await uzytkownik.type(screen.getByPlaceholderText('Dodaj komentarz...'), 'Nowy')
    await uzytkownik.click(screen.getByRole('button', { name: 'Wyślij komentarz' }))

    await waitFor(() => assert.ok(screen.queryByText('Nowy')))
    const [adres, opcje] = fetchMock.mock.calls[fetchMock.mock.calls.length - 1]
    assert.match(adres as string, /\/comments\?slug=wdf/)
    assert.strictEqual((opcje as RequestInit).method, 'POST')

    // Watek idzie od NAJSTARSZEGO (sortowanie po stronie trasy), wiec swiezy
    // komentarz musi wyladowac pod spodem. Gdyby te dwie rzeczy sie rozjechaly,
    // watek klamalby o kolejnosci rozmowy.
    const teksty = screen.getAllByText(/Pierwszy|Nowy/).map(e => e.textContent)
    assert.deepStrictEqual(teksty, ['Pierwszy', 'Nowy'])
  })

  it('pole czysci sie po wyslaniu', async () => {
    const uzytkownik = userEvent.setup()
    render(<TaskDrawer task={zadanie()} {...wlasciwosci} />)
    await screen.findByText('Brak komentarzy')

    fetchMock.mockImplementation(async () => ({
      ok: true,
      json: async () => ({ comment: { id: 'k1', comment_text: 'Tresc', sender: 'Klient', date: '1' } }),
    }))
    const pole = screen.getByPlaceholderText('Dodaj komentarz...') as HTMLInputElement
    await uzytkownik.type(pole, 'Tresc')
    await uzytkownik.click(screen.getByRole('button', { name: 'Wyślij komentarz' }))

    // Bez tego kolejne klikniecie wyslaloby ten sam komentarz drugi raz.
    await waitFor(() => assert.strictEqual(pole.value, ''))
  })

  it('przycisk wysylki jest WYLACZONY dla pustej tresci i samych spacji', async () => {
    const uzytkownik = userEvent.setup()
    render(<TaskDrawer task={zadanie()} {...wlasciwosci} />)
    await screen.findByText('Brak komentarzy')
    const przycisk = screen.getByRole('button', { name: 'Wyślij komentarz' }) as HTMLButtonElement

    assert.strictEqual(przycisk.disabled, true, 'pusty formularz')

    await uzytkownik.type(screen.getByPlaceholderText('Dodaj komentarz...'), '   ')
    assert.strictEqual(przycisk.disabled, true, 'same spacje to nadal nic')
  })
})

/**
 * OPIS ZADANIA. Tresc pochodzi z ClickUpa, w tym z formularza klienta i z czatu
 * AI, wiec musi byc renderowana jako TEKST, a nie jako znaczniki.
 */
describe('opis zadania', () => {
  const zOpisem = (description: string) => zadanie({ description } as Partial<ClickUpTask>)

  it('naglowki i wypunktowanie sa renderowane', async () => {
    render(<TaskDrawer task={zOpisem('## Cel\n- pierwszy\n- drugi')} {...wlasciwosci} />)

    assert.ok(await screen.findByText('Cel'))
    const punkty = screen.getAllByRole('listitem').map(li => li.textContent)
    assert.deepStrictEqual(punkty, ['pierwszy', 'drugi'])
  })

  it('pogrubienie dziala', async () => {
    render(<TaskDrawer task={zOpisem('To jest **wazne** slowo')} {...wlasciwosci} />)

    const mocne = await screen.findByText('wazne')
    assert.strictEqual(mocne.tagName, 'STRONG')
  })

  it('adresy staja sie linkami otwieranymi BEZPIECZNIE', async () => {
    render(<TaskDrawer task={zOpisem('Zobacz https://example.test/strona')} {...wlasciwosci} />)

    const link = await screen.findByRole('link', { name: 'https://example.test/strona' })
    assert.strictEqual(link.getAttribute('target'), '_blank')
    // Bez `noopener` otwarta strona dostaje uchwyt do naszego okna.
    assert.match(link.getAttribute('rel')!, /noopener/)
  })

  it('ZNACZNIKI w opisie sa tekstem, nie kodem', async () => {
    render(
      <TaskDrawer
        task={zOpisem('<img src=x onerror=alert(1)> i <script>alert(2)</script>')}
        {...wlasciwosci}
      />
    )

    // React escapuje z zasady, ale ten opis przechodzi przez wlasny renderer
    // znacznikow, wiec sprawdzamy to wprost: tresc ma byc widoczna jako tekst,
    // a w drzewie nie moze pojawic sie ani obrazek, ani skrypt.
    assert.ok(await screen.findByText(/<img src=x onerror=alert\(1\)>/))
    assert.strictEqual(document.querySelector('img'), null)
    assert.strictEqual(document.querySelector('script'), null)
  })
})

describe('naglowek zadania', () => {
  it('pokazuje nazwe i status', async () => {
    render(<TaskDrawer task={zadanie()} {...wlasciwosci} />)

    assert.ok(await screen.findAllByText('Poprawic formularz kontaktowy'))
    assert.ok(screen.getByText('w trakcie'))
  })

  it('tag awarii pokazuje sie jako plakietka „Alarm"', async () => {
    render(
      <TaskDrawer
        task={zadanie({ tags: [{ name: 'awaria' }] } as Partial<ClickUpTask>)}
        {...wlasciwosci}
      />
    )

    // Awaria jest TAGIEM, nie priorytetem, wiec stoi obok plakietki priorytetu,
    // a nie zamiast niej — i musi byc widoczna od razu po otwarciu.
    assert.ok(await screen.findByText('Alarm'))
  })

  it('zwykle zadanie NIE ma plakietki alarmu', async () => {
    render(<TaskDrawer task={zadanie()} {...wlasciwosci} />)
    await screen.findByText('Brak komentarzy')

    assert.strictEqual(screen.queryByText('Alarm'), null)
  })

  it('zamkniecie szuflady zglasza sie wyzej', async () => {
    const uzytkownik = userEvent.setup()
    const onClose = vi.fn()
    render(<TaskDrawer task={zadanie()} {...wlasciwosci} onClose={onClose} />)
    await screen.findByText('Brak komentarzy')

    await uzytkownik.keyboard('{Escape}')

    // Escape obsluguje Radix; wlasna wersja tej szuflady tego nie miala.
    await waitFor(() => assert.ok(onClose.mock.calls.length >= 1))
  })
})

describe('zglaszajacy', () => {
  it('zadanie zgloszone przez klienta pokazuje, KTO je zglosil', async () => {
    odpowiadaj({ reporter: { name: 'Anna Klient', email: 'anna@wdf.pl', isAgency: false } })
    render(<TaskDrawer task={zadanie()} {...wlasciwosci} />)

    // Zglaszajacy pochodzi z NASZEJ historii, nie z ClickUpa: tam wszystkie
    // zadania z portalu zaklada jedno konto serwisowe agencji.
    assert.ok(await screen.findByText('Anna Klient'))
  })

  it('zadanie zalozone przez nas nie podpisuje sie nikim z klientow', async () => {
    odpowiadaj({ reporter: { name: null, email: null, isAgency: true } })
    render(<TaskDrawer task={zadanie()} {...wlasciwosci} />)
    await screen.findByText('Brak komentarzy')

    assert.strictEqual(screen.queryByText('Anna Klient'), null)
  })
})
