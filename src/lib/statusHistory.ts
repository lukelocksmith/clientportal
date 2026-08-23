import { and, desc, eq, isNull } from 'drizzle-orm'
import { db } from './db'
import { taskStatusHistory } from './db/schema'

/**
 * Historia zmian statusu zadania.
 *
 * Dwa źródła, oba obowiązkowe, bo każde samo w sobie daje historię z dziurami:
 *
 *   webhook  zmiany robione przez zespół w ClickUpie — czyli WIĘKSZOŚĆ ruchu
 *   portal   klient przeciągnął kartę na tablicy
 *
 * Zapis jest BEST-EFFORT i nigdy nie przewraca operacji, którą opisuje. Ta
 * sama zasada co przy `logEvent` w portalEvents.ts i `recordCronRun`
 * w cronRuns.ts: historia ma opisywać przebieg, a nie decydować o nim.
 * Klient, któremu nie udało się przeciągnąć karty, bo padł zapis do dziennika,
 * miałby awarię z powodu funkcji, o której istnieniu nie wie.
 */

/** Skąd przyszła zmiana. */
export type StatusSource = 'webhook' | 'portal'

export type StatusChange = {
  portalId: string
  clickupTaskId: string
  taskName: string
  /** Null = nie znamy stanu poprzedniego. */
  fromStatus: string | null
  toStatus: string
  source: StatusSource
  /** Konto w portalu; null dla zmian zespołu w ClickUpie. */
  actorUserId?: string | null
  actorLabel?: string | null
  /** Czas wg ŹRÓDŁA. Webhook bywa opóźniony, więc nie zawsze `now()`. */
  changedAt?: Date
}

/**
 * Zapisuje zmianę statusu. Nie rzuca — patrz nagłówek modułu.
 *
 * Zwraca `true` przy zapisie, `false` przy porażce, żeby wołający MÓGŁ
 * zareagować, jeśli chce. Żaden dziś nie chce i to jest w porządku.
 */
export async function recordStatusChange(change: StatusChange): Promise<boolean> {
  try {
    const changedAt = change.changedAt ?? new Date()

    // Idempotencja po stronie webhooka. ClickUp doręcza zdarzenia AT-LEAST-ONCE,
    // więc ta sama zmiana statusu potrafi przyjść dwa razy; bez sprawdzenia
    // Historia dostawała duplikat wiersza przy każdej ponowie. Kluczem jest
    // pięciorak (portal, zadanie, z, na, czas wg źródła) — dokładnie to, co
    // identyfikuje jedną fizyczną zmianę. Sprawdzenie PRZED insertem zamyka
    // okno na tyle, na ile trzeba: ponowienia ClickUpa przychodzą po sekundach,
    // nie w tej samej milisekundzie, a pełny unikalny indeks wymagałby
    // migracji czyszczącej duplikaty na produkcji.
    const duplikat = await db
      .select({ id: taskStatusHistory.id })
      .from(taskStatusHistory)
      .where(
        and(
          eq(taskStatusHistory.portalId, change.portalId),
          eq(taskStatusHistory.clickupTaskId, change.clickupTaskId),
          change.fromStatus === null
            ? isNull(taskStatusHistory.fromStatus)
            : eq(taskStatusHistory.fromStatus, change.fromStatus),
          eq(taskStatusHistory.toStatus, change.toStatus),
          eq(taskStatusHistory.changedAt, changedAt),
          eq(taskStatusHistory.source, change.source)
        )
      )
      .limit(1)
    if (duplikat.length > 0) return true

    await db.insert(taskStatusHistory).values({
      portalId: change.portalId,
      clickupTaskId: change.clickupTaskId,
      taskName: change.taskName,
      fromStatus: change.fromStatus,
      toStatus: change.toStatus,
      source: change.source,
      actorUserId: change.actorUserId ?? null,
      actorLabel: change.actorLabel ?? null,
      changedAt,
    })
    return true
  } catch (e) {
    console.error('[statusHistory] nie udało się zapisać zmiany statusu:', e)
    return false
  }
}

export type StatusHistoryRow = {
  id: string
  clickupTaskId: string
  taskName: string
  fromStatus: string | null
  toStatus: string
  source: string
  actorLabel: string | null
  changedAt: Date
}

/**
 * Historia projektu albo JEDNEGO zadania, od najnowszej.
 *
 * `portalId` jest zawsze w warunku, także przy podanym zadaniu: identyfikator
 * zadania przychodzi z żądania i nie może sam decydować, czyją historię
 * pokazujemy.
 */
export async function listStatusHistory(options: {
  portalId: string
  clickupTaskId?: string
  limit?: number
}): Promise<StatusHistoryRow[]> {
  const limit = Math.min(Math.max(options.limit ?? 100, 1), 500)

  const filtry = [eq(taskStatusHistory.portalId, options.portalId)]
  if (options.clickupTaskId) {
    filtry.push(eq(taskStatusHistory.clickupTaskId, options.clickupTaskId))
  }

  const rows = await db
    .select()
    .from(taskStatusHistory)
    .where(and(...filtry))
    .orderBy(desc(taskStatusHistory.changedAt))
    .limit(limit)

  return rows.map(r => ({
    id: r.id,
    clickupTaskId: r.clickupTaskId,
    taskName: r.taskName,
    fromStatus: r.fromStatus,
    toStatus: r.toStatus,
    source: r.source,
    actorLabel: r.actorLabel,
    changedAt: r.changedAt,
  }))
}
