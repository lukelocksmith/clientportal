import { and, desc, eq } from 'drizzle-orm'
import { db } from './db'
import { cronRuns } from './db/schema'

export type CronJob = 'task-index' | 'time-snapshot'

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

async function alert(content: string): Promise<void> {
  if (!DISCORD_WEBHOOK) {
    console.warn('[cron] brak PANIC_DISCORD_WEBHOOK_URL — alarm tylko w logach:', content)
    return
  }
  // Alarm nie może wywalić samego crona, więc błąd wysyłki tylko logujemy.
  await fetch(DISCORD_WEBHOOK, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ content }),
  }).catch(e => console.error('[cron] nie udało się wysłać alarmu:', e))
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
