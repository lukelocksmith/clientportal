/**
 * Zapis i odczyt powiadomień. Decyzje „kto co dostaje" są w notifications.ts,
 * tutaj jest sam dostęp do bazy.
 *
 * Rozdzielenie jest celowe: reguły da się przetestować bez bazy, a zapytania
 * bez udawania preferencji użytkowników.
 */
import { db } from '@/lib/db'
import { notifications, portalUsers } from '@/lib/db/schema'
import { and, eq, inArray, isNull, lt, sql } from 'drizzle-orm'
import type { NotifyKind } from '@/lib/notifications'

export type NewNotification = {
  portalId: string
  userId: string
  kind: NotifyKind
  clickupTaskId?: string | null
  taskName: string
  payload?: Record<string, unknown>
  /** Ustaw, gdy mail poszedł natychmiast: digest ma go wtedy pominąć. */
  emailSentAt?: Date | null
}

/**
 * Wstawia powiadomienia jednym zapytaniem i zwraca utworzone wiersze.
 *
 * Pusta lista NIE jest błędem i nie dotyka bazy: to normalny wynik, gdy
 * jedynym odbiorcą byłby sprawca zdarzenia.
 */
export async function createNotifications(rows: NewNotification[]) {
  if (rows.length === 0) return []
  return db
    .insert(notifications)
    .values(
      rows.map(r => ({
        portalId: r.portalId,
        userId: r.userId,
        kind: r.kind,
        clickupTaskId: r.clickupTaskId ?? null,
        taskName: r.taskName,
        payload: r.payload ?? {},
        emailSentAt: r.emailSentAt ?? null,
      }))
    )
    .returning()
}

/** Licznik przy dzwonku. */
export async function countUnread(userId: string): Promise<number> {
  const [row] = await db
    .select({ n: sql<number>`count(*)::int` })
    .from(notifications)
    .where(and(eq(notifications.userId, userId), isNull(notifications.readAt)))
  return row?.n ?? 0
}

/** Lista pod dzwonkiem, od najnowszych. */
export async function listForUser(userId: string, limit = 20) {
  return db
    .select()
    .from(notifications)
    .where(eq(notifications.userId, userId))
    .orderBy(sql`${notifications.createdAt} desc`)
    .limit(Math.min(Math.max(limit, 1), 50))
}

/**
 * Oznacza jako przeczytane. Bez `ids` bierze wszystkie nieprzeczytane danej
 * osoby (kliknięcie „oznacz wszystkie").
 *
 * Warunek na `userId` jest w zapytaniu ZAWSZE, także przy podanych `ids`:
 * identyfikator powiadomienia przychodzi z przeglądarki, więc nie może sam
 * decydować, czyj wiersz ruszamy.
 */
export async function markRead(userId: string, ids?: string[]) {
  const own = eq(notifications.userId, userId)
  await db
    .update(notifications)
    .set({ readAt: new Date() })
    .where(
      ids && ids.length > 0
        ? and(own, inArray(notifications.id, ids))
        : and(own, isNull(notifications.readAt))
    )
}

/**
 * Powiadomienia czekające na zbiorczy mail, razem z odbiorcą.
 *
 * Bierzemy tylko te bez stempla wysyłki, więc rzecz wysłana natychmiast nigdy
 * nie wróci w digeście. Filtr na tryb `daily` jest po stronie wywołującego,
 * bo grupa zależy od `kind`, a tę logikę trzyma notifications.ts.
 */
export async function pendingDigest() {
  return db
    .select({
      id: notifications.id,
      userId: notifications.userId,
      portalId: notifications.portalId,
      kind: notifications.kind,
      taskName: notifications.taskName,
      clickupTaskId: notifications.clickupTaskId,
      payload: notifications.payload,
      createdAt: notifications.createdAt,
      email: portalUsers.email,
      name: portalUsers.name,
      isActive: portalUsers.isActive,
      notifyImportant: portalUsers.notifyImportant,
      notifyBoard: portalUsers.notifyBoard,
    })
    .from(notifications)
    .innerJoin(portalUsers, eq(portalUsers.id, notifications.userId))
    .where(and(isNull(notifications.emailSentAt), eq(portalUsers.isActive, true)))
    .orderBy(notifications.createdAt)
}

/** Stempel po wysłaniu maila, żeby nic nie poszło dwa razy. */
export async function stampEmailSent(ids: string[]) {
  if (ids.length === 0) return
  await db
    .update(notifications)
    .set({ emailSentAt: new Date() })
    .where(inArray(notifications.id, ids))
}

/**
 * Retencja: kasuje PRZECZYTANE starsze niż `days`.
 *
 * Nieprzeczytane zostają bez względu na wiek. Skasowanie ich znaczyłoby, że
 * sprawa, której klient nie widział, znika mu z dzwonka po cichu, a to gorsze
 * niż kilka zbędnych wierszy w bazie.
 */
export async function purgeOldRead(days = 90): Promise<number> {
  const cutoff = new Date(Date.now() - days * 24 * 60 * 60 * 1000)
  const gone = await db
    .delete(notifications)
    .where(and(sql`${notifications.readAt} is not null`, lt(notifications.readAt, cutoff)))
    .returning({ id: notifications.id })
  return gone.length
}
