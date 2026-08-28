import 'server-only'

/**
 * Klient API SuperChecka (`tests.important.is`) — WYŁĄCZNIE ODCZYT.
 *
 * Token jest per projekt, nie globalny: SuperCheck odrzuca token bez zakresu
 * projektu (`CLI token has no project scope` w ich `auth-context.ts`). Dlatego
 * token przychodzi tu argumentem, z kolumny `portals.supercheck_token`, a nie
 * ze zmiennej środowiskowej.
 *
 * Ten moduł NIGDY nie rzuca. Widget na Dashboardzie jest dodatkiem do strony,
 * której główną treścią są zadania klienta; awaria panelu testów nie ma prawa
 * wywalić całego Dashboardu ani go zawiesić. Stąd twardy limit czasu i `null`
 * zamiast wyjątku.
 *
 * UWAGA na uprawnienia: token CLI daje PEŁEN dostęp do projektu w SuperChecku,
 * także zapis. Portal używa wyłącznie GET-ów i tak ma zostać. Gdyby kiedyś
 * potrzeba było czegoś więcej, właściwą drogą jest wąski endpoint tylko do
 * odczytu po stronie SuperChecka, nie szersze użycie tego tokenu.
 */

const DEFAULT_URL = 'https://tests.important.is'
/** Dashboard ma się wyświetlić także wtedy, gdy panel testów milczy. */
const TIMEOUT_MS = 4000

export interface ScMonitor {
  id: string
  name: string
  target: string | null
  status: string
  enabled: boolean
  lastCheckAt: string | null
}

/**
 * Statystyki monitora, ZNORMALIZOWANE.
 *
 * Kształt odpowiedzi SuperChecka NIE ZGADZA SIĘ z ich własną dokumentacją
 * OpenAPI (sprawdzone na żywo 28.08): zamiast płaskich pól `uptimePercent`
 * i `p95ResponseTime` przychodzi `{ data: { period24h, period30d } }` z polami
 * `uptimePercentage`, `upChecks`, `p95ResponseTimeMs`. Tłumaczymy to TUTAJ,
 * żeby reszta portalu nie musiała znać cudzych nazw ani ich zmian.
 */
export interface ScStats {
  totalChecks: number
  successfulChecks: number
  uptimePercent: number
  avgMs: number
  p95Ms: number
}

/** Surowy blok okresu, tak jak przychodzi z API. */
interface ScOkres {
  totalChecks?: number
  upChecks?: number
  uptimePercentage?: number
  avgResponseTimeMs?: number
  p95ResponseTimeMs?: number
}

export interface ScRun {
  id: string
  jobName: string
  status: string
  startedAt: string | null
  completedAt: string | null
  testCount: number | null
}

function baseUrl(): string {
  return (process.env.SUPERCHECK_URL ?? DEFAULT_URL).replace(/\/$/, '')
}

async function get<T>(token: string, path: string): Promise<T | null> {
  const kontroler = new AbortController()
  const stoper = setTimeout(() => kontroler.abort(), TIMEOUT_MS)
  try {
    const res = await fetch(`${baseUrl()}${path}`, {
      headers: { Authorization: `Bearer ${token}` },
      signal: kontroler.signal,
      // Cache trzymamy WYŻEJ (unstable_cache przy złożeniu widoku), bo klucz
      // musi zawierać projekt. Tu wyłączamy cache Nexta, żeby nie mieszały się
      // dwa mechanizmy o różnych kluczach.
      cache: 'no-store',
    })
    if (!res.ok) {
      console.error(`[monitoring] SuperCheck ${path} zwrócił ${res.status}`)
      return null
    }
    return (await res.json()) as T
  } catch (error) {
    console.error(`[monitoring] SuperCheck ${path} nie odpowiedział:`, error)
    return null
  } finally {
    clearTimeout(stoper)
  }
}

/** Monitory projektu. `null` znaczy „nie wiemy", nie „nie ma monitorów". */
export async function listMonitors(token: string): Promise<ScMonitor[] | null> {
  const data = await get<{ data?: ScMonitor[] }>(token, '/api/monitors')
  return data?.data ?? null
}

/** Statystyki monitora za `days` dni (API oddaje okna 24h i 30d). */
export async function monitorStats(token: string, id: string, days = 30): Promise<ScStats | null> {
  const odp = await get<{ data?: { period24h?: ScOkres; period30d?: ScOkres } }>(
    token,
    `/api/monitors/${encodeURIComponent(id)}/stats?days=${days}`,
  )
  const okres = days <= 1 ? odp?.data?.period24h : odp?.data?.period30d
  if (!okres || typeof okres.totalChecks !== 'number') return null

  return {
    totalChecks: okres.totalChecks,
    // `upChecks` bywa nieobecne w starszych odpowiedziach; wtedy liczymy je
    // z procentu, zamiast przyjmować zero i zaniżać dostępność do 0%.
    successfulChecks:
      typeof okres.upChecks === 'number'
        ? okres.upChecks
        : Math.round(((okres.uptimePercentage ?? 0) / 100) * okres.totalChecks),
    uptimePercent: okres.uptimePercentage ?? 0,
    avgMs: Math.round(okres.avgResponseTimeMs ?? 0),
    p95Ms: Math.round(okres.p95ResponseTimeMs ?? 0),
  }
}

/** Ostatnie przebiegi testów w projekcie. */
export async function listRuns(token: string, limit = 20): Promise<ScRun[] | null> {
  const data = await get<{ data?: ScRun[] }>(token, `/api/runs?limit=${limit}`)
  return data?.data ?? null
}
