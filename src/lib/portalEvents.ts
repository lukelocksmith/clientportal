import { and, desc, eq, gte, inArray, sql } from 'drizzle-orm'
import { db } from './db'
import { auditLog } from './db/schema'
import { normalizeActorId, isAdminActor } from './reporter'

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
/**
 * Zmiana statusu zrobiona Z PORTALU. Logowana od 2026-08-24, wcześniej nie
 * zapisywaliśmy jej nigdzie, więc nie dało się rozpoznać, że powiadomienie o
 * zmianie statusu dotyczy działania samego klienta.
 */
export const EVENT_STATUS_CHANGED = 'status_changed'
/** Zostaje bez zmian: takie wiersze są już w bazie (lib/portalIdeas.ts). */
export const EVENT_PORTAL_IDEA = 'portal_idea'
/**
 * Wejścia do portalu. Do tej pory zostawał po nich jeden znacznik
 * `portal_users.last_login_at`, czyli data OSTATNIEGO wejścia, nadpisywana przy
 * każdym kolejnym. Nie dawało się odpowiedzieć ani „czy on w ogóle tu wchodzi",
 * ani „kiedy był przed tym", a przy pytaniu klienta „nie dostałem dostępu"
 * właśnie to jest potrzebne.
 */
export const EVENT_LOGIN = 'login'
/**
 * Nieudane wejście. Zapisujemy TYLKO wtedy, gdy konto istnieje, bo przy nieznanym
 * adresie nie wiemy, do którego projektu przypisać wiersz. Hasła ani jego części
 * nie zapisujemy nigdzie i nigdy.
 */
export const EVENT_LOGIN_FAILED = 'login_failed'
/** Ustawienie hasła z linku: zaproszenie albo odzyskiwanie. */
export const EVENT_PASSWORD_SET = 'password_set'

export type EventAction =
  | typeof EVENT_TASK_CREATED
  | typeof EVENT_PANIC_ALERT
  | typeof EVENT_COMMENT_ADDED
  | typeof EVENT_STATUS_CHANGED
  | typeof EVENT_PORTAL_IDEA
  | typeof EVENT_LOGIN
  | typeof EVENT_LOGIN_FAILED
  | typeof EVENT_PASSWORD_SET

