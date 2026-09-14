import { and, desc, eq, lt } from 'drizzle-orm'
import { db } from './db'
import { cronRuns } from './db/schema'

export type CronJob = 'task-index' | 'time-snapshot' | 'panic-escalation' | 'pending-reports' | 'alert-channel'

/**
 * Zapis wyniku przebiegu crona plus alarm na Discorda przy porażce.
 *
 * Powód istnienia: cron Track Time zwracał wynik w treści odpowiedzi HTTP,
 * a wpis w crontabie kierował ją do /dev/null. Informacja o awarii była
 * starannie zbierana i wyrzucana. Jedynym sposobem sprawdzenia, czy cokolwiek
 * się policzyło, było wejście po SSH do kontenera i odpytanie bazy.
 *
 * Alarm idzie na ten sam webhook co panic (#alarmy), bo kanał już istnieje
 * i zespół go czyta. Zmienna jest ta sama: PANIC_DISCORD_WEBHOOK_URL.
 */
const DISCORD_WEBHOOK = process.env.PANIC_DISCORD_WEBHOOK_URL

/**
 * Alarm operacyjny na Discorda (#alarmy), dla rzeczy, o których zespół MUSI
 * się dowiedzieć bez patrzenia w panel.
 *
 * Wyeksportowane, bo od 31.08 woła to także kolejka zgłoszeń: zgłoszenie
 * czekające kwadrans nie jest już awarią ClickUpa, tylko sprawą dla człowieka.
 * Ten sam kanał celowo — zespół czyta jeden, nie trzy.
 *
 * NIGDY nie rzuca: alarm o awarii nie ma prawa być drugą awarią.
 */
export async function sendOpsAlert(content: string): Promise<void> {
  await alert(content)
}

/**
 * STAN KANAŁU ALARMÓW. Czy ostatnia próba wysyłki w ogóle doszła.
 *
 * PO CO (14.09). Wszystko, co portal ma do powiedzenia o własnych awariach,
 * wychodzi jednym webhookiem Discorda — alarmy z czerwonego przycisku, kolejka
 * zgłoszeń, porzucone rozmowy z asystentem, błędy 5xx, a nawet czujka z Mac
 * mini. Do dziś ta funkcja połykała błąd wysyłki do `console.error`, więc
 * usunięty webhook albo zmienione uprawnienia kanału uciszały CAŁY nadzór,
 * a cisza wyglądała identycznie jak spokój. Dokładnie ten układ naprawialiśmy
 * przez dwa dni piętro niżej.
 *
 * Stan czyta `/api/health/zgloszenia`, który jest pilnowany z zewnątrz przez
 * UptimeRobota — a ten powiadamia mailem i Pushoverem, czyli drogą, która NIE
 * przechodzi przez Discorda. To jest cały sens: druga droga nie może dzielić
 * z pierwszą punktu awarii.
 */
let ostatniaWysylka: { ok: boolean; kiedy: Date; detail: string | null } | null = null

export function stanKanaluAlarmow(): { ok: boolean; kiedy: Date; detail: string | null } | null {
  return ostatniaWysylka
}

/** Do testów. W działającym portalu nie ma wołającego. */
export function zapomnijStanKanalu(): void {
  ostatniaWysylka = null
}

async function alert(content: string): Promise<boolean> {
  if (!DISCORD_WEBHOOK) {
    console.warn('[cron] brak PANIC_DISCORD_WEBHOOK_URL — alarm tylko w logach:', content)
    // Brak konfiguracji to nie jest awaria kanału: tak wygląda maszyna
    // deweloperska. Awarią jest webhook, który JEST i nie przyjmuje.
    return false
  }
  try {
    const res = await fetch(DISCORD_WEBHOOK, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ content }),
    })
    // Discord oddaje 204 przy przyjęciu. Kod 404 znaczy „webhook skasowany",
    // 401 „token nieważny", 429 „limit" — i każdy z nich do 14.09 wyglądał
    // u nas jak sukces, bo nikt nie patrzył na odpowiedź.
    ostatniaWysylka = {
      ok: res.ok,
      kiedy: new Date(),
      detail: res.ok ? null : `HTTP ${res.status}`,
    }
    if (!res.ok) console.error(`[cron] kanał alarmów odrzucił wiadomość: HTTP ${res.status}`)
    return res.ok
  } catch (e) {
    const detail = e instanceof Error ? e.message : String(e)
    ostatniaWysylka = { ok: false, kiedy: new Date(), detail }
    console.error('[cron] nie udało się wysłać alarmu:', detail)
    return false
  }
}

