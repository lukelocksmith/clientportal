/**
 * Zapis i odczyt powiadomień. Decyzje „kto co dostaje" są w notifications.ts,
 * tutaj jest sam dostęp do bazy.
 *
 * Rozdzielenie jest celowe: reguły da się przetestować bez bazy, a zapytania
 * bez udawania preferencji użytkowników.
 */
import { db } from '@/lib/db'
import { notifications, notifiedEvents, portalUsers } from '@/lib/db/schema'
import { and, eq, inArray, isNull, lt, sql } from 'drizzle-orm'
import type { NotifyKind } from '@/lib/notifications'

export type NewNotification = {
  portalId: string
  userId: string
  kind: NotifyKind
  /**
   * Czy pokazać w dzwonku. `false` znaczy „zapisz, ale nie dzwoń": wiersz jest
   * wtedy wyłącznie zapisem, po którym rozpoznajemy powtórkę zdarzenia.
   */
  bellVisible?: boolean
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
        // Domyślnie widoczne: wyłączenie dzwonka jest decyzją wołającego,
        // a nie brakiem pola.
        bellVisible: r.bellVisible ?? true,
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
    .where(and(eq(notifications.userId, userId), isNull(notifications.readAt), eq(notifications.bellVisible, true)))
  return row?.n ?? 0
}

/**
 * Lista pod dzwonkiem, od najnowszych.
 *
 * Wiersze niewidoczne w dzwonku (`bell_visible = false`) wypadają: powstały
 * tylko po to, żeby rozpoznać powtórkę zdarzenia, a admin świadomie wyłączył
 * dla nich dzwonek.
 */
export async function listForUser(userId: string, limit = 20) {
  return db
    .select()
    .from(notifications)
    .where(and(eq(notifications.userId, userId), eq(notifications.bellVisible, true)))
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
 * Kasuje WSKAZANE powiadomienia użytkownika. Zwraca liczbę usuniętych.
 *
 * Warunek na `userId` jest w zapytaniu ZAWSZE, tak samo jak w `markRead`:
 * identyfikator przychodzi z przeglądarki, więc nie może sam decydować, czyj
 * wiersz kasujemy. Bez tego znajomość cudzego identyfikatora wystarczyłaby,
 * żeby usunąć komuś powiadomienie.
 *
 * Pusta lista NIE kasuje niczego. To celowe: `markRead` bez `ids` znaczy
 * „wszystkie moje", ale przy kasowaniu ta sama wygoda oznaczałaby, że jedno
 * przeoczone `undefined` czyści klientowi całą historię powiadomień.
 */
export async function deleteForUser(userId: string, ids: string[]): Promise<number> {
  if (ids.length === 0) return 0
  const usuniete = await db
    .delete(notifications)
    .where(and(eq(notifications.userId, userId), inArray(notifications.id, ids)))
    .returning({ id: notifications.id })
  return usuniete.length
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

/**
 * Zajmuje zdarzenie: `true` znaczy „to my je obsługujemy", `false` znaczy
 * „ktoś już je obsłużył, odpuść".
 *
 * ClickUp dostarcza zdarzenia CO NAJMNIEJ RAZ, a webhook przychodzi też przy
 * EDYCJI komentarza. Wcześniej stało tu sprawdzenie `SELECT`-em przed zapisem
 * i miało WYŚCIG: dwa równoległe dostarczenia tego samego zdarzenia oba
 * widziały pustą tabelę i oba wstawiały wiersz. Dokładnie to zobaczył Łukasz
 * 24.08 — każda pozycja w dzwonku dwa razy.
 *
 * Rozstrzyga BAZA, nie kod: unikalny indeks na (portal, klucz) plus
 * `ON CONFLICT DO NOTHING`. Przy równoległych zapisach jeden zwróci wiersz,
 * pozostałe nie zwrócą nic — i to jest jedyna wersja tej bramy, która nie da
 * się oszukać czasem.
 *
 * Klucz jest per ZDARZENIE, nie per odbiorca: jedno zdarzenie zajmuje się raz,
 * niezależnie od tego, ilu ludzi dostanie z niego powiadomienie.
 */
export async function claimEvent(portalId: string, dedupeKey: string): Promise<boolean> {
  const wstawione = await db
    .insert(notifiedEvents)
    .values({ portalId, dedupeKey })
    .onConflictDoNothing({ target: [notifiedEvents.portalId, notifiedEvents.dedupeKey] })
    .returning({ id: notifiedEvents.id })

  return wstawione.length > 0
}

/**
 * Zwalnia wcześniej zajęte zdarzenie.
 *
 * Wołane, gdy obsługa padła PO zajęciu klucza. Bez tego zdarzenie byłoby
 * stracone na zawsze: klucz zostawał zajęty, więc ponowne dostarczenie tego
 * samego zdarzenia przez ClickUpa odbijało się od niego, mimo że klient nigdy
 * nie dostał powiadomienia.
 */
export async function releaseEvent(portalId: string, dedupeKey: string): Promise<void> {
  await db
    .delete(notifiedEvents)
    .where(and(eq(notifiedEvents.portalId, portalId), eq(notifiedEvents.dedupeKey, dedupeKey)))
}

/**
 * Retencja kluczy powtórek: kasuje wpisy starsze niż `days`.
 *
 * Ponowne dostarczenia ClickUpa przychodzą w sekundach, najwyżej minutach, więc
 * klucz sprzed miesiąca nie chroni już przed niczym, a tabela rosłaby z każdym
 * zdarzeniem w każdym projekcie bez końca.
 *
 * WYJĄTEK: klucze `created:` zostają na zawsze. Zadanie powstaje raz w życiu, a
 * ten klucz nie ma w sobie czasu, więc jego skasowanie pozwoliłoby powiadomić
 * o utworzeniu tego samego zadania drugi raz, gdyby ClickUp kiedyś przysłał
 * `taskCreated` ponownie.
 */
export async function purgeOldEventKeys(days = 30): Promise<number> {
  const cutoff = new Date(Date.now() - days * 24 * 60 * 60 * 1000)
  const gone = await db
    .delete(notifiedEvents)
    .where(
      and(
        lt(notifiedEvents.createdAt, cutoff),
        sql`${notifiedEvents.dedupeKey} NOT LIKE 'created:%'`
      )
    )
    .returning({ id: notifiedEvents.id })
  return gone.length
}
