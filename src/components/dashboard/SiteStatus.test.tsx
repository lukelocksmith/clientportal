// @vitest-environment jsdom
/**
 * Kafle „Stan strony" na Dashboardzie.
 *
 * Pilnują trzech rzeczy, które psują się cicho: że brak danych mówi o braku
 * (a nie pokazuje zera), że okno pomiaru jest podpisane, i że czas odpowiedzi
 * serwera nie udaje szybkości ładowania strony.
 *
 *   npx vitest run src/components/dashboard/SiteStatus.test.tsx
 */
import { describe, it, afterEach } from 'vitest'
import assert from 'node:assert'
import { render, screen, cleanup } from '@testing-library/react'
import { SiteStatus } from './SiteStatus'
import type { SiteStatus as Model } from '@/lib/monitoring'

afterEach(cleanup)

const pelny: Model = {
  uptime: { percent: 98.9, days: 30, monitors: 3, down: false, lastCheckAt: '2026-08-28T19:40:00Z', p95Ms: 629 },
  tests: { jobName: 'wodadlafirmy.pl - koszyk', status: 'passed', at: '2026-08-28T06:02:00Z', testCount: 4 },
  speed: { score: 62, lcpMs: 2400, measuredAt: '2026-08-28T05:00:00Z', url: 'https://wodadlafirmy.pl' },
  powod: null,
}

describe('kafle stanu strony', () => {
  it('pokazuje dostepnosc Z OKRESEM, bo procent bez okna nic nie znaczy', () => {
    render(<SiteStatus status={pelny} />)

    assert.ok(screen.getByText('98,9%'))
    assert.ok(screen.getByText(/30 dni/), 'brak okresu przy dostepnosci')
  })

  it('czas odpowiedzi serwera stoi przy DOSTEPNOSCI, a nie jako szybkosc ladowania', () => {
    // To sa dwie rozne liczby: 629 ms to odpowiedz serwera, a szybkosc
    // ladowania strony jest w drugim kaflu i liczy sie w sekundach.
    render(<SiteStatus status={pelny} />)

    assert.ok(screen.getByText(/odpowiedź do 629 ms/))
    assert.ok(screen.getByText('62/100'), 'brak wyniku szybkosci ladowania')
    assert.ok(screen.getByText(/treść widoczna po 2\.4 s/))
  })

  it('awaria czujki maluje dostepnosc na czerwono i mowi o tym wprost', () => {
    render(<SiteStatus status={{ ...pelny, uptime: { ...pelny.uptime!, down: true } }} />)

    assert.ok(screen.getByText(/teraz nie odpowiada/))
    assert.match(screen.getByText('98,9%').getAttribute('class') ?? '', /destructive/)
  })

  it('brak pomiaru daje myslnik i zdanie o braku, NIE zero procent', () => {
    // „0%" czytaloby sie jak „strona nie dziala", a to jest brak danych.
    render(<SiteStatus status={{ uptime: null, tests: null, speed: null, powod: 'brak-monitorow' }} />)

    assert.ok(screen.getByText(/nie mamy jeszcze żadnej czujki/))
    assert.strictEqual(screen.queryByText('0%') === null, true)
  })

  it('projekt bez tokenu mowi, ze nie jest podpiety', () => {
    render(<SiteStatus status={{ uptime: null, tests: null, speed: null, powod: 'brak-tokenu' }} />)
    assert.ok(screen.getByText(/nie jest jeszcze podpięty/))
  })

  it('brak przebiegu testow nie udaje sukcesu', () => {
    render(<SiteStatus status={{ ...pelny, tests: null }} />)

    assert.ok(screen.getByText(/brak przebiegu dla tego projektu/))
    assert.strictEqual(screen.queryByText('przeszły') === null, true)
  })

  it('nieudane testy sa czerwone', () => {
    render(<SiteStatus status={{ ...pelny, tests: { ...pelny.tests!, status: 'failed' } }} />)
    assert.match(screen.getByText('błąd').getAttribute('class') ?? '', /destructive/)
  })
})
