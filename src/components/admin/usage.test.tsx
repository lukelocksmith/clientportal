// @vitest-environment jsdom
import { describe, it, afterEach } from 'vitest'
import assert from 'node:assert'
import { render, screen, cleanup, within } from '@testing-library/react'
import { Breakdown, BreakdownRow, Metric, fmtDate, fmtNum, fmtUsd } from './usage'

/**
 * Cegielki widokow zuzycia AI.
 *
 * PIERWSZY test komponentu w tym repo. Do tej pory zmiana w dowolnym pliku .tsx
 * byla sprawdzana wylacznie przez `tsc` i `next build`, czyli nikt nie
 * sprawdzal, czy cokolwiek sie rysuje.
 *
 * Ten modul powstal, bo `AdminPanel` i `ProjectAiStats` mialy dwie niezalezne
 * kopie tego samego widoku i zdazyly sie rozjechac: kopia w panelu rysowala
 * tabele BEZ naglowkow, wiec czytnik ekranu podawal same liczby bez informacji,
 * czym sa. Wygladaly identycznie, wiec nikt tego nie zauwazyl. Test naglowka
 * jest tu wiec pilnowaniem konkretnej, popelnionej juz pomylki, a nie
 * teoretyczna dbaloscia o dostepnosc.
 *
 *   npx vitest run src/components/admin/usage.test.tsx
 */
afterEach(cleanup)

describe('formatowanie liczb', () => {
  it('tokeny sa zaokraglane i grupowane po polsku', () => {
    // Spacja niełamiąca, nie zwykla — tak formatuje `toLocaleString('pl-PL')`.
    assert.strictEqual(fmtNum(1234567.8), '1 234 568')
  })

  it('koszt PONIZEJ dolara ma cztery miejsca, powyzej dwa', () => {
    // Zuzycie jednej rozmowy to czesto ulamek centa. Dwa miejsca pokazywalyby
    // wszedzie "$0.00", czyli liczbe bez zadnej informacji.
    assert.strictEqual(fmtUsd(0.0034), '$0.0034')
    assert.strictEqual(fmtUsd(12.5), '$12.50')
  })

  it('zero kosztu jest widoczne jako zero, nie jako pusto', () => {
    assert.strictEqual(fmtUsd(0), '$0.0000')
    assert.strictEqual(fmtNum(0), '0')
  })

  it('brak daty to myslnik, nie „Invalid Date"', () => {
    assert.strictEqual(fmtDate(null), '—')
    assert.strictEqual(fmtDate('to nie jest data'), '—')
  })

  it('poprawna data jest formatowana po polsku', () => {
    const wynik = fmtDate('2026-08-07T09:30:00.000Z')
    assert.match(wynik, /07\.08\.2026/)
  })
})

describe('Metric', () => {
  it('pokazuje etykiete i wartosc', () => {
    render(<Metric label="Zapytania" value="1 234" />)

    assert.ok(screen.getByText('Zapytania'))
    assert.ok(screen.getByText('1 234'))
  })
})

describe('Breakdown', () => {
  it('pusta lista pokazuje „Brak danych" ZAMIAST pustej tabeli', () => {
    render(<Breakdown title="Wg projektu">{[]}</Breakdown>)

    // Pusta tabela z samym naglowkiem wyglada jak bledne wczytanie danych.
    assert.ok(screen.getByText('Brak danych'))
    assert.strictEqual(screen.queryByRole('table'), null)
  })

  it('tabela ma NAGLOWKI KOLUMN, mimo ze sa ukryte wzrokowo', () => {
    render(
      <Breakdown title="Wg projektu">
        <BreakdownRow label="Onyx" totalTokens={1000} costUsd={0.5} />
      </Breakdown>
    )

    // TO JEST TEN ROZJAZD. Kopia w AdminPanel rysowala surowe <table> bez
    // naglowkow, wiec czytnik ekranu podawal "Onyx, 1 000 tok, $0.5000" i nic
    // wiecej. Naglowki sa `sr-only`: wzrokowo zbedne, bo kolumny sa oczywiste.
    const naglowki = screen.getAllByRole('columnheader').map(h => h.textContent)
    assert.deepStrictEqual(naglowki, ['Pozycja', 'Tokeny', 'Koszt'])
  })

  it('tytul rozbicia jest widoczny', () => {
    render(
      <Breakdown title="Wg uzytkownika">
        <BreakdownRow label="a@b.c" totalTokens={1} costUsd={1} />
      </Breakdown>
    )

    assert.ok(screen.getByText('Wg uzytkownika'))
  })
})

describe('BreakdownRow', () => {
  it('pokazuje etykiete, tokeny i koszt w jednym wierszu', () => {
    render(
      <Breakdown title="x">
        <BreakdownRow label="Onyx" totalTokens={1500} costUsd={0.0025} />
      </Breakdown>
    )

    const wiersz = screen.getByRole('row', { name: /Onyx/ })
    // Porownujemy z `fmtNum`, a nie z napisem wpisanym z reki: `toLocaleString`
    // wstawia spacje NIELAMIACA (U+00A0), wiec "1 500" ze zwykla spacja nigdy
    // by nie pasowalo, a test wygladalby na wykrycie bledu formatowania.
    assert.ok(within(wiersz).getByText(`${fmtNum(1500)} tok`))
    assert.ok(within(wiersz).getByText('$0.0025'))
  })

  it('dluga etykieta dostaje pelna tresc w tytule, bo w tabeli jest ucinana', () => {
    const dlugi = 'bardzo-dlugi-adres-uzytkownika@nazwa-firmy-klienta.example.com'
    render(
      <Breakdown title="x">
        <BreakdownRow label={dlugi} totalTokens={1} costUsd={1} />
      </Breakdown>
    )

    // Komorka ma `truncate`, wiec bez atrybutu `title` pelnej wartosci nie da
    // sie odczytac w ogole.
    assert.strictEqual(screen.getByText(dlugi).getAttribute('title'), dlugi)
  })

  it('gdy podano osobny tytul, w komorce zostaje krotka etykieta', () => {
    render(
      <Breakdown title="x">
        <BreakdownRow label="gemini-2.5-flash" title="google/gemini-2.5-flash" totalTokens={1} costUsd={1} />
      </Breakdown>
    )

    // Widok pokazuje sam model, a pelne „dostawca/model" jest pod kursorem.
    const komorka = screen.getByText('gemini-2.5-flash')
    assert.strictEqual(komorka.getAttribute('title'), 'google/gemini-2.5-flash')
  })
})
