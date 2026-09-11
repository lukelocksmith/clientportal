// @vitest-environment jsdom
import { describe, it, beforeEach, afterEach, vi } from 'vitest'
import assert from 'node:assert'
import { render, screen, cleanup } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { NewTaskButton } from './NewTaskButton'

/**
 * „Nowe zadanie" z wyborem drogi zgłoszenia.
 *
 * Najważniejsze zachowanie: FORMULARZ jest dostępny ZAWSZE, także w projekcie
 * bez SitePinga. Do 11.09 taki projekt miał wyłącznie asystenta, więc pomyłka
 * albo awaria modelu zostawiała klienta bez drogi zgłoszenia — 4 września
 * asystent napisał klientce Onyxa, że zgłoszenie jest zapisane, i go nie
 * zapisał. Menu z dwiema pozycjami kosztuje jedno kliknięcie więcej i to jest
 * świadoma cena za to, że klient WIE o istnieniu drugiej drogi.
 *
 *   npx vitest run src/components/kanban/NewTaskButton.test.tsx
 */
beforeEach(() => vi.clearAllMocks())
afterEach(cleanup)

const STRONA = 'https://wodadlafirmy.pl'

describe('bez skonfigurowanej strony', () => {
  it('daje asystenta I formularz, bez pozycji o stronie', async () => {
    const uzytkownik = userEvent.setup()
    render(<NewTaskButton siteUrl={null} onOpenAssistant={vi.fn()} onOpenForm={vi.fn()} />)

    await uzytkownik.click(screen.getByRole('button', { name: /Nowe zadanie/ }))

    assert.ok(await screen.findByText('Opisz słowami'))
    assert.ok(screen.getByText('Wypełnij formularz'))
    // SitePing wymaga widgetu na stronie klienta; bez niego ta droga nie
    // istnieje i pokazywanie jej byłoby obietnicą, której klient nie spełni.
    assert.strictEqual(screen.queryByText('Pokaż na stronie'), null)
  })

  it('formularz otwiera sie z menu', async () => {
    const uzytkownik = userEvent.setup()
    const onOpenForm = vi.fn()
    render(<NewTaskButton siteUrl={null} onOpenAssistant={vi.fn()} onOpenForm={onOpenForm} />)
    await uzytkownik.click(screen.getByRole('button', { name: /Nowe zadanie/ }))

    await uzytkownik.click(await screen.findByRole('menuitem', { name: /Wypełnij formularz/ }))

    assert.strictEqual(onOpenForm.mock.calls.length, 1)
  })
})

describe('ze skonfigurowana strona', () => {
  it('klikniecie pokazuje WSZYSTKIE trzy drogi', async () => {
    const uzytkownik = userEvent.setup()
    render(<NewTaskButton siteUrl={STRONA} onOpenAssistant={vi.fn()} onOpenForm={vi.fn()} />)

    await uzytkownik.click(screen.getByRole('button', { name: /Nowe zadanie/ }))

    assert.ok(await screen.findByText('Pokaż na stronie'))
    assert.ok(screen.getByText('Opisz słowami'))
    assert.ok(screen.getByText('Wypełnij formularz'))
  })

  it('kazda droga ma zdanie wyjasniajace, czym sie rozni', async () => {
    const uzytkownik = userEvent.setup()
    render(<NewTaskButton siteUrl={STRONA} onOpenAssistant={vi.fn()} onOpenForm={vi.fn()} />)
    await uzytkownik.click(screen.getByRole('button', { name: /Nowe zadanie/ }))

    // Same nazwy nie mowia klientowi, ktora droge wybrac. Zglasza zadanie
    // rzadko, wiec za kazdym razem jest to dla niego pierwszy raz.
    assert.ok(await screen.findByText(/Zaznacz miejsce/))
    assert.ok(screen.getByText(/Asystent dopyta/))
  })

  it('„Pokaż na stronie" prowadzi na strone klienta, w NOWEJ karcie', async () => {
    const uzytkownik = userEvent.setup()
    render(<NewTaskButton siteUrl={STRONA} onOpenAssistant={vi.fn()} onOpenForm={vi.fn()} />)
    await uzytkownik.click(screen.getByRole('button', { name: /Nowe zadanie/ }))

    const link = await screen.findByRole('menuitem', { name: /Pokaż na stronie/ })
    assert.strictEqual(link.getAttribute('href'), STRONA)
    assert.strictEqual(link.getAttribute('target'), '_blank')
    // Bez `noopener` otwarta strona dostaje uchwyt do okna portalu.
    assert.match(link.getAttribute('rel')!, /noopener/)
  })

  it('„Opisz słowami" otwiera asystenta', async () => {
    const uzytkownik = userEvent.setup()
    const onOpenAssistant = vi.fn()
    render(<NewTaskButton siteUrl={STRONA} onOpenAssistant={onOpenAssistant} onOpenForm={vi.fn()} />)
    await uzytkownik.click(screen.getByRole('button', { name: /Nowe zadanie/ }))

    await uzytkownik.click(await screen.findByRole('menuitem', { name: /Opisz słowami/ }))

    assert.strictEqual(onOpenAssistant.mock.calls.length, 1)
  })

  it('menu da sie obsluzyc z klawiatury', async () => {
    const uzytkownik = userEvent.setup()
    render(<NewTaskButton siteUrl={STRONA} onOpenAssistant={vi.fn()} onOpenForm={vi.fn()} />)

    await uzytkownik.tab()
    await uzytkownik.keyboard('{Enter}')

    // Radix daje strzalki i Escape; wlasne menu z `div` by tego nie mialo.
    assert.ok(await screen.findByRole('menu'))
  })
})
