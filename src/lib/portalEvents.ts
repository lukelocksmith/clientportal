import { and, desc, eq, sql } from 'drizzle-orm'
import { db } from './db'
import { auditLog } from './db/schema'
import { normalizeActorId } from './reporter'

/**
 * Historia zdarzeń portalu, przypisana do osoby.
 *
 * Zapisujemy tu KAŻDE zgłoszenie: zadanie z formularza, zadanie przez
 * asystenta AI, alarm, komentarz, pomysł. Powód jest praktyczny, nie
 * formalny: ClickUp pokazuje, że zadanie istnieje, ale nie pokazuje, KTO z
 * konkretnych ludzi u klienta je zgłosił, bo wszystkie zgłoszenia z portalu
 * lecą jednym kontem serwisowym agencji. Bez tej tabeli pytanie „kto to
 * zamawiał" nie ma odpowiedzi po naszej stronie.
 *
 * Podział odpowiedzialności z lib/reporter.ts: tam jest czysta logika (kto to
 * jest, jak go podpisać), tutaj zapytania. Ten sam podział, który przy linkach
 * projektu ustawił nam całą aplikację na 500, gdy komponent kliencki wciągnął
 * przez walidację sterownik postgresa.
 */

/** Rodzaje zdarzeń. Wartości trafiają do kolumny `action` i są trwałe. */
export const EVENT_TASK_CREATED = 'task_created'
export const EVENT_PANIC_ALERT = 'panic_alert'
export const EVENT_COMMENT_ADDED = 'comment_added'
/** Zostaje bez zmian: takie wiersze są już w bazie (lib/portalIdeas.ts). */
export const EVENT_PORTAL_IDEA = 'portal_idea'

export type EventAction =
  | typeof EVENT_TASK_CREATED
  | typeof EVENT_PANIC_ALERT
  | typeof EVENT_COMMENT_ADDED
  | typeof EVENT_PORTAL_IDEA

export const EVENT_LABELS: Record<EventAction, string> = {
  [EVENT_TASK_CREATED]: 'Zgłoszenie zadania',
  [EVENT_PANIC_ALERT]: 'Alarm',
  [EVENT_COMMENT_ADDED]: 'Komentarz',
  [EVENT_PORTAL_IDEA]: 'Pomysł na portal',
}

export type EventActor = {
  /** Wartość z sesji. 'admin' jest tu dopuszczalne, normalizujemy niżej. */
  userId: string | null
  email: string | null
  name: string | null
}

export type PortalEvent = {
  id: string
  action: string
  actionLabel: string
  userEmail: string | null
  userName: string | null
  resourceId: string | null
  meta: Record<string, unknown> | null
  createdAt: Date
}

/**
 * Zapisuje zdarzenie. NIGDY nie rzuca wyjątkiem.
 *
 * To jest świadomy wybór, nie niedbalstwo. Zapis historii jest wtórny wobec
 * samego działania: zadanie w ClickUpie w tym momencie już istnieje, więc
 * przewrócenie trasy na błędzie zapisu logu pokazałoby klientowi „nie udało
 * się", a on kliknąłby drugi raz i zgłosił to samo dwa razy. Zgubiony wiersz
 * historii jest tańszy niż zdublowane zadanie w ClickUpie.
 */
export async function logEvent(input: {
  portalId: string
  actor: EventActor
  action: EventAction
  resourceId?: string | null
  meta?: Record<string, unknown> | null
}): Promise<string | null> {
  try {
    const [row] = await db
      .insert(auditLog)
      .values({
        portalId: input.portalId,
        userId: normalizeActorId(input.actor.userId),
        userEmail: input.actor.email,
        userName: input.actor.name,
        action: input.action,
        resourceId: input.resourceId ?? null,
        meta: input.meta ? JSON.stringify(input.meta) : null,
      })
      .returning({ id: auditLog.id })
    return row?.id ?? null
  } catch (e) {
    console.error('[portalEvents] nie udało się zapisać zdarzenia:', e)
    return null
  }
}

/** Dopina identyfikator zasobu, gdy powstaje on już po zapisie zdarzenia. */
export async function attachResourceId(eventId: string | null, resourceId: string): Promise<void> {
  if (!eventId) return
  try {
    await db.update(auditLog).set({ resourceId }).where(eq(auditLog.id, eventId))
  } catch (e) {
    console.error('[portalEvents] nie udało się dopisać resourceId:', e)
  }
}

function parseMeta(raw: string | null): Record<string, unknown> | null {
  if (!raw) return null
  try {
    const parsed = JSON.parse(raw)
    return parsed && typeof parsed === 'object' && !Array.isArray(parsed) ? parsed : null
  } catch {
    // Wiersz sprzed wprowadzenia JSON-a albo ucięty zapis. Brak metadanych nie
    // może przewrócić listy, bo najważniejsze (kto, co, kiedy) jest w kolumnach.
    return null
  }
}

/**
 * Zdarzenia projektu, od najnowszych. Filtr po osobie idzie po ADRESIE, nie po
 * `userId`: adres zostaje po usunięciu konta, a właśnie wtedy historia jest
 * najbardziej potrzebna.
 */
export async function listPortalEvents(options: {
  portalId: string
  limit?: number
  action?: EventAction
  userEmail?: string
}): Promise<PortalEvent[]> {
  const limit = Math.min(Math.max(options.limit ?? 100, 1), 500)

  const filters = [eq(auditLog.portalId, options.portalId)]
  if (options.action) filters.push(eq(auditLog.action, options.action))
  if (options.userEmail) filters.push(eq(auditLog.userEmail, options.userEmail))

  const rows = await db
    .select({
      id: auditLog.id,
      action: auditLog.action,
      userEmail: auditLog.userEmail,
      userName: auditLog.userName,
      resourceId: auditLog.resourceId,
      meta: auditLog.meta,
      createdAt: auditLog.createdAt,
    })
    .from(auditLog)
    .where(and(...filters))
    .orderBy(desc(auditLog.createdAt))
    .limit(limit)

  return rows.map(r => ({
    ...r,
    actionLabel: EVENT_LABELS[r.action as EventAction] ?? r.action,
    meta: parseMeta(r.meta),
  }))
}

/**
 * Osoby, które cokolwiek w tym projekcie zgłosiły, z licznikiem. Zasila listę
 * filtra w panelu i sama jest odpowiedzią na pytanie „kto z ich strony w ogóle
 * korzysta z portalu".
 */
export async function portalEventActors(portalId: string): Promise<
  Array<{ email: string; name: string | null; count: number; lastAt: Date }>
> {
  const rows = await db
    .select({
      email: auditLog.userEmail,
      // Imię mogło się zmienić w czasie; bierzemy najświeższe niepuste.
      name: sql<string | null>`(array_agg(${auditLog.userName} order by ${auditLog.createdAt} desc) filter (where ${auditLog.userName} is not null))[1]`,
      count: sql<number>`count(*)::int`,
      lastAt: sql<Date>`max(${auditLog.createdAt})`,
    })
    .from(auditLog)
    .where(and(eq(auditLog.portalId, portalId), sql`${auditLog.userEmail} is not null`))
    .groupBy(auditLog.userEmail)
    .orderBy(desc(sql`max(${auditLog.createdAt})`))

  return rows
    .filter((r): r is { email: string; name: string | null; count: number; lastAt: Date } => !!r.email)
}
