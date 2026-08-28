/**
 * Scalanie raportu czasu z pozostałą estymacją w JEDNĄ liste zadań.
 *
 *   npx vitest run src/lib/reportMerge.test.ts
 */
import { describe, it } from 'vitest'
import assert from 'node:assert'
import { mergeReports } from '@/lib/reportMerge'
import type { TimeReport } from '@/lib/timeReports'
import type { EstimateReport } from '@/lib/estimateReport'

const H = 3_600_000

const czas = (rows: Array<{ taskId: string; taskName: string; status: string; durationMs: number; isOverhead?: boolean }>): TimeReport => {
  const taskMs = rows.filter(r => !r.isOverhead).reduce((s, r) => s + r.durationMs, 0)
  const overheadMs = rows.filter(r => r.isOverhead).reduce((s, r) => s + r.durationMs, 0)
  return {
    period: { kind: 'tydzien', key: '2026-W34', label: 'tydz. 34', startMs: 0, endMs: 1 },
    taskMs,
    overheadMs,
    totalMs: taskMs + overheadMs,
    rows,
  } as unknown as TimeReport
}

const estymacja = (
  rows: Array<{ taskId: string; name: string; status: string; estimateMs: number; spentMs: number }>,
  bezEstymacji = 0,
): EstimateReport => ({
  rows: rows.map(r => ({ ...r, url: 'https://app.clickup.com/t/x', remainingMs: r.estimateMs - r.spentMs })),
  totalRemainingMs: rows.reduce((s, r) => s + (r.estimateMs - r.spentMs), 0),
  tasksWithoutEstimate: bezEstymacji,
})

describe('jedna lista zamiast dwoch', () => {
  it('zadanie obecne w OBU raportach jest JEDNYM wierszem', () => {
    // To jest powod calego scalania: klient widzial to samo zadanie dwa razy,
    // raz z czasem, raz z estymacja, i sam musial to zlozyc.
    const wynik = mergeReports(
      czas([{ taskId: 't1', taskName: 'Zmiana procesu zakupu szkła', status: 'zablokowane', durationMs: 2 * H }]),
      estymacja([{ taskId: 't1', name: 'Zmiana procesu zakupu szkła', status: 'zablokowane', estimateMs: 16 * H, spentMs: 7 * H }]),
    )

    assert.strictEqual(wynik.rows.length, 1)
    const r = wynik.rows[0]
    assert.strictEqual(r.periodMs, 2 * H, 'czas z okresu')
    assert.strictEqual(r.estimateMs, 16 * H, 'estymacja')
    assert.strictEqual(r.spentTotalMs, 7 * H, 'caly przepracowany, nie tylko z okresu')
    assert.strictEqual(r.remainingMs, 9 * H)
    assert.strictEqual(r.open, true)
  })

  it('zadanie tylko z czasem (np. juz zamkniete) zostaje, bez zmyslonej estymacji', () => {
    const wynik = mergeReports(
      czas([{ taskId: 't9', taskName: 'Drobna poprawka', status: 'zamknięte', durationMs: 30 * 60_000 }]),
      estymacja([]),
    )

    const r = wynik.rows[0]
    assert.strictEqual(r.open, false)
    assert.strictEqual(r.estimateMs, null, 'brak estymacji to null, nie zero')
    assert.strictEqual(r.remainingMs, null)
  })

  it('zadanie otwarte bez czasu w okresie ma zero, a nie znika z listy', () => {
    const wynik = mergeReports(czas([]), estymacja([
      { taskId: 't2', name: 'Nowe zadanie', status: 'do zrobienia', estimateMs: 4 * H, spentMs: 0 },
    ]))

    assert.strictEqual(wynik.rows.length, 1)
    assert.strictEqual(wynik.rows[0].periodMs, 0)
  })

  it('narzut za organizacje pracy zostaje na LISCIE i na SAMYM KONCU', () => {
    // Narzut jest pozycja faktury, wiec nie wolno go zgubic przy scalaniu,
    // ale nie jest zadaniem, wiec nie ma prawa stanac przed praca.
    const wynik = mergeReports(
      czas([
        { taskId: 't1', taskName: 'Zadanie', status: 'w trakcie', durationMs: 5 * H },
        { taskId: 'overhead', taskName: 'Organizacja pracy', status: 'zamknięte', durationMs: 30 * 60_000, isOverhead: true },
      ]),
      estymacja([{ taskId: 't1', name: 'Zadanie', status: 'w trakcie', estimateMs: 8 * H, spentMs: 5 * H }]),
    )

    assert.strictEqual(wynik.rows.at(-1)?.isOverhead, true, 'narzut na koncu')
    assert.strictEqual(wynik.periodTotalMs, 5 * H + 30 * 60_000, 'suma okresu Z narzutem, jak na fakturze')
  })

  it('przekroczona estymacja jest NA GORZE, bo to ona wymaga rozmowy', () => {
    const wynik = mergeReports(czas([]), estymacja([
      { taskId: 'ok', name: 'Idzie zgodnie z planem', status: 'w trakcie', estimateMs: 16 * H, spentMs: 7 * H },
      { taskId: 'przekroczone', name: 'Rozpoznać metodę', status: 'zablokowane', estimateMs: 2 * H, spentMs: 3.25 * H },
    ]))

    assert.strictEqual(wynik.rows[0].taskId, 'przekroczone')
    assert.ok(wynik.rows[0].remainingMs! < 0)
  })

  it('otwarte zadania stoja przed zamknietymi', () => {
    const wynik = mergeReports(
      czas([{ taskId: 'stare', taskName: 'Zamkniete', status: 'zamknięte', durationMs: 10 * H }]),
      estymacja([{ taskId: 'nowe', name: 'Otwarte', status: 'w trakcie', estimateMs: 1 * H, spentMs: 0 }]),
    )

    assert.deepStrictEqual(wynik.rows.map(r => r.taskId), ['nowe', 'stare'])
  })
})