/**
 * Czy kanał alarmów w ogóle przyjmuje wiadomości. BEZ wysyłania czegokolwiek.
 *
 * Discord oddaje na GET metadane webhooka, więc da się sprawdzić jego istnienie
 * i ważność bez zaśmiecania kanału zespołu. Cichy sygnał życia jest tu celem:
 * czujka, która co godzinę pisze „żyję", po tygodniu przestaje być czytana.
 */
export async function sprawdzKanalAlarmow(): Promise<{ ok: boolean; detail: string | null }> {
  if (!DISCORD_WEBHOOK) return { ok: false, detail: 'brak PANIC_DISCORD_WEBHOOK_URL' }
  try {
    const res = await fetch(DISCORD_WEBHOOK, { method: 'GET' })
    const stan = { ok: res.ok, detail: res.ok ? null : `HTTP ${res.status}` }
    ostatniaWysylka = { ok: stan.ok, kiedy: new Date(), detail: stan.detail }
    return stan
  } catch (e) {
    const detail = e instanceof Error ? e.message : String(e)
    ostatniaWysylka = { ok: false, kiedy: new Date(), detail }
    return { ok: false, detail }
  }
}

export type CronRunResult = {
  job: CronJob
  portalId?: string | null
  portalSlug?: string
  ok: boolean
  itemsProcessed?: number
  detail?: string | null
  startedAt: Date
}

/**
 * Zapisuje przebieg i alarmuje, gdy się nie udał.
 *
 * Zapis do rejestru NIE MOŻE wywalić crona, tak samo jak `logEvent` nie może
 * wywalić trasy. Obie trasy cronowe wołają tę funkcję w pętli po portalach, w
 * tym z bloku `catch`. Bez tej ochrony padnięty insert przerywał całą pętlę i
 * pozostałe projekty zostawały niezsynchronizowane, a przy porażce w gałęzi
 * `try` wchodził jeszcze `catch`, który zapisywał UDANY przebieg jako nieudany.
 * Historia synchronizacji ma opisywać przebieg, a nie decydować o nim.
 */
export async function recordCronRun(result: CronRunResult): Promise<void> {
  try {
    await db.insert(cronRuns).values({
      job: result.job,
      portalId: result.portalId ?? null,
      ok: result.ok,
      itemsProcessed: result.itemsProcessed ?? 0,
      detail: result.detail ?? null,
      startedAt: result.startedAt,
    })
  } catch (e) {
    console.error('[cron] nie udało się zapisać przebiegu:', e)
  }

  if (!result.ok) {
    const where = result.portalSlug ? ` (projekt: ${result.portalSlug})` : ''
    await alert(
      `⚠️ **Cron portalu nie wykonał się poprawnie**\n` +
        `Zadanie: \`${result.job}\`${where}\n` +
        `Szczegóły: ${result.detail ?? 'brak'}`
    )
  }
}

export const CRON_JOB_LABELS: Record<CronJob, string> = {
  'time-snapshot': 'Track Time (zamrożenie godzin)',
  'task-index': 'Indeks Historii i wyszukiwarki',
  'panic-escalation': 'Eskalacja alarmów bez reakcji',
  'pending-reports': 'Dowożenie zgłoszeń z kolejki',
  'alert-channel': 'Sygnał życia kanału alarmów',
}

