/**
 * Co klient zobaczy jako „Stan strony".
 *
 * Tu siedzą decyzje, które łatwo popsuć bez błędu: co wchodzi do dostępności,
 * jak ważymy monitory i kiedy mówimy „nie wiemy" zamiast pokazać liczbę.
 *
 *   npx vitest run src/lib/monitoring/status.test.ts
 */
import { describe, it } from 'vitest'
import assert from 'node:assert'
import { projectMonitors, aggregateUptime, lastRunForProject } from '@/lib/monitoring/status'
import type { ScMonitor, ScStats, ScRun } from '@/lib/monitoring/supercheck'

const monitor = (over: Partial<ScMonitor> & { id: string }): ScMonitor => ({
  name: over.id,
  target: 'https://wodadlafirmy.pl/',
  status: 'up',
  enabled: true,
  lastCheckAt: '2026-08-28T19:40:00Z',
  ...over,
})

const stat = (over: Partial<ScStats> = {}): ScStats => ({
  uptimePercent: 100,
  avgMs: 200,
  p95Ms: 400,
  totalChecks: 1000,
  successfulChecks: 1000,
  ...over,
})

describe('ktore monitory sa nasze', () => {
  const hosts = ['wodadlafirmy.pl']

  it('bierze monitory z domen projektu', () => {
    const wynik = projectMonitors([
      monitor({ id: 'nasz' }),
      monitor({ id: 'cudzy', target: 'https://onyx.pl/' }),
    ], hosts)

    assert.deepStrictEqual(wynik.map(m => m.id), ['nasz'])
  })

  it('pomija wstrzymane i wylaczone', () => {
    // Wstrzymany monitor ma stare wyniki. Wliczony do dostepnosci pokazywalby
    // historie jako stan biezacy.
    const wynik = projectMonitors([
      monitor({ id: 'wstrzymany', status: 'paused' }),
      monitor({ id: 'wylaczony', enabled: false }),
      monitor({ id: 'dziala' }),
    ], hosts)

    assert.deepStrictEqual(wynik.map(m => m.id), ['dziala'])
  })

  it('monitory kontrolne SuperChecka (.invalid) odpadaja same', () => {
    // W panelu leza monitory, ktore celowo padaja, do sprawdzania alertow.
    const wynik = projectMonitors([monitor({ id: 'kontrola', target: 'https://kontrola-alertu.invalid/' })], hosts)
    assert.deepStrictEqual(wynik, [])
  })
})

describe('dostepnosc', () => {
  it('wazona LICZBA SPRAWDZEN, nie srednia ze srednich', () => {
    // 1000 sprawdzen po 100% i 10 sprawdzen po 50% to 99.5%, a nie 75%.
    const monitory = [monitor({ id: 'a' }), monitor({ id: 'b' })]
    const s = new Map([
      ['a', stat({ totalChecks: 1000, successfulChecks: 1000, uptimePercent: 100 })],
      ['b', stat({ totalChecks: 10, successfulChecks: 5, uptimePercent: 50 })],
    ])

    const wynik = aggregateUptime(monitory, s, 30)!
    assert.strictEqual(wynik.percent, 99.5)
    assert.strictEqual(wynik.monitors, 2)
  })

  it('p95 bierzemy NAJGORSZY z monitorow, nie sredni', () => {
    // Klient odczuwa najwolniejsza ze swoich stron, nie ich srednia.
    const s = new Map([
      ['a', stat({ p95Ms: 300 })],
      ['b', stat({ p95Ms: 1800 })],
    ])
    const wynik = aggregateUptime([monitor({ id: 'a' }), monitor({ id: 'b' })], s, 30)!
    assert.strictEqual(wynik.p95Ms, 1800)
  })

  it('monitor w dole zapala flage, mimo dobrej historii', () => {
    const s = new Map([['a', stat()]])
    const wynik = aggregateUptime([monitor({ id: 'a', status: 'down' })], s, 30)!
    assert.strictEqual(wynik.down, true)
  })

  it('brak statystyk to null, nie zero procent', () => {
    // Zero procent czytaloby sie jak „strona nie dziala", a to jest brak danych.
    assert.strictEqual(aggregateUptime([monitor({ id: 'a' })], new Map(), 30), null)
    assert.strictEqual(aggregateUptime([], new Map([['a', stat()]]), 30), null)
    assert.strictEqual(aggregateUptime([monitor({ id: 'a' })], new Map([['a', stat({ totalChecks: 0 })]]), 30), null)
  })
})

describe('ostatni przebieg testow', () => {
  const run = (over: Partial<ScRun> & { id: string }): ScRun => ({
    jobName: 'wodadlafirmy.pl - koszyk',
    status: 'passed',
    startedAt: '2026-08-28T06:00:00Z',
    completedAt: '2026-08-28T06:02:00Z',
    testCount: 4,
    ...over,
  })

  it('bierze najnowszy przebieg TEGO projektu', () => {
    const wynik = lastRunForProject([
      run({ id: 'stary', startedAt: '2026-08-20T06:00:00Z', status: 'failed' }),
      run({ id: 'nowy', startedAt: '2026-08-28T06:00:00Z', status: 'passed' }),
      run({ id: 'cudzy', jobName: 'Onyx - logowanie', startedAt: '2026-08-28T07:00:00Z' }),
    ], ['wodadlafirmy.pl'], 'WDF')!

    assert.strictEqual(wynik.status, 'passed')
    assert.match(wynik.jobName, /wodadlafirmy/)
  })

  it('przebieg W TOKU nie jest odpowiedzia na pytanie o stan', () => {
    const wynik = lastRunForProject([
      run({ id: 'w-toku', status: 'running', startedAt: '2026-08-28T08:00:00Z' }),
      run({ id: 'skonczony', status: 'failed', startedAt: '2026-08-28T06:00:00Z' }),
    ], ['wodadlafirmy.pl'], 'WDF')!

    assert.strictEqual(wynik.status, 'failed')
  })

  it('brak przebiegu tego projektu to null, nie cudzy wynik', () => {
    const wynik = lastRunForProject([run({ id: 'cudzy', jobName: 'Onyx - logowanie' })], ['wodadlafirmy.pl'], 'WDF')
    assert.strictEqual(wynik, null)
  })
})
