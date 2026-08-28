import { and, eq, inArray } from 'drizzle-orm'
import { db } from './db'
import { taskWatchers, portalUsers } from './db/schema'

/**
 * Obserwatorzy zadania: dostęp do tabeli `task_watchers`.
 *
 * Cała reguła „kto dostaje maila" siedzi dalej w lib/notifications.ts; tutaj
 * jest wyłącznie odczyt i zapis listy. Rozdzielone celowo, bo regułę da się
 * testować bez bazy, a bazy bez reguły.
 *
 * Każde zapytanie jest ZAWĘŻONE DO PORTALU, nie tylko do identyfikatora
 * zadania. Identyfikator zadania z ClickUpa przychodzi z adresu, więc bez tego
 * warunku ktoś z jednego portalu mógłby czytać i dopisywać obserwatorów do
 * cudzej sprawy.
 */

export type Watcher = {
  userId: string
  name: string | null
  email: string
}

/** Obserwatorzy zadania, z nazwami do pokazania. Pusto, gdy nikt nie obserwuje. */
export async function listWatchers(portalId: string, clickupTaskId: string): Promise<Watcher[]> {
  const rows = await db
    .select({ userId: taskWatchers.userId, name: portalUsers.name, email: portalUsers.email })
    .from(taskWatchers)
    .innerJoin(portalUsers, eq(portalUsers.id, taskWatchers.userId))
    .where(and(eq(taskWatchers.portalId, portalId), eq(taskWatchers.clickupTaskId, clickupTaskId)))
  return rows
}

/** Same identyfikatory, dla producenta powiadomień. Lżejsze zapytanie. */
export async function watcherUserIds(portalId: string, clickupTaskId: string): Promise<string[]> {
  const rows = await db
    .select({ userId: taskWatchers.userId })
    .from(taskWatchers)
    .where(and(eq(taskWatchers.portalId, portalId), eq(taskWatchers.clickupTaskId, clickupTaskId)))
  return rows.map(r => r.userId)
}

/**
 * Dopisuje obserwatora. Idempotentne: drugie wywołanie nic nie zmienia.
 *
 * `onConflictDoNothing`, a nie „sprawdź i wstaw": dwa równoległe kliknięcia
 * (albo dwa otwarte okna) trafiają tu jednocześnie, a wtedy sprawdzenie przed
 * wstawieniem nie jest żadnym zabezpieczeniem — rozstrzyga baza, na unikalnym
 * indeksie.
 *
 * Zwraca `false`, gdy wskazane konto nie należy do tego portalu albo jest
 * wyłączone. Wyłączonego konta nie dopisujemy, bo i tak nie dostałoby
 * powiadomienia (patrz `chooseRecipients`), a na liście wyglądałoby jak
 * obietnica, że dostanie.
 */
export async function addWatcher(input: {
  portalId: string
  clickupTaskId: string
  userId: string
  addedBy: string | null
}): Promise<boolean> {
  const [user] = await db
    .select({ id: portalUsers.id, isActive: portalUsers.isActive })
    .from(portalUsers)
    .where(and(eq(portalUsers.id, input.userId), eq(portalUsers.portalId, input.portalId)))
    .limit(1)
  if (!user || user.isActive === false) return false

  await db
    .insert(taskWatchers)
    .values({
      portalId: input.portalId,
      clickupTaskId: input.clickupTaskId,
      userId: input.userId,
      addedBy: input.addedBy,
    })
    .onConflictDoNothing()
  return true
}

/** Zdejmuje obserwatora. Brak wiersza to nie błąd: stan docelowy jest ten sam. */
export async function removeWatcher(portalId: string, clickupTaskId: string, userId: string): Promise<void> {
  await db
    .delete(taskWatchers)
    .where(and(
      eq(taskWatchers.portalId, portalId),
      eq(taskWatchers.clickupTaskId, clickupTaskId),
      eq(taskWatchers.userId, userId),
    ))
}

/** Nasza domena. Konta z niej to zespół, nie klient. */
const DOMENA_AGENCJI = '@important.is'

/**
 * Konta, które klient może dopisać: aktywne i NALEŻĄCE DO KLIENTA.
 *
 * Dwie rzeczy są tu celowe i obie wynikają z tego, że lista idzie prosto do
 * przeglądarki klienta:
 *
 *   1. Pola są WYLICZONE, nie brane całym wierszem. Konto ma też hash hasła,
 *      licznik nieudanych logowań i zdjęcie jako data URI.
 *   2. Konta z naszej domeny są ODSIANE. W portalach klientów bywają konta
 *      zespołu (`hi@`, `admin@`), a lista kandydatów pokazałaby klientowi ich
 *      adresy przy każdym otwarciu zadania. Zespół i tak czyta te sprawy
 *      w ClickUpie, więc nie traci nic, czego by potrzebował.
 *
 * Filtr działa na kandydatach, nie na `listWatchers`: gdyby ktoś z zespołu
 * został kiedyś dopisany, ma być widoczny na liście, którą klient ogląda,
 * zamiast po cichu dostawać kopie niewidzialnie dla niego.
 */
export async function listCandidates(portalId: string): Promise<Watcher[]> {
  const rows = await db
    .select({ userId: portalUsers.id, name: portalUsers.name, email: portalUsers.email })
    .from(portalUsers)
    .where(and(eq(portalUsers.portalId, portalId), eq(portalUsers.isActive, true)))
  return rows.filter(r => !r.email.toLowerCase().endsWith(DOMENA_AGENCJI))
}

/** Nazwy obserwatorów po identyfikatorach — do treści powiadomień, gdy będą potrzebne. */
export async function watcherNames(portalId: string, userIds: readonly string[]): Promise<Map<string, string | null>> {
  if (userIds.length === 0) return new Map()
  const rows = await db
    .select({ id: portalUsers.id, name: portalUsers.name })
    .from(portalUsers)
    .where(and(eq(portalUsers.portalId, portalId), inArray(portalUsers.id, [...userIds])))
  return new Map(rows.map(r => [r.id, r.name]))
}