export const EVENT_LABELS: Record<EventAction, string> = {
  [EVENT_TASK_CREATED]: 'Zgłoszenie zadania',
  [EVENT_PANIC_ALERT]: 'Alarm',
  [EVENT_COMMENT_ADDED]: 'Komentarz',
  [EVENT_STATUS_CHANGED]: 'Zmiana statusu',
  [EVENT_PORTAL_IDEA]: 'Pomysł na portal',
  [EVENT_LOGIN]: 'Logowanie',
  [EVENT_LOGIN_FAILED]: 'Nieudane logowanie',
  [EVENT_PASSWORD_SET]: 'Ustawienie hasła',
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

/**
 * Skąd przyszło żądanie, do metadanych zdarzenia.
 *
 * Bierze `Headers`, a nie `NextRequest`, żeby ten plik nie wciągał Next.js:
 * jest importowany także przez skrypty i testy uruchamiane zwykłym node.
 *
 * `x-forwarded-for` bywa listą adresów dokładaną przez kolejne warstwy proxy.
 * Bierzemy PIERWSZY, bo to adres klienta; ostatni jest adresem naszego własnego
 * proxy i miałby tę samą wartość dla wszystkich, czyli żadnej.
 */
export function requestOrigin(headers: Headers): { ip: string | null; userAgent: string | null } {
  const fwd = headers.get('x-forwarded-for')
  return {
    ip: fwd ? (fwd.split(',')[0]?.trim() || null) : null,
    userAgent: headers.get('user-agent'),
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
 * Kto zgłosił konkretne zadanie, do pokazania KLIENTOWI w szczegółach zadania.
 *
 * Zwraca null, gdy zgłoszenia nie ma w historii, i to jest stan normalny, nie
 * błąd: tak wygląda każde zadanie, które założyliśmy sami w ClickUpie, oraz
 * wszystko sprzed wprowadzenia tej historii. Wołający pokazuje wtedy nas.
 *
 * Sesja admina liczy się jako my, a nie jako klient. Zadanie założone w trybie
 * obejścia ma w historii `admin@important.is`, a podpisanie go klientowi
 * fałszowałoby historię współpracy, na którą powołujemy się przy rozliczeniu.
 */
export async function getTaskReporter(
  portalId: string,
  clickupTaskId: string
): Promise<{ name: string | null; email: string | null; isAgency: boolean } | null> {
  const rows = await db
    .select({ userEmail: auditLog.userEmail, userName: auditLog.userName })
    .from(auditLog)
    .where(
      and(
        eq(auditLog.portalId, portalId),
        eq(auditLog.action, EVENT_TASK_CREATED),
        eq(auditLog.resourceId, clickupTaskId)
      )
    )
    // Najnowszy wiersz, gdyby to samo zadanie trafiło do historii dwa razy.
    .orderBy(desc(auditLog.createdAt))
    .limit(1)

  const row = rows[0]
  if (!row) return null

  const isAgency = isAdminActor({ email: row.userEmail })
  return {
    name: isAgency ? null : row.userName,
    email: isAgency ? null : row.userEmail,
    isAgency,
  }
}

/**
 * Ktore z podanych komentarzy ClickUpa dodal TEN adres e-mail z tego portalu.
 *
 * `resourceId` zdarzenia `comment_added` to identyfikator komentarza w
 * ClickUpie (patrz trasa POST komentarzy), nie zadania — inaczej niz przy
 * `task_created`, gdzie resourceId to id zadania. Dwa rozne znaczenia tej
 * samej kolumny, bo dwa rozne pytania: „kto zglosil to ZADANIE" kontra „kto
 * dodal TEN komentarz", a jeden komentarz nie ma wlasnej tabeli.
 *
 * Do pokazania przyciskow edycji/usuwania wylacznie przy WLASNYCH komentarzach
 * klienta — nie do autoryzacji samej zmiany, ta idzie osobnym zapytaniem w
 * `isCommentOwnedBy` w trasie PUT/DELETE, bo klient nie jest zrodlem prawdy o
 * tym, co wolno mu zrobic.
 */
export async function getOwnedCommentIds(
  portalId: string,
  userEmail: string,
  commentIds: readonly string[]
): Promise<Set<string>> {
  if (commentIds.length === 0) return new Set()
  const rows = await db
    .select({ resourceId: auditLog.resourceId })
    .from(auditLog)
    .where(
      and(
        eq(auditLog.portalId, portalId),
        eq(auditLog.action, EVENT_COMMENT_ADDED),
        eq(auditLog.userEmail, userEmail),
        inArray(auditLog.resourceId, commentIds)
      )
    )
  return new Set(rows.flatMap(r => (r.resourceId ? [r.resourceId] : [])))
}

/** Autoryzacja edycji/usuniecia: czy TEN e-mail dodal WLASNIE ten komentarz. */
export async function isCommentOwnedBy(
  portalId: string,
  commentId: string,
  userEmail: string
): Promise<boolean> {
  const rows = await db
    .select({ id: auditLog.id })
    .from(auditLog)
    .where(
      and(
        eq(auditLog.portalId, portalId),
        eq(auditLog.action, EVENT_COMMENT_ADDED),
        eq(auditLog.resourceId, commentId),
        eq(auditLog.userEmail, userEmail)
      )
    )
    .limit(1)
  return rows.length > 0
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

/**
 * Kto z portalu wykonał daną akcję, jeśli ktokolwiek.
 *
 * Służy WYŁĄCZNIE do tłumienia własnego powiadomienia: klient, który sam
 * napisał komentarz albo sam założył zadanie, nie ma dostawać maila o swoim
 * działaniu. Portal i zespół piszą do ClickUpa jednym kontem serwisowym, więc
 * webhook wraca nierozróżnialny i bez tego zapytania nie da się tego rozdzielić.
 *
 * `null` znaczy „nie my", czyli zdarzenie pochodzi od zespołu w ClickUpie.
 */
export async function actorOfCommentEvent(
  portalId: string,
  clickupCommentId: string
): Promise<string | null> {
  const rows = await db
    .select({ userId: auditLog.userId })
    .from(auditLog)
    .where(
      and(
        eq(auditLog.portalId, portalId),
        eq(auditLog.action, EVENT_COMMENT_ADDED),
        eq(auditLog.resourceId, clickupCommentId)
      )
    )
    .limit(1)

  return rows[0]?.userId ?? null
}

/** Ten sam mechanizm dla założenia zadania: `resourceId` to id zadania. */
export async function actorOfTaskCreated(
  portalId: string,
  clickupTaskId: string
): Promise<string | null> {
  const rows = await db
    .select({ userId: auditLog.userId })
    .from(auditLog)
    .where(
      and(
        eq(auditLog.portalId, portalId),
        eq(auditLog.action, EVENT_TASK_CREATED),
        eq(auditLog.resourceId, clickupTaskId)
      )
    )
    .orderBy(desc(auditLog.createdAt))
    .limit(1)

  return rows[0]?.userId ?? null
}

/**
 * Autor zgłoszenia jako identyfikator konta, nie jako imię.
 *
 * `getTaskReporter` wyżej oddaje imię i adres do POKAZANIA w interfejsie.
 * Powiadomienia potrzebują identyfikatora, bo po nim rozstrzygamy, czyja to
 * sprawa i kto ma dostać maila.
 */
export async function reporterUserId(
  portalId: string,
  clickupTaskId: string
): Promise<string | null> {
  return actorOfTaskCreated(portalId, clickupTaskId)
}

/**
 * Kto z portalu ustawił na tym zadaniu DOKŁADNIE ten status w ostatnich
 * `withinMs` milisekundach.
 *
 * Statusów nie da się stłumić deterministycznie, bo ClickUp nie oddaje w
 * webhooku niczego, co wskazywałoby na nasze żądanie. Okno czasowe porównuje
 * WARTOŚĆ statusu, nie sam fakt ruchu: inaczej zmiana zrobiona przez zespół
 * zaraz po zmianie klienta zostałaby zjedzona jako „własna", a kierunek
 * „klient nie dowiedział się o działaniu zespołu" jest groźniejszy niż
 * „klient zobaczył powiadomienie o sobie".
 */
export async function actorOfRecentStatusChange(input: {
  portalId: string
  clickupTaskId: string
  toStatus: string
  withinMs: number
}): Promise<string | null> {
  const od = new Date(Date.now() - input.withinMs)
  const rows = await db
    .select({ userId: auditLog.userId, meta: auditLog.meta })
    .from(auditLog)
    .where(
      and(
        eq(auditLog.portalId, input.portalId),
        eq(auditLog.action, EVENT_STATUS_CHANGED),
        eq(auditLog.resourceId, input.clickupTaskId),
        gte(auditLog.createdAt, od)
      )
    )
    .orderBy(desc(auditLog.createdAt))
    .limit(5)

  const szukany = input.toStatus.trim().toLowerCase()
  for (const row of rows) {
    // `meta` jest TEKSTEM z JSON-em, nie kolumną jsonb (patrz `logEvent`),
    // więc bez parsowania każde porównanie wychodziło puste i tłumienie nie
    // działało wcale.
    const meta = parseMeta(row.meta)
    const zapisany = typeof meta?.toStatus === 'string' ? meta.toStatus.trim().toLowerCase() : ''
    if (zapisany === szukany) return row.userId ?? null
  }
  return null
}
