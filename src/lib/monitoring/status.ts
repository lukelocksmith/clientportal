import type { ScMonitor, ScStats, ScRun } from './supercheck'
import { targetBelongsToProject, jobBelongsToProject } from './match'

/**
 * Złożenie surowych danych SuperChecka w to, co widzi klient.
 *
 * Czysta funkcja, bez sieci i bez bazy, bo tu siedzą wszystkie decyzje, które
 * łatwo popsuć po cichu: co wliczamy do dostępności, jak liczymy średnią z
 * wielu monitorów i kiedy mówimy „nie wiemy" zamiast pokazać liczbę.
 */

export interface UptimeView {
  /** Dostępność w procentach, ważona liczbą sprawdzeń. */
  percent: number
  days: number
  /** Ile monitorów złożyło się na tę liczbę. Klient ma prawo wiedzieć. */
  monitors: number
  /** Czy któryś monitor jest teraz w dole. */
  down: boolean
  lastCheckAt: string | null
  p95Ms: number | null
}

export interface TestsView {
  jobName: string
  status: string
  at: string | null
  testCount: number | null
}

/**
 * Monitory tego projektu, bez wyłączonych i wstrzymanych.
 *
 * Wstrzymany monitor ma stare wyniki i wliczony do dostępności pokazywałby
 * historię jako stan bieżący. W SuperChecku leżą też monitory kontrolne
 * (`*.invalid`), które celowo padają: nie mają domeny klienta, więc odpadają
 * już na dopasowaniu.
 */
export function projectMonitors(monitors: readonly ScMonitor[], hosts: readonly string[]): ScMonitor[] {
  return monitors.filter(
    m => m.enabled !== false && m.status !== 'paused' && targetBelongsToProject(m.target, hosts),
  )
}

/**
 * Dostępność ważona LICZBĄ SPRAWDZEŃ, nie średnia ze średnich.
 *
 * Monitor sprawdzany co minutę i monitor sprawdzany co godzinę nie mogą ważyć
 * tyle samo: zwykła średnia z procentów dawałaby liczbę, której nie da się
 * obronić przed klientem porównującym ją z własnym odczuciem.
 */
export function aggregateUptime(
  monitors: readonly ScMonitor[],
  stats: ReadonlyMap<string, ScStats>,
  days: number,
): UptimeView | null {
  const zeStatystyka = monitors.filter(m => stats.has(m.id))
  if (zeStatystyka.length === 0) return null

  let sprawdzenia = 0
  let udane = 0
  let p95 = 0
  for (const m of zeStatystyka) {
    const s = stats.get(m.id)!
    sprawdzenia += s.totalChecks
    udane += s.successfulChecks
    p95 = Math.max(p95, s.p95Ms)
  }
  if (sprawdzenia === 0) return null

  const daty = zeStatystyka.map(m => m.lastCheckAt).filter((d): d is string => Boolean(d)).sort()

  return {
    percent: Math.round((udane / sprawdzenia) * 1000) / 10,
    days,
    monitors: zeStatystyka.length,
    down: zeStatystyka.some(m => m.status === 'down'),
    lastCheckAt: daty.at(-1) ?? null,
    p95Ms: p95 > 0 ? Math.round(p95) : null,
  }
}

/**
 * Ostatni przebieg testów dotyczący tego projektu.
 *
 * Przebiegi w toku pomijamy: „uruchomiony przed chwilą" nie jest odpowiedzią
 * na pytanie „czy strona działa", a po odświeżeniu i tak zmieni się w wynik.
 */
export function lastRunForProject(
  runs: readonly ScRun[],
  hosts: readonly string[],
  portalName: string | null,
): TestsView | null {
  const nasze = runs
    .filter(r => r.status !== 'running' && r.status !== 'pending')
    .filter(r => jobBelongsToProject(r.jobName, hosts, portalName))
    .sort((a, b) => String(b.startedAt ?? '').localeCompare(String(a.startedAt ?? '')))

  const ostatni = nasze[0]
  if (!ostatni) return null
  return {
    jobName: ostatni.jobName,
    status: ostatni.status,
    at: ostatni.completedAt ?? ostatni.startedAt ?? null,
    testCount: ostatni.testCount ?? null,
  }
}
