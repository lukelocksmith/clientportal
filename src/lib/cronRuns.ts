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

/** Zapisuje przebieg i alarmuje, gdy się nie udał. */
export async function recordCronRun(result: CronRunResult): Promise<void> {
  await db.insert(cronRuns).values({
    job: result.job,
    portalId: result.portalId ?? null,
    ok: result.ok,
    itemsProcessed: result.itemsProcessed ?? 0,
    detail: result.detail ?? null,
    startedAt: result.startedAt,
  })

  if (!result.ok) {
    const where = result.portalSlug ? ` (projekt: ${result.portalSlug})` : ''
    await alert(
      `⚠️ **Cron portalu nie wykonał się poprawnie**\n` +
        `Zadanie: \`${result.job}\`${where}\n` +
        `Szczegóły: ${result.detail ?? 'brak'}`
    )
  }
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