export type CronRunRow = {
  id: string
  job: string
  jobLabel: string
  ok: boolean
  itemsProcessed: number
  detail: string | null
  startedAt: Date
  finishedAt: Date
  durationMs: number
}

/**
 * Przebiegi synchronizacji dla JEDNEGO projektu, od najnowszych.
 *
 * Do panelu admina. Do tej pory ta tabela istniała wyłącznie po to, żeby
 * alarmować na Discordzie przy porażce i podawać klientowi datę „dane na
 * dzień X". Znaczyło to, że pytanie „czy Track Time tego klienta się w ogóle
 * liczy" wymagało wejścia po SSH i zapytania bazy z ręki.
 *
 * Przebiegi bez `portalId` (obejmujące wszystkie portale) NIE wchodzą: w widoku
 * projektu wyglądałyby jak jego własna synchronizacja, a nie zawierają jego
 * liczby zadań.
 */
export async function listCronRuns(options: {
  portalId: string
  job?: CronJob
  limit?: number
}): Promise<CronRunRow[]> {
  const limit = Math.min(Math.max(options.limit ?? 50, 1), 200)

  const filters = [eq(cronRuns.portalId, options.portalId)]
  if (options.job) filters.push(eq(cronRuns.job, options.job))

  const rows = await db
    .select()
    .from(cronRuns)
    .where(and(...filters))
    .orderBy(desc(cronRuns.finishedAt))
    .limit(limit)

  return rows.map(r => ({
    id: r.id,
    job: r.job,
    jobLabel: CRON_JOB_LABELS[r.job as CronJob] ?? r.job,
    ok: r.ok,
    itemsProcessed: r.itemsProcessed,
    detail: r.detail,
    startedAt: r.startedAt,
    finishedAt: r.finishedAt,
    // Czas trwania liczymy tutaj, bo w panelu jest to pierwszy sygnał, że
    // synchronizacja zbliża się do limitu czasu żądania.
    durationMs: Math.max(0, r.finishedAt.getTime() - r.startedAt.getTime()),
  }))
}

/**
 * Ostatni UDANY przebieg danego zadania dla portalu. Portal pokazuje tę datę
 * klientowi jako "dane na dzień X", żeby zaległa synchronizacja była widoczna,
 * a nie wyglądała jak brak zadań.
 *
 * Przebieg bez portalId (obejmujący wszystkie portale) też się liczy, dlatego
 * pytamy najpierw o wpis portalu, a w razie braku o wpis ogólny.
 */
export async function getLastSuccessfulRun(
  job: CronJob,
  portalId: string
): Promise<Date | null> {
  const forPortal = await db
    .select({ finishedAt: cronRuns.finishedAt })
    .from(cronRuns)
    .where(and(eq(cronRuns.job, job), eq(cronRuns.portalId, portalId), eq(cronRuns.ok, true)))
    .orderBy(desc(cronRuns.finishedAt))
    .limit(1)

  return forPortal[0]?.finishedAt ?? null
}

/**
 * Ile historii przebiegów trzymamy. Sześćdziesiąt dni: pokrywa pytanie „czy to
 * chodziło w zeszłym miesiącu", a nie pozwala tabeli rosnąć bez końca.
 *
 * Skala jest realna, nie teoretyczna: dowożenie zgłoszeń chodzi co 2 minuty,
 * czyli 720 wierszy dziennie, ćwierć miliona rocznie z jednego zadania.
 */
export const CRON_RUNS_KEEP_DAYS = 60

/** Usuwa stare przebiegi. Woła cron dowożenia, bo chodzi najczęściej. */
export async function pruneCronRuns(now = new Date()): Promise<number> {
  const granica = new Date(now.getTime() - CRON_RUNS_KEEP_DAYS * 86_400_000)
  const usuniete = await db
    .delete(cronRuns)
    .where(lt(cronRuns.finishedAt, granica))
    .returning({ id: cronRuns.id })
  return usuniete.length
}
