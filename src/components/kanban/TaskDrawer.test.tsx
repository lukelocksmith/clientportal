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
/** jsdom nie implementuje window.confirm. Domyslnie "tak", pojedyncze testy nadpisuja. */
const confirmMock = vi.fn(() => true)

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
  vi.stubGlobal('confirm', confirmMock)
  odpowiadaj()
  // jsdom nie implementuje przewijania, a szuflada przewija do konca watku.
  Element.prototype.scrollIntoView = vi.fn()
  // jsdom nie implementuje URL.createObjectURL, a podglad zalacznika go wola.
  URL.createObjectURL = vi.fn(() => 'blob:mock-url')
  URL.revokeObjectURL = vi.fn()
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

  it('REGRESJA: pole komentarza to textarea, wiec wklejony tekst wieloliniowy nie gubi Enterow', async () => {
    // Klient zglosil, ze kopiujac tresc z WhatsApp do panelu, wiadomosc wklejala
    // sie jednym ciagiem — bo pole bylo <input type="text">, ktory z definicji
    // nie moze zawierac znaku nowej linii, wiec przegladarka go po prostu usuwa.
    render(<TaskDrawer task={zadanie()} {...wlasciwosci} />)
    await screen.findByText('Brak komentarzy')

    const pole = screen.getByPlaceholderText('Dodaj komentarz...') as HTMLTextAreaElement
    assert.strictEqual(pole.tagName, 'TEXTAREA')
  })

  it('Shift+Enter dodaje nowa linie zamiast wysylac komentarz', async () => {
    const uzytkownik = userEvent.setup()
    render(<TaskDrawer task={zadanie()} {...wlasciwosci} />)
    await screen.findByText('Brak komentarzy')
    const wywolaniaPrzedPisaniem = fetchMock.mock.calls.length

    const pole = screen.getByPlaceholderText('Dodaj komentarz...') as HTMLTextAreaElement
    await uzytkownik.type(pole, 'Linia 1{Shift>}{Enter}{/Shift}Linia 2')

    assert.strictEqual(pole.value, 'Linia 1\nLinia 2')
    // Zaden POST nie poszedl — Shift+Enter nie mial wyslac formularza.
    assert.strictEqual(fetchMock.mock.calls.length, wywolaniaPrzedPisaniem)
  })

  it('sam Enter wysyla komentarz, tak jak wczesniej klikniecie przycisku', async () => {
    const uzytkownik = userEvent.setup()
    render(<TaskDrawer task={zadanie()} {...wlasciwosci} />)
    await screen.findByText('Brak komentarzy')

    fetchMock.mockImplementation(async () => ({
      ok: true,
      json: async () => ({ comment: { id: 'k1', comment_text: 'Tresc', sender: 'Klient', date: '1' } }),
    }))
    const pole = screen.getByPlaceholderText('Dodaj komentarz...')
    await uzytkownik.type(pole, 'Tresc{Enter}')

    await waitFor(() => assert.ok(screen.queryByText('Tresc')))
    const [, opcje] = fetchMock.mock.calls[fetchMock.mock.calls.length - 1]
    assert.strictEqual((opcje as RequestInit).method, 'POST')
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
 * Edycja/usuwanie WLASNEGO komentarza. `isOwn` przychodzi juz gotowe z trasy
 * GET (patrz routes.clickupTasks.test.ts po stronie serwera) — szuflada mu
 * ufa i tylko na jego podstawie pokazuje przyciski. Autoryzacja samej zmiany
 * i tak jest sprawdzana ponownie po stronie API, ale interfejs nie ma prawa
 * kusic klienta przyciskiem, ktory i tak dostanie 403.
 */
describe('edycja i usuwanie wlasnego komentarza', () => {
  it('przyciski edycji/usuwania widoczne TYLKO przy komentarzu z isOwn', async () => {
    odpowiadaj({
      komentarze: [
        { id: 'moj', comment_text: 'Moj komentarz', sender: 'Klient', date: '1', isOwn: true },
        { id: 'cudzy', comment_text: 'Cudzy komentarz', sender: 'important.is', date: '2', isOwn: false },
      ],
    })
    render(<TaskDrawer task={zadanie()} {...wlasciwosci} />)
    await screen.findByText('Moj komentarz')

    assert.strictEqual(screen.getAllByLabelText('Edytuj komentarz').length, 1)
    assert.strictEqual(screen.getAllByLabelText('Usuń komentarz').length, 1)
  })

  it('edycja: PUT niesie slug, zachowuje prefiks, i podmienia tresc lokalnie bez ponownego GET', async () => {
    const uzytkownik = userEvent.setup()
    odpowiadaj({
      komentarze: [{ id: 'k1', comment_text: 'Stara tresc', sender: 'Klient', date: '1', isOwn: true }],
    })
    render(<TaskDrawer task={zadanie()} {...wlasciwosci} />)
    await screen.findByText('Stara tresc')
    const wywolaniaPrzedEdycja = fetchMock.mock.calls.length

    fetchMock.mockImplementation(async () => ({ ok: true, json: async () => ({ ok: true }) }))
    await uzytkownik.click(screen.getByLabelText('Edytuj komentarz'))
    const pole = screen.getByDisplayValue('Stara tresc')
    await uzytkownik.clear(pole)
    await uzytkownik.type(pole, 'Nowa tresc')
    await uzytkownik.click(screen.getByRole('button', { name: 'Zapisz' }))

    await waitFor(() => assert.ok(screen.queryByText('Nowa tresc')))
    assert.strictEqual(screen.queryByText('Stara tresc'), null)
    const [adres, opcje] = fetchMock.mock.calls[wywolaniaPrzedEdycja]
    assert.match(adres as string, /\/comments\/k1\?slug=wdf/)
    assert.strictEqual((opcje as RequestInit).method, 'PUT')
  })

  it('anulowanie edycji przywraca widok bez wysylania niczego', async () => {
    const uzytkownik = userEvent.setup()
    odpowiadaj({
      komentarze: [{ id: 'k1', comment_text: 'Stara tresc', sender: 'Klient', date: '1', isOwn: true }],
    })
    render(<TaskDrawer task={zadanie()} {...wlasciwosci} />)
    await screen.findByText('Stara tresc')
    const wywolaniaPrzedEdycja = fetchMock.mock.calls.length

    await uzytkownik.click(screen.getByLabelText('Edytuj komentarz'))
    await uzytkownik.type(screen.getByDisplayValue('Stara tresc'), ' dopisek')
    await uzytkownik.click(screen.getByRole('button', { name: 'Anuluj' }))

    assert.ok(screen.getByText('Stara tresc'), 'wraca oryginalna tresc, dopisek nie zostaje')
    assert.strictEqual(fetchMock.mock.calls.length, wywolaniaPrzedEdycja, 'anulowanie nie odpytuje API')
  })

  it('usuwanie: pyta o potwierdzenie, po "tak" wysyla DELETE i zdejmuje komentarz z listy', async () => {
    const uzytkownik = userEvent.setup()
    confirmMock.mockReturnValueOnce(true)
    odpowiadaj({
      komentarze: [{ id: 'k1', comment_text: 'Do usuniecia', sender: 'Klient', date: '1', isOwn: true }],
    })
    render(<TaskDrawer task={zadanie()} {...wlasciwosci} />)
    await screen.findByText('Do usuniecia')

    fetchMock.mockImplementation(async () => ({ ok: true, json: async () => ({ ok: true }) }))
    await uzytkownik.click(screen.getByLabelText('Usuń komentarz'))

    await screen.findByText('Brak komentarzy')
    assert.ok(confirmMock.mock.calls.length >= 1)
    const [adres, opcje] = fetchMock.mock.calls[fetchMock.mock.calls.length - 1]
    assert.match(adres as string, /\/comments\/k1\?slug=wdf/)
    assert.strictEqual((opcje as RequestInit).method, 'DELETE')
  })

  it('usuwanie: odmowa w potwierdzeniu NIE wysyla DELETE i zostawia komentarz', async () => {
    const uzytkownik = userEvent.setup()
    confirmMock.mockReturnValueOnce(false)
    odpowiadaj({
      komentarze: [{ id: 'k1', comment_text: 'Zostaje', sender: 'Klient', date: '1', isOwn: true }],
    })
    render(<TaskDrawer task={zadanie()} {...wlasciwosci} />)
    await screen.findByText('Zostaje')
    const wywolaniaPrzedUsuwaniem = fetchMock.mock.calls.length

    await uzytkownik.click(screen.getByLabelText('Usuń komentarz'))

    assert.ok(screen.getByText('Zostaje'), 'komentarz zostaje, bo potwierdzenie odrzucone')
    assert.strictEqual(fetchMock.mock.calls.length, wywolaniaPrzedUsuwaniem)
  })
})

/**
 * Zalaczanie obrazu do komentarza. ClickUp nie ma "zalacznika do komentarza",
 * wiec obraz idzie NAJPIERW na trase zalacznikow zadania (ten sam mechanizm
 * co zrzuty w AI Czacie), a dopiero jego URL trafia do tresci komentarza.
 * Dwa zapytania, jedna akcja uzytkownika — testy pilnuja kolejnosci i tego,
 * ze sam obraz (bez wpisanego tekstu) tez da sie wyslac.
 */
describe('zalaczanie obrazu do komentarza', () => {
  function wybierzObraz(): File {
    return new File(['dane obrazu'], 'zrzut.png', { type: 'image/png' })
  }

  it('wybranie obrazu odblokowuje wysylke, nawet bez wpisanego tekstu', async () => {
    const uzytkownik = userEvent.setup()
    render(<TaskDrawer task={zadanie()} {...wlasciwosci} />)
    await screen.findByText('Brak komentarzy')
    const przycisk = screen.getByRole('button', { name: 'Wyślij komentarz' }) as HTMLButtonElement
    assert.strictEqual(przycisk.disabled, true, 'pusty formularz, bez obrazu i tekstu')

    const wejscie = document.querySelector('input[type="file"]') as HTMLInputElement
    await uzytkownik.upload(wejscie, wybierzObraz())

    assert.strictEqual(przycisk.disabled, false, 'sam obraz wystarczy do wyslania')
  })

  it('wysylka: obraz idzie NAJPIERW na /attachments, jego URL dopisuje sie do tresci komentarza', async () => {
    const uzytkownik = userEvent.setup()
    render(<TaskDrawer task={zadanie()} {...wlasciwosci} />)
    await screen.findByText('Brak komentarzy')
    const wywolaniaPrzedWyslaniem = fetchMock.mock.calls.length

    fetchMock.mockImplementation(async (url: string) =>
      url.includes('/attachments')
        ? { ok: true, json: async () => ({ attachments: [{ name: 'zrzut.png', ok: true, url: 'https://cu.test/zrzut.png' }] }) }
        : { ok: true, json: async () => ({ comment: { id: 'k1', comment_text: 'Patrz obrazek\nhttps://cu.test/zrzut.png', sender: 'Klient', date: '1' } }) }
    )

    const wejscie = document.querySelector('input[type="file"]') as HTMLInputElement
    await uzytkownik.upload(wejscie, wybierzObraz())
    await uzytkownik.type(screen.getByPlaceholderText('Dodaj komentarz...'), 'Patrz obrazek')
    await uzytkownik.click(screen.getByRole('button', { name: 'Wyślij komentarz' }))

    await waitFor(() => assert.ok(fetchMock.mock.calls.length >= wywolaniaPrzedWyslaniem + 2))
    const wywolania = fetchMock.mock.calls.slice(wywolaniaPrzedWyslaniem)
    const [adresZalacznika, opcjeZalacznika] = wywolania[0]
    const [adresKomentarza, opcjeKomentarza] = wywolania[1]

    assert.match(adresZalacznika as string, /\/attachments\?slug=wdf/)
    assert.strictEqual((opcjeZalacznika as RequestInit).method, 'POST')
    assert.ok((opcjeZalacznika as RequestInit).body instanceof FormData, 'plik leci jako FormData, nie JSON')

    assert.match(adresKomentarza as string, /\/comments\?slug=wdf/)
    const tresc = JSON.parse((opcjeKomentarza as RequestInit).body as string).text as string
    assert.ok(tresc.includes('https://cu.test/zrzut.png'), 'URL zalacznika dopisany do tresci')
    assert.ok(tresc.includes('Patrz obrazek'))
  })

  it('link do zalacznika w juz wyslanym komentarzu jest klikalny, nie plaskim tekstem', async () => {
    odpowiadaj({
      komentarze: [
        { id: 'k1', comment_text: 'Zobacz\nhttps://cu.test/zrzut.png', sender: 'Klient', date: '1' },
      ],
    })
    render(<TaskDrawer task={zadanie()} {...wlasciwosci} />)

    const link = await screen.findByRole('link', { name: 'https://cu.test/zrzut.png' })
    assert.strictEqual(link.getAttribute('href'), 'https://cu.test/zrzut.png')
  })

  it('usuniecie obrazu z podgladu PRZED wyslaniem nie idzie na /attachments', async () => {
    const uzytkownik = userEvent.setup()
    render(<TaskDrawer task={zadanie()} {...wlasciwosci} />)
    await screen.findByText('Brak komentarzy')

    const wejscie = document.querySelector('input[type="file"]') as HTMLInputElement
    await uzytkownik.upload(wejscie, wybierzObraz())
    await uzytkownik.click(screen.getByLabelText('Usuń obraz'))

    const przycisk = screen.getByRole('button', { name: 'Wyślij komentarz' }) as HTMLButtonElement
    assert.strictEqual(przycisk.disabled, true, 'obraz zdjety z podgladu, formularz znowu pusty')
  })

  it('padniety upload zalacznika NIE wysyla pustego komentarza', async () => {
    const uzytkownik = userEvent.setup()
    render(<TaskDrawer task={zadanie()} {...wlasciwosci} />)
    await screen.findByText('Brak komentarzy')

    fetchMock.mockImplementation(async (url: string) =>
      url.includes('/attachments')
        ? { ok: false, json: async () => ({}) }
        : { ok: true, json: async () => ({ comment: { id: 'nie-powinno-powstac' } }) }
    )

    const wejscie = document.querySelector('input[type="file"]') as HTMLInputElement
    await uzytkownik.upload(wejscie, wybierzObraz())
    await uzytkownik.click(screen.getByRole('button', { name: 'Wyślij komentarz' }))

    await waitFor(() => assert.ok(toast.error.mock.calls.length >= 1))
    // Wyklucza GET z wczytania watku przy montowaniu — liczy sie tylko POST.
    assert.ok(
      !fetchMock.mock.calls.some(
        c => (c[0] as string).includes('/comments?') && (c[1] as RequestInit)?.method === 'POST'
      ),
      'bez tresci i bez udanego zalacznika nie ma czego wysylac na trase komentarzy'
    )
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

describe('dropdown statusu (statusControlsEnabled)', () => {
  it('flaga WYLACZONA (domyslnie) -> plakietka statusu, BEZ dropdownu', async () => {
    render(<TaskDrawer task={zadanie()} {...wlasciwosci} />)
    await screen.findByText('Brak komentarzy')

    const status = screen.getByText('w trakcie')
    assert.notStrictEqual(status.tagName, 'BUTTON', 'bez flagi to nadal plakietka, nie przycisk')
  })

  it('flaga WLACZONA -> status jest przyciskiem z rozwijanym menu', async () => {
    render(<TaskDrawer task={zadanie()} {...wlasciwosci} statusControlsEnabled />)
    await screen.findByText('Brak komentarzy')

    const przycisk = screen.getByRole('button', { name: /w trakcie/ })
    assert.ok(przycisk)
  })

  it('wybor NOWEGO statusu wysyla PATCH i zglasza sie do onTaskUpdated', async () => {
    const uzytkownik = userEvent.setup()
    const onTaskUpdated = vi.fn()
    render(<TaskDrawer task={zadanie()} {...wlasciwosci} statusControlsEnabled onTaskUpdated={onTaskUpdated} />)
    await screen.findByText('Brak komentarzy')

    fetchMock.mockImplementation(async (url: string, opcje: RequestInit) => ({
      ok: true,
      json: async () =>
        (opcje as RequestInit).method === 'PATCH'
          ? { task: { ...zadanie(), status: { status: 'zamknięte', color: '#008844', type: 'closed' } } }
          : { attachments: [], reporter: null },
    }))

    await uzytkownik.click(screen.getByRole('button', { name: /w trakcie/ }))
    await uzytkownik.click(await screen.findByRole('menuitem', { name: /zamknięte/ }))

    const wywolaniePatch = fetchMock.mock.calls.find(c => (c[1] as RequestInit)?.method === 'PATCH')
    assert.ok(wywolaniePatch, 'PATCH zostal wyslany')
    assert.match(wywolaniePatch![0] as string, /\/api\/clickup\/tasks\/zad-1\?slug=wdf/)
    assert.deepStrictEqual(JSON.parse((wywolaniePatch![1] as RequestInit).body as string), { status: 'zamknięte' })

    await waitFor(() => assert.strictEqual(onTaskUpdated.mock.calls.length, 1))
    assert.strictEqual(onTaskUpdated.mock.calls[0][0].status.status, 'zamknięte')
  })

  it('wybor TEGO SAMEGO statusu nie wysyla PATCH', async () => {
    const uzytkownik = userEvent.setup()
    render(<TaskDrawer task={zadanie()} {...wlasciwosci} statusControlsEnabled />)
    await screen.findByText('Brak komentarzy')
    fetchMock.mockClear()

    await uzytkownik.click(screen.getByRole('button', { name: /w trakcie/ }))
    const pozycjaAktualna = await screen.findByRole('menuitem', { name: /^w trakcie$/ })
    assert.strictEqual(pozycjaAktualna.getAttribute('aria-disabled'), 'true')
  })

  it('blad PATCH pokazuje toast i NIE zglasza sie do onTaskUpdated', async () => {
    const uzytkownik = userEvent.setup()
    const onTaskUpdated = vi.fn()
    render(<TaskDrawer task={zadanie()} {...wlasciwosci} statusControlsEnabled onTaskUpdated={onTaskUpdated} />)
    await screen.findByText('Brak komentarzy')

    fetchMock.mockImplementation(async (url: string, opcje: RequestInit) => ({
      ok: (opcje as RequestInit)?.method !== 'PATCH',
      json: async () => ({ attachments: [], reporter: null }),
    }))

    await uzytkownik.click(screen.getByRole('button', { name: /w trakcie/ }))
    await uzytkownik.click(await screen.findByRole('menuitem', { name: /zamknięte/ }))

    await waitFor(() => assert.strictEqual(toast.error.mock.calls.length, 1))
    assert.strictEqual(onTaskUpdated.mock.calls.length, 0)
  })
})
