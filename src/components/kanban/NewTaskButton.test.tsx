// @vitest-environment jsdom
import { describe, it, beforeEach, afterEach, vi } from 'vitest'
import assert from 'node:assert'
import { render, screen, cleanup } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { NewTaskButton } from './NewTaskButton'

/**
 * „Nowe zadanie" z wyborem drogi zgłoszenia.
 *
 * Najważniejsze zachowanie: BEZ skonfigurowanej strony klienta przycisk ma
 * działać dokładnie jak przedtem, czyli otwierać asystenta jednym kliknięciem.
 * Większość projektów nie ma SitePinga, więc to jest ścieżka typowa, a nie
 * awaryjna — gdyby menu pojawiało się zawsze, dorzucilibyśmy wszystkim
 * kliknięcie bez treści.
 *
 *   npx vitest run src/components/kanban/NewTaskButton.test.tsx
 */
beforeEach(() => vi.clearAllMocks())
afterEach(cleanup)

const STRONA = 'https://wodadlafirmy.pl'

describe('bez skonfigurowanej strony', () => {
  it('jedno klikniecie otwiera asystenta, BEZ menu', async () => {
    const uzytkownik = userEvent.setup()
    const onOpenAssistant = vi.fn()
    render(<NewTaskButton siteUrl={null} onOpenAssistant={onOpenAssistant} />)

    await uzytkownik.click(screen.getByRole('button', { name: /Nowe zadanie/ }))

    assert.strictEqual(onOpenAssistant.mock.calls.length, 1)
    assert.strictEqual(screen.queryByText('Pokaż na stronie'), null, 'menu sie nie pojawia')
  })

  it('przycisk NIE udaje rozwijanego menu', async () => {
    render(<NewTaskButton siteUrl={null} onOpenAssistant={vi.fn()} />)

    // Strzalka sugerowalaby wybor, ktorego nie ma.
    const przycisk = screen.getByRole('button', { name: /Nowe zadanie/ })
    assert.strictEqual(przycisk.getAttribute('aria-haspopup'), null)
  })
})

describe('ze skonfigurowana strona', () => {
  it('klikniecie pokazuje OBIE drogi', async () => {
    const uzytkownik = userEvent.setup()
    render(<NewTaskButton siteUrl={STRONA} onOpenAssistant={vi.fn()} />)

    await uzytkownik.click(screen.getByRole('button', { name: /Nowe zadanie/ }))

    assert.ok(await screen.findByText('Pokaż na stronie'))
    assert.ok(screen.getByText('Opisz słowami'))
  })

  it('kazda droga ma zdanie wyjasniajace, czym sie rozni', async () => {
    const uzytkownik = userEvent.setup()
    render(<NewTaskButton siteUrl={STRONA} onOpenAssistant={vi.fn()} />)
    await uzytkownik.click(screen.getByRole('button', { name: /Nowe zadanie/ }))

    // Same nazwy nie mowia klientowi, ktora droge wybrac. Zglasza zadanie
    // rzadko, wiec za kazdym razem jest to dla niego pierwszy raz.
    assert.ok(await screen.findByText(/Zaznacz miejsce/))
    assert.ok(screen.getByText(/Asystent dopyta/))
  })

  it('„Pokaż na stronie" prowadzi na strone klienta, w NOWEJ karcie', async () => {
    const uzytkownik = userEvent.setup()
    render(<NewTaskButton siteUrl={STRONA} onOpenAssistant={vi.fn()} />)
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
    render(<NewTaskButton siteUrl={STRONA} onOpenAssistant={onOpenAssistant} />)
    await uzytkownik.click(screen.getByRole('button', { name: /Nowe zadanie/ }))

    await uzytkownik.click(await screen.findByRole('menuitem', { name: /Opisz słowami/ }))

    assert.strictEqual(onOpenAssistant.mock.calls.length, 1)
  })

  it('menu da sie obsluzyc z klawiatury', async () => {
    const uzytkownik = userEvent.setup()
    render(<NewTaskButton siteUrl={STRONA} onOpenAssistant={vi.fn()} />)

    await uzytkownik.tab()
    await uzytkownik.keyboard('{Enter}')

    // Radix daje strzalki i Escape; wlasne menu z `div` by tego nie mialo.
    assert.ok(await screen.findByRole('menu'))
  })
})
