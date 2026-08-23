import { db } from './db'
import { taskTimeSnapshots } from './db/schema'
import { eq, sql } from 'drizzle-orm'
import type { ClickUpTask } from './types'

/**
 * Weekly-frozen tracked-time snapshots.
 *
 * The portal shows a tracked-time ("Track Time") value that is deliberately
 * NOT live: a Friday-morning cron freezes each task's current ClickUp
 * `time_spent` into task_time_snapshots, and the portal reads that frozen
 * value. Clients therefore see a stable weekly number rather than one that
 * ticks up in real time.
 */

/** Flatten a task tree (parents + nested children) into a single list. */
function flattenTasks(tasks: ClickUpTask[]): ClickUpTask[] {
  const out: ClickUpTask[] = []
  const walk = (t: ClickUpTask) => {
    out.push(t)
    for (const c of t.children ?? []) walk(c)
  }
  for (const t of tasks) walk(t)
  return out
}

/** Map of clickupTaskId -> frozen tracked time (ms) for one portal. */
export async function getSnapshotMap(portalId: string): Promise<Map<string, number>> {
  const rows = await db
    .select({ taskId: taskTimeSnapshots.clickupTaskId, ms: taskTimeSnapshots.timeSpentMs })
    .from(taskTimeSnapshots)
    .where(eq(taskTimeSnapshots.portalId, portalId))

  const map = new Map<string, number>()
  for (const r of rows) map.set(r.taskId, r.ms)
  return map
}

/** Inject `trackedTimeMs` into a task tree from a snapshot map (mutates copies). */
export function mergeTrackedTime(tasks: ClickUpTask[], snapshots: Map<string, number>): ClickUpTask[] {
  const apply = (t: ClickUpTask): ClickUpTask => ({
    ...t,
    trackedTimeMs: snapshots.get(t.id) ?? null,
    children: t.children ? t.children.map(apply) : t.children,
  })
  return tasks.map(apply)
}

/**
 * Freeze the current ClickUp time_spent for every task (incl. subtasks) of a
 * portal into task_time_snapshots. Upserts one row per (portal, task).
 * Returns the number of tasks captured.
 */
/**
 * Freeze the current ClickUp time_spent for every task (incl. subtasks) of a
 * portal into task_time_snapshots. Upserts rows in batches of (portal, task).
 * Returns the number of tasks captured.
 */
export async function writeSnapshots(portalId: string, tasks: ClickUpTask[]): Promise<number> {
  const flat = flattenTasks(tasks)
  if (flat.length === 0) return 0

  // Zbiorczy upsert porcjami po 200, nie pętla round-tripów per zadanie:
  // przy dużym folderze pojedyncze uperty dawały setki zapytań, a awaria w
  // połowie zostawiała tydzień zamrożony tylko częściowo. Porcja 200 trzyma
  // liczbę parametrów zapytania poniżej limitu Postgresa.
  for (let i = 0; i < flat.length; i += 200) {
    const chunk = flat.slice(i, i + 200).map(t => ({
      portalId,
      clickupTaskId: t.id,
      timeSpentMs: t.time_spent ?? 0,
    }))
    await db
      .insert(taskTimeSnapshots)
      .values(chunk)
      .onConflictDoUpdate({
        target: [taskTimeSnapshots.portalId, taskTimeSnapshots.clickupTaskId],
        set: { timeSpentMs: sql`excluded.time_spent_ms`, snapshotAt: new Date() },
      })
  }
  return flat.length
}
