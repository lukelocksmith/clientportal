// @vitest-environment jsdom
import { describe, it, afterEach, vi } from 'vitest'
import assert from 'node:assert'
import { render, screen, cleanup } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { NotificationMatrix } from './NotificationMatrix'

/**
 * Macierz powiadomien w ustawieniach projektu: zdarzenie x kanal.
 *
 * Najwazniejszy test tego pliku to ten o SMS-ie. Kolumna jest w panelu, bo
 * Lukasz chce ja tam widziec, ale producent SMS-a nie obsluguje (klient portalu
 * nie ma nawet numeru telefonu w bazie). Kratka, ktora daje sie zaznaczyc i nic
 * nie robi, jest gorsza niz kratka wyraznie wylaczona: admin zaznaczylby ja,
 * powiedzial klientowi „bedziesz dostawal SMS-y" i nikt by sie nie dowiedzial,
 * ze nie dostaje.
 *
 *   npx vitest run src/components/admin/NotificationMatrix.test.tsx
 */
afterEach(cleanup)

describe('co widac', () => {
  it('kazde zdarzenie ma swoj wiersz, opisany po polsku', () => {
    render(<NotificationMatrix config={{}} onChange={vi.fn()} />)

    for (const opis of [
      /Zespół odpowiedział/,
      /Nowe zadanie/,
      /zmieniło status/,
      /zostało zamknięte/,
    ]) {
      assert.ok(screen.getByText(opis), `brak wiersza: ${opis}`)
    }
  })

  it('zaznaczone kratki odpowiadaja konfiguracji', () => {
    render(
      <NotificationMatrix
        config={{ comment: { bell: true, mail: true }, status: { bell: true } }}
        onChange={vi.fn()}
      />
    )

    assert.strictEqual(kratka('Zespół odpowiedział', 'Powiadomienie').checked, true)
    assert.strictEqual(kratka('Zespół odpowiedział', 'E-mail').checked, true)
    assert.strictEqual(kratka('zmieniło status', 'Powiadomienie').checked, true)
    assert.strictEqual(kratka('zmieniło status', 'E-mail').checked, false)
    assert.strictEqual(kratka('zostało zamknięte', 'Powiadomienie').checked, false)
  })
})

describe('SMS', () => {
  it('kolumna SMS jest widoczna, ale KAZDA jej kratka jest nieaktywna', () => {
    render(<NotificationMatrix config={{}} onChange={vi.fn()} />)

    // SMS wystepuje dwa razy: w naglowku kolumny i w wyjasnieniu pod tabela.
    assert.ok(screen.getAllByText(/SMS/).length >= 1, 'brak kolumny SMS')
    const smsy = screen.getAllByRole('checkbox', { name: /SMS/ })
    assert.strictEqual(smsy.length, 4, 'SMS w kazdym wierszu')
    for (const s of smsy) {
      assert.strictEqual((s as HTMLInputElement).disabled, true, 'kratka SMS da sie kliknac')
    }
  })

  it('powod nieaktywnosci jest napisany, nie do domyslenia', () => {
    render(<NotificationMatrix config={{}} onChange={vi.fn()} />)

    assert.ok(screen.getByText(/telefonu/i), 'brak wyjasnienia, czemu SMS nie dziala')
  })
})

describe('zmiana ustawien', () => {
  it('zaznaczenie DOKLADA kanal, nie zamienia calej macierzy', async () => {
    const onChange = vi.fn()
    const uzytkownik = userEvent.setup()
    render(<NotificationMatrix config={{ comment: { mail: true } }} onChange={onChange} />)

    await uzytkownik.click(kratka('Zespół odpowiedział', 'Powiadomienie'))

    assert.deepStrictEqual(onChange.mock.calls[0][0], { comment: { mail: true, bell: true } })
  })

  it('odznaczenie usuwa kanal, a zdarzenie bez kanalow wypada z macierzy', async () => {
    const onChange = vi.fn()
    const uzytkownik = userEvent.setup()
    render(<NotificationMatrix config={{ comment: { mail: true } }} onChange={onChange} />)

    await uzytkownik.click(kratka('Zespół odpowiedział', 'E-mail'))

    assert.deepStrictEqual(onChange.mock.calls[0][0], {})
  })

  it('zmiana jednego zdarzenia nie rusza pozostalych', async () => {
    const onChange = vi.fn()
    const uzytkownik = userEvent.setup()
    render(
      <NotificationMatrix
        config={{ comment: { bell: true }, closed: { mail: true } }}
        onChange={onChange}
      />
    )

    await uzytkownik.click(kratka('zmieniło status', 'Powiadomienie'))

    assert.deepStrictEqual(onChange.mock.calls[0][0], {
      comment: { bell: true },
      closed: { mail: true },
      status: { bell: true },
    })
  })
})

/** Kratka w wierszu opisanym `wiersz`, w kolumnie `kanal`. */
function kratka(wiersz: string | RegExp, kanal: string): HTMLInputElement {
  const wzor = typeof wiersz === 'string' ? wiersz : wiersz.source
  const el = screen.getByRole('checkbox', { name: new RegExp(`${kanal}.*${wzor}|${wzor}.*${kanal}`, 'i') })
  return el as HTMLInputElement
}
