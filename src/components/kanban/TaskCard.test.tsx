// @vitest-environment jsdom
/**
 * Wiersz metadanych na karcie kanbana: co karta pokazuje i czym to maluje.
 *
 * Test powstal razem z przebudowa ukladu z 28.08 (jeden wiersz plakietek,
 * Heroicons, daty jako start i termin, Track Time bez czerwieni). Pilnuje
 * rzeczy, ktore latwo cofnac przypadkiem przy nastepnym dotknieciu CSS-a.
 *
 *   npx vitest run src/components/kanban/TaskCard.test.tsx
 */
import { describe, it, afterEach, vi } from 'vitest'
import assert from 'node:assert'
import { render, screen, cleanup } from '@testing-library/react'
import type { ClickUpTask } from '@/lib/types'
import { TaskCard } from './TaskCard'

afterEach(cleanup)

const ms = (iso: string) => String(new Date(iso).getTime())

/**
 * Daty liczone WZGLEDEM DZIS, nie wpisane na sztywno.
 *
 * Pierwsza wersja testu miala tu 26 i 28 sierpnia, wiec 30 sierpnia zaczela
 * padac sama z siebie: termin minal, plakietka zmienila tytul na „Termin
 * minal" i test szukal czegos, czego juz nie ma. Test daty musi sam ustawiac
 * sie w czasie, inaczej jest bomba zegarowa, a nie asercja.
 */
const zaDni = (dni: number) => {
  const d = new Date()
  d.setDate(d.getDate() + dni)
  d.setHours(9, 0, 0, 0)
  return String(d.getTime())
}

function zadanie(nadpisz: Partial<ClickUpTask> = {}): ClickUpTask {
  return {
    id: 'abc',
    name: 'Zadanie testowe',
    description: null,
    status: { status: 'w toku', color: '#60a5fa', type: 'custom', orderindex: 1 },
    priority: null,
    assignees: [],
    date_created: ms('2026-08-01T09:00:00Z'),
    date_updated: ms('2026-08-02T09:00:00Z'),
    date_due: null,
    date_start: null,
    list: { id: '1', name: 'Lista' },
    folder: { id: '1', name: 'Folder' },
    parent: null,
    time_estimate: null,
    time_spent: null,
    url: 'https://app.clickup.com/t/abc',
    ...nadpisz,
  }
}

