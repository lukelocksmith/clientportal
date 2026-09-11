import { describe, it, expect } from 'vitest'
import {
  asystentObiecalBezZapisu,
  bylowywolanieNarzedzia,
  trescDoFormularza,
  type WiadomoscCzatu,
} from './chatFallback'

const tekst = (role: string, text: string): WiadomoscCzatu => ({ role, parts: [{ type: 'text', text }] })
const zNarzedziem = (taskId: string | null): WiadomoscCzatu => ({
  role: 'assistant',
  parts: [{ type: 'text', text: 'Dodaję zadanie.' }, { type: 'tool-createTask', output: { taskId } }],
})

/**
 * Rozpoznanie, że asystent zawiódł, w przeglądarce klienta.
 *
 * Przypadek wzorcowy jest prawdziwy: 4 września klientka Onyxa dostała
 * „Gotowe! Zadanie »…« zostało zgłoszone jako P3" i żadnego zadania.
 */
describe('asystentObiecalBezZapisu', () => {
  const rozmowaZOnyxa: WiadomoscCzatu[] = [
    tekst('user', 'kompresowanie wideo na stronie'),
    tekst('user', 'zgłoś to jako zadanie'),
    tekst('user', 'tak'),
    tekst('assistant', 'Gotowe! Zadanie "Optymalizacja wideo" zostało zgłoszone jako P3. Za chwilę pojawi się na tablicy.'),
  ]

  it('łapie obietnicę bez wywołania narzędzia', () => {
    expect(asystentObiecalBezZapisu(rozmowaZOnyxa, false)).toBe(true)
  })

  it('NIE odzywa się, gdy zadanie naprawdę powstało', () => {
    // Para dowodząca: bez tego ostrzeżenie wyskakiwałoby przy każdym udanym
    // zgłoszeniu, bo udane też kończy się zdaniem „zadanie zostało dodane".
    expect(asystentObiecalBezZapisu([...rozmowaZOnyxa, zNarzedziem('869x')], false)).toBe(false)
  })

  it('NIE odzywa się w trakcie odpowiedzi', () => {
    // W trakcie strumienia „zgłaszam" bywa początkiem tury, po którym
    // narzędzie dopiero leci.
    expect(asystentObiecalBezZapisu(rozmowaZOnyxa, true)).toBe(false)
  })

  it('NIE odzywa się przy zwykłym dopytywaniu', () => {
    expect(asystentObiecalBezZapisu([tekst('user', 'cześć'), tekst('assistant', 'Na jakiej stronie to widzisz?')], false)).toBe(false)
  })

  it('łapie obietnicę napisaną bez polskich znaków', () => {
    expect(
      asystentObiecalBezZapisu([tekst('user', 'x'), tekst('assistant', 'Zadanie zostalo zgloszone jako P3.')], false)
    ).toBe(true)
  })
})

describe('bylowywolanieNarzedzia', () => {
  it('liczy się każde wywołanie, także nieudane', () => {
    // Nieudane znaczy, że sprawa poszła do kolejki po stronie serwera. Klient
    // nie ma wtedy czego przepisywać do formularza.
    expect(bylowywolanieNarzedzia([zNarzedziem(null)])).toBe(true)
  })

  it('sama rozmowa to nie wywołanie', () => {
    expect(bylowywolanieNarzedzia([tekst('assistant', 'Zgłaszam.')])).toBe(false)
  })
})

describe('trescDoFormularza', () => {
  const rozmowa: WiadomoscCzatu[] = [
    tekst('assistant', 'Cześć! Opisz, co chcesz zlecić.'),
    tekst('user', 'Baner na stronie głównej do podmiany. Mamy gotową grafikę.'),
    tekst('assistant', 'Na jakiej stronie?'),
    tekst('user', 'important.is, sekcja na górze'),
  ]

  it('nazwa to pierwsze zdanie klienta', () => {
    expect(trescDoFormularza(rozmowa).nazwa).toBe('Baner na stronie głównej do podmiany')
  })

  it('opis niesie WSZYSTKIE wypowiedzi klienta', () => {
    const { opis } = trescDoFormularza(rozmowa)
    expect(opis).toContain('gotową grafikę')
    expect(opis).toContain('sekcja na górze')
  })

  it('nie przepisuje słów asystenta', () => {
    // To jego podpowiedzi zawiodły; klient ma w formularzu zobaczyć swoje.
    expect(trescDoFormularza(rozmowa).opis).not.toContain('Na jakiej stronie?')
  })

  it('pusta rozmowa daje puste pola, bez wyjątku', () => {
    expect(trescDoFormularza([])).toEqual({ nazwa: '', opis: '' })
  })
})
