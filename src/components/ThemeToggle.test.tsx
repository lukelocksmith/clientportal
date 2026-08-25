// @vitest-environment jsdom
import { describe, it, beforeEach, afterEach } from 'vitest'
import assert from 'node:assert'
import { render, screen, cleanup, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { ThemeToggle } from './ThemeToggle'
import { KLASA_CIEMNA, MOTYW_KEY } from '@/lib/theme'

/**
 * Przelacznik motywu.
 *
 * Sedno tego pliku: przycisk musi POKAZYWAC stan, ktory faktycznie ma dokument,
 * a nie ten, ktory sobie zalozyl. Motyw naklada skrypt z layoutu jeszcze przed
 * pierwszym malowaniem, wiec komponent montuje sie na stronie, ktora JUZ jest
 * ciemna albo jasna. Gdyby zakladal „na starcie jasny", uzytkownik ciemnego
 * motywu zobaczylby ikone proponujaca wlaczenie ciemnego, ktory juz ma.
 *
 *   npx vitest run src/components/ThemeToggle.test.tsx
 */
function podstawMagazyn() {
  const dane = new Map<string, string>()
  Object.defineProperty(window, 'localStorage', {
    configurable: true,
    value: {
      getItem: (k: string) => (dane.has(k) ? dane.get(k)! : null),
      setItem: (k: string, v: string) => { dane.set(k, String(v)) },
      removeItem: (k: string) => { dane.delete(k) },
      clear: () => { dane.clear() },
    },
  })
}

beforeEach(() => {
  podstawMagazyn()
  document.documentElement.classList.remove(KLASA_CIEMNA)
})
afterEach(cleanup)

describe('co pokazuje przycisk', () => {
  it('na stronie JASNEJ proponuje wlaczenie ciemnego', async () => {
    render(<ThemeToggle />)
    await waitFor(() => assert.ok(screen.getByRole('button', { name: /ciemny/i })))
  })

  it('na stronie CIEMNEJ proponuje wlaczenie jasnego', async () => {
    // Tak wyglada dokument po skrypcie z layoutu u kogos z ciemnym systemem.
    document.documentElement.classList.add(KLASA_CIEMNA)

    render(<ThemeToggle />)

    await waitFor(() => assert.ok(screen.getByRole('button', { name: /jasny/i })))
  })
})

describe('przelaczanie', () => {
  it('klikniecie na jasnej stronie wlacza ciemna i zapisuje wybor', async () => {
    const uzytkownik = userEvent.setup()
    render(<ThemeToggle />)
    await waitFor(() => screen.getByRole('button', { name: /ciemny/i }))

    await uzytkownik.click(screen.getByRole('button'))

    assert.strictEqual(document.documentElement.classList.contains(KLASA_CIEMNA), true)
    assert.strictEqual(localStorage.getItem(MOTYW_KEY), 'dark')
  })

  it('klikniecie na ciemnej stronie wraca do jasnej', async () => {
    document.documentElement.classList.add(KLASA_CIEMNA)
    const uzytkownik = userEvent.setup()
    render(<ThemeToggle />)
    await waitFor(() => screen.getByRole('button', { name: /jasny/i }))

    await uzytkownik.click(screen.getByRole('button'))

    assert.strictEqual(document.documentElement.classList.contains(KLASA_CIEMNA), false)
    assert.strictEqual(localStorage.getItem(MOTYW_KEY), 'light')
  })

  it('dwa klikniecia wracaja do punktu wyjscia', async () => {
    const uzytkownik = userEvent.setup()
    render(<ThemeToggle />)
    await waitFor(() => screen.getByRole('button', { name: /ciemny/i }))

    await uzytkownik.click(screen.getByRole('button'))
    await uzytkownik.click(screen.getByRole('button'))

    assert.strictEqual(document.documentElement.classList.contains(KLASA_CIEMNA), false)
    assert.strictEqual(localStorage.getItem(MOTYW_KEY), 'light')
  })

  it('etykieta zmienia sie po klknieciu, wiec czytnik ekranu wie, co dalej', async () => {
    const uzytkownik = userEvent.setup()
    render(<ThemeToggle />)
    await waitFor(() => screen.getByRole('button', { name: /ciemny/i }))

    await uzytkownik.click(screen.getByRole('button'))

    await waitFor(() => assert.ok(screen.getByRole('button', { name: /jasny/i })))
  })
})

describe('odpornosc', () => {
  it('niedostepny localStorage nie psuje przelaczania na tej karcie', async () => {
    // Tryb prywatny: zapis rzuca. Motyw ma sie przelaczyc mimo to, bo brak
    // zapamietania jest duzo mniejsza szkoda niz przycisk, ktory nie dziala.
    Object.defineProperty(window, 'localStorage', {
      configurable: true,
      value: {
        getItem: () => null,
        setItem: () => { throw new Error('QuotaExceeded') },
      },
    })
    const uzytkownik = userEvent.setup()
    render(<ThemeToggle />)
    await waitFor(() => screen.getByRole('button'))

    await uzytkownik.click(screen.getByRole('button'))

    assert.strictEqual(document.documentElement.classList.contains(KLASA_CIEMNA), true)
  })
})