describe('liczby na gorze ekranu', () => {
  it('wykorzystanie estymaty to przepracowane / estymacja na zadaniach OTWARTYCH', () => {
    // O to pytal klient wprost: ile z zaplanowanego czasu juz zeszlo.
    const wynik = mergeReports(czas([]), estymacja([
      { taskId: 'a', name: 'A', status: 'w trakcie', estimateMs: 10 * H, spentMs: 5 * H },
      { taskId: 'b', name: 'B', status: 'do zrobienia', estimateMs: 10 * H, spentMs: 0 },
    ]))

    assert.strictEqual(wynik.estimateOpenMs, 20 * H)
    assert.strictEqual(wynik.spentOpenMs, 5 * H)
    assert.strictEqual(wynik.usagePct, 25)
  })

  it('bez estymacji nie ma procentu, zamiast zera albo nieskonczonosci', () => {
    // Zero czytaloby sie jak wynik pomiaru („nic nie zeszlo"), a to jest brak
    // danych.
    const wynik = mergeReports(czas([{ taskId: 't', taskName: 'T', status: 'w trakcie', durationMs: H }]), estymacja([], 20))

    assert.strictEqual(wynik.usagePct, null)
    assert.strictEqual(wynik.tasksWithoutEstimate, 20, 'liczba zadan bez estymacji musi byc widoczna')
  })

  it('sam raport czasu (funkcja estymacji wylaczona) dziala bez zmian', () => {
    const wynik = mergeReports(czas([{ taskId: 't', taskName: 'T', status: 'zamknięte', durationMs: 2 * H }]), null)

    assert.strictEqual(wynik.rows.length, 1)
    assert.strictEqual(wynik.periodTotalMs, 2 * H)
    assert.strictEqual(wynik.usagePct, null)
    assert.strictEqual(wynik.remainingMs, 0)
  })

  it('brak obu zrodel to pusty raport, nie wywalony ekran', () => {
    const wynik = mergeReports(null, null)
    assert.deepStrictEqual(wynik.rows, [])
    assert.strictEqual(wynik.periodTotalMs, 0)
  })
})