describe('metadane na karcie', () => {
  it('start i termin stoja w JEDNEJ plakietce, nie w dwoch', () => {
    // Dwie osobne plakietki dat nie mieszcza sie w wierszu razem z priorytetem,
    // estymata i Track Time — a jeden wiersz jest celem tego ukladu.
    render(<TaskCard task={zadanie({
      date_start: zaDni(1),
      date_due: zaDni(3),
    })} onClick={vi.fn()} />)

    const dzienStartu = new Date(Number(zaDni(1))).getDate()
    const dzienTerminu = new Date(Number(zaDni(3))).getDate()
    const daty = screen.getByTitle('Start i termin')
    assert.match(daty.textContent ?? '', new RegExp(`\\b${dzienStartu}\\b`), 'brak dnia startu')
    assert.match(daty.textContent ?? '', new RegExp(`\\b${dzienTerminu}\\b`), 'brak dnia terminu')
  })

  it('sam termin bez startu tez sie pokazuje', () => {
    render(<TaskCard task={zadanie({ date_due: zaDni(3) })} onClick={vi.fn()} />)
    assert.ok(screen.getByTitle(/Start i termin|Termin minął/), 'termin musi byc widoczny bez startu')
  })

  it('Track Time NIE jest czerwony (nie uzywa koloru primary)', () => {
    // Czerwien w portalu znaczy klopot: awaria i spozniony termin. Godziny
    // przepracowane klopotem nie sa, a czerwony Track Time na kazdej karcie
    // odbieral czerwieni jej jedyna funkcje.
    render(<TaskCard task={zadanie({ trackedTimeMs: 2.5 * 3600_000 })} onClick={vi.fn()} />)

    const tt = screen.getByTitle('Track Time (tygodniowy)')
    const klasy = tt.getAttribute('class') ?? ''
    assert.ok(!/primary/.test(klasy), `Track Time nie moze uzywac primary, bylo: ${klasy}`)
    assert.ok(!/destructive/.test(klasy), `Track Time nie moze uzywac destructive, bylo: ${klasy}`)
  })

  it('miniety termin jest czerwony, przyszly nie', () => {
    const stary = new Date()
    stary.setDate(stary.getDate() - 3)
    const przyszly = new Date()
    przyszly.setDate(przyszly.getDate() + 3)

    render(<TaskCard task={zadanie({ date_due: String(stary.getTime()) })} onClick={vi.fn()} />)
    const spozniony = screen.getByTitle('Termin minął')
    assert.match(spozniony.getAttribute('class') ?? '', /destructive/, 'spozniony termin ma byc czerwony')

    cleanup()
    render(<TaskCard task={zadanie({ date_due: String(przyszly.getTime()) })} onClick={vi.fn()} />)
    const wTerminie = screen.getByTitle('Start i termin')
    assert.ok(!/destructive/.test(wTerminie.getAttribute('class') ?? ''), 'termin w przyszlosci nie jest czerwony')
  })

  it('zadanie zamkniete po terminie nie jest czerwone', () => {
    const stary = new Date()
    stary.setDate(stary.getDate() - 30)

    render(<TaskCard task={zadanie({
      date_due: String(stary.getTime()),
      status: { status: 'zamknięte', color: '#4ade80', type: 'closed', orderindex: 5 },
    })} onClick={vi.fn()} />)

    const daty = screen.getByTitle('Start i termin')
    assert.ok(!/destructive/.test(daty.getAttribute('class') ?? ''), 'zrobione zadanie nie jest spoznione')
  })

  it('awaria pokazuje plakietke z dostepna nazwa, mimo braku widocznego slowa', () => {
    // Slowo „Alarm" zniklo z karty dla miejsca, ale nie moze zniknac dla
    // czytnika ekranu ani z tooltipa.
    render(<TaskCard task={zadanie({ tags: [{ name: 'awaria' }] })} onClick={vi.fn()} />)

    const alarm = screen.getByTitle('Zgłoszenie awaryjne')
    assert.match(alarm.textContent ?? '', /Alarm/, 'nazwa musi zostac dla czytnika ekranu')
  })

  it('wszystkie plakietki maja identyczna wysokosc, bo stoja w jednym wierszu', () => {
    // Rozne wysokosci w jednym wierszu to dokladnie ten rodzaj nierownosci,
    // ktory widac, a trudno nazwac. Wysokosc jest narzucona klasa, nie
    // paddingiem, wiec da sie ja sprawdzic bez przegladarki.
    render(<TaskCard task={zadanie({
      tags: [{ name: 'awaria' }],
      priority: { priority: 'urgent', color: '#f87171', id: '1', orderindex: '1' },
      date_start: zaDni(1),
      date_due: zaDni(3),
      time_estimate: 4 * 3600_000,
      trackedTimeMs: 2.5 * 3600_000,
    })} onClick={vi.fn()} />)

    const tytuly = ['Zgłoszenie awaryjne', 'Priorytet: urgent', 'Start i termin', 'Szacowany czas', 'Track Time (tygodniowy)']
    for (const t of tytuly) {
      const klasy = screen.getByTitle(t).getAttribute('class') ?? ''
      assert.match(klasy, /\bh-6\b/, `plakietka „${t}" ma inna wysokosc niz reszta: ${klasy}`)
      assert.match(klasy, /leading-none/, `plakietka „${t}" bez leading-none rozjedzie sie w pionie`)
    }
  })
})
