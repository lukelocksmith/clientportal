/**
 * KOLEJKA ZGŁOSZEŃ: zgłoszenie klienta nie ginie, gdy ClickUp nie odpowiada.
 *
 * Kontekst i powód istnienia — patrz komentarz przy tabeli `pending_reports`
 * w db/schema.ts. W skrócie: cztery kanały zgłaszania miały jedno miejsce
 * zapisu (ClickUp), więc jego awaria kasowała treść, którą klient nam opisał.
 *
 * Podział pracy w tym pliku:
 *   - `enqueueReport`     — zapamiętaj zgłoszenie, którego nie udało się dowieźć
 *   - `deliverPending`    — dowieź, co czeka (woła cron)
 *   - `nextAttemptDelayMs`/`shouldAlert` — czyste reguły, testowane bez bazy
 *
 * Reguła nadrzędna: NIC w tym pliku nie ma prawa przewrócić trasy zgłoszenia.
 * Kolejka jest siecią bezpieczeństwa, a sieć, która sama zrzuca z liny, jest
 * gorsza od jej braku.
 */
import { and, asc, eq, isNotNull, isNull, lt, lte, sql } from 'drizzle-orm'
import { db } from './db'
import { pendingReports, panicAlerts, portals } from './db/schema'
import { createTask, findTaskByDescriptionMarker } from './clickup'
import { invalidateFolderTasks } from './clickupCache'
import { logEvent, EVENT_TASK_CREATED } from './portalEvents'
import { sendOpsAlert } from './cronRuns'

export type ReportSource = 'form' | 'ai' | 'panic' | 'siteping'

/**
 * Jak daleko w przeszłość szukamy zadania, które mogło już powstać.
 *
 * Sześć godzin: z zapasem pokrywa najdłuższy realny odstęp między pierwszą
 * próbą a dowiezieniem (ponawianie dobija do trzech godzin), a jednocześnie
 * trzyma odpowiedź ClickUpa w rozsądnym rozmiarze. Marker jest jednorazowy,
 * więc szersze okno nic by nie zepsuło poza czasem odpowiedzi.
 */
const DEDUP_WINDOW_MS = 6 * 60 * 60 * 1000

/** Argumenty `createTask`, zapisane na sztywno w chwili zgłoszenia. */
export type QueuedTaskPayload = {
  name: string
  description?: string
  priority?: number | null
  due_date?: number | null
  status?: string
  tags?: string[]
  assignees?: number[]
}

/**
 * Odstępy między próbami: minuta, pięć, piętnaście, godzina, potem co trzy
 * godziny. Pierwsza próba szybko, bo najczęstsza awaria ClickUpa trwa
 * sekundy; dalej rzadziej, żeby przy dłuższej awarii nie dobijać API.
 */
const BACKOFF_MINUTES = [1, 5, 15, 60, 180] as const

export function nextAttemptDelayMs(attempts: number): number {
  const i = Math.min(Math.max(attempts, 1), BACKOFF_MINUTES.length) - 1
  return BACKOFF_MINUTES[i] * 60_000
}

/**
 * Po ilu minutach czekania w kolejce zgłoszenie przestaje być „chwilową
 * awarią ClickUpa" i staje się sprawą dla człowieka.
 *
 * Piętnaście, bo tyle wynosi u nas granica między „API mrugnęło" a „coś jest
 * trwale zepsute": zły token, skasowana lista, zmiana uprawnień. Żadna z tych
 * rzeczy nie naprawi się sama i ponawianie w nieskończoność nikogo o niej nie
 * powiadomi.
 */
export const ALERT_AFTER_MINUTES = 15

export function shouldAlert(row: { createdAt: Date; attempts: number }, now: Date): boolean {
  const czeka = now.getTime() - row.createdAt.getTime()
  return czeka >= ALERT_AFTER_MINUTES * 60_000 && row.attempts >= 2
}

/**
 * Zapamiętuje zgłoszenie, którego nie udało się dowieźć do ClickUpa.
 *
 * Zwraca `true`, gdy trafiło do kolejki. `false` znaczy, że nie udało się
 * nawet to — wtedy wołający MUSI oddać klientowi błąd, bo zgłoszenia nie ma
 * już nigdzie. To jedyna sytuacja, w której klient ma zobaczyć porażkę.
 */
export async function enqueueReport(input: {
  portalId: string
  source: ReportSource
  clickupListId: string
  payload: QueuedTaskPayload
  actor?: { userId?: string | null; email?: string | null; name?: string | null }
  panicAlertId?: string | null
  /**
   * Numer zgłoszenia z opisu zadania (`newReportMarker`). Bez niego dowożenie
   * nie ma jak rozpoznać zadania, które powstało przy pierwszej próbie —
   * czyli okno na duplikat zostaje otwarte.
   */
  marker?: string | null
  /** Dane kanału do dokończenia po dowiezieniu (dziś: zgłoszenie SitePinga). */
  extra?: unknown
  error?: unknown
}): Promise<boolean> {
  try {
    const [row] = await db
      .insert(pendingReports)
      .values({
        portalId: input.portalId,
        source: input.source,
        clickupListId: input.clickupListId,
        payload: input.payload,
        // `userId` bywa łańcuchem 'admin' (obejście admina w lib/auth.ts),
        // a kolumna jest typu uuid — stąd normalizacja u wołającego.
        actorUserId: input.actor?.userId ?? null,
        actorEmail: input.actor?.email ?? null,
        actorName: input.actor?.name ?? null,
        panicAlertId: input.panicAlertId ?? null,
        marker: input.marker ?? null,
        extra: (input.extra ?? null) as never,
        lastError: input.error instanceof Error ? input.error.message : input.error ? String(input.error) : null,
        // Pierwsza próba dowiezienia od razu przy najbliższym przebiegu crona,
        // nie po minucie: awaria ClickUpa najczęściej trwa sekundy.
        nextAttemptAt: new Date(),
      })
      .returning({ id: pendingReports.id })

    console.warn(
      `[kolejka] zgłoszenie (${input.source}) nie weszło do ClickUpa i czeka w kolejce: ${row?.id ?? '?'}`
    )
    return Boolean(row)
  } catch (e) {
    // Baza padła razem z ClickUpem. Nie mamy gdzie tego zapisać, więc jedyna
    // uczciwa rzecz to zostawić ślad w logach i oddać klientowi błąd.
    console.error('[kolejka] NIE UDAŁO SIĘ zapisać zgłoszenia do kolejki:', e)
    return false
  }
}

export type DeliveryResult = {
  processed: number
  delivered: number
  failed: number
  /** Zgłoszenia czekające dłużej niż ALERT_AFTER_MINUTES. */
  stale: number
}

/**
 * Dowozi zgłoszenia z kolejki. Woła cron, więc pracuje w budżecie czasu:
 * `limit` ogranicza liczbę wywołań ClickUpa w jednym przebiegu.
 */
export async function deliverPending(options: { limit?: number; now?: Date } = {}): Promise<DeliveryResult> {
  const limit = Math.min(Math.max(options.limit ?? 20, 1), 100)
  const now = options.now ?? new Date()

  const rows = await db
    .select()
    .from(pendingReports)
    .where(and(isNull(pendingReports.deliveredAt), lte(pendingReports.nextAttemptAt, now)))
    .orderBy(asc(pendingReports.createdAt))
    .limit(limit)

  const wynik: DeliveryResult = { processed: rows.length, delivered: 0, failed: 0, stale: 0 }

  for (const row of rows) {
    const payload = row.payload as QueuedTaskPayload
    try {
      /**
       * NAJPIERW SPRAWDŹ, CZY ZADANIE JUŻ NIE POWSTAŁO.
       *
       * ClickUp mógł przyjąć POST przy pierwszej próbie i nie zdążyć oddać
       * odpowiedzi (timeout, zerwane połączenie, ponowienie po 5xx). Bez tego
       * sprawdzenia dowożenie zakładało drugie zadanie z tej samej sprawy
       * klienta. Marker w opisie jest jednorazowy, więc trafienie jest pewne.
       *
       * Błąd tego zapytania NIE blokuje dowożenia: wtedy wracamy do starego
       * zachowania, czyli ryzykujemy duplikat, a nie stratę zgłoszenia.
       */
      let task: Awaited<ReturnType<typeof createTask>> | null = null
      if (row.marker) {
        const juzIstnieje = await findTaskByDescriptionMarker(
          row.clickupListId,
          row.marker,
          row.createdAt.getTime() - DEDUP_WINDOW_MS
        ).catch(e => {
          console.warn(`[kolejka] nie udało się sprawdzić duplikatu dla ${row.id}:`, e)
          return null
        })
        if (juzIstnieje) {
          console.info(
            `[kolejka] zadanie ${juzIstnieje.id} już istniało (marker ${row.marker}) — zamykam wiersz bez tworzenia kopii`
          )
          task = juzIstnieje
        }
      }

      const bezDuplikatu = task !== null
      if (!task) task = await createTask(row.clickupListId, payload)

      await db
        .update(pendingReports)
        .set({ deliveredAt: new Date(), deliveredTaskId: task.id, lastError: null })
        .where(eq(pendingReports.id, row.id))

      // Alarm: eskalacja pyta ClickUpa o przypisanych po tym identyfikatorze,
      // więc bez tego dowiezione zadanie alarmowe zostałoby poza drabinką.
      if (row.panicAlertId) {
        await db
          .update(panicAlerts)
          .set({ clickupTaskId: task.id })
          .where(eq(panicAlerts.id, row.panicAlertId))
      }

      // Portal ma pokazać dowiezione zadanie od razu, a nie po wygaśnięciu
      // bufora tablicy. Folder pobieramy tu, bo w kolejce trzymamy id portalu,
      // a nie folderu: folder może się w panelu zmienić między zgłoszeniem
      // a dowiezieniem, a unieważnić trzeba TEN, który jest teraz.
      const [portal] = await db
        .select({ folderId: portals.clickupFolderId })
        .from(portals)
        .where(eq(portals.id, row.portalId))
        .limit(1)
      if (portal) await invalidateFolderTasks(portal.folderId)

      /**
       * ZAŁĄCZNIK ZGŁOSZENIA Z WIDGETU dokładamy TERAZ.
       *
       * Zrzut ekranu i pełna diagnostyka wymagają istniejącego zadania, więc
       * przy zgłoszeniu nie było ich gdzie wgrać. Bez tego kroku zgłoszenie
       * dowiezione z kolejki zostawało okaleczone na zawsze, a osoba, która je
       * wysłała ze strony klienta, nie ma konta w portalu i nie wróci sprawdzić.
       *
       * Best-effort: zadanie już istnieje i ma opis, więc nieudany załącznik
       * jest niedogodnością, nie stratą zgłoszenia.
       */
      if (row.source === 'siteping' && row.extra) {
        try {
          const { uploadFeedbackData } = await import('./siteping/store')
          await uploadFeedbackData(task.id, row.extra as Parameters<typeof uploadFeedbackData>[1])
        } catch (e) {
          console.error(`[kolejka] nie udało się dołożyć załącznika SitePinga do ${task.id}:`, e)
        }
      }

      // Zadanie, które JUŻ istniało, ma swój wpis w historii z chwili
      // powstania. Drugi wpis pokazywałby klientowi dwa zgłoszenia z jednego.
      if (!bezDuplikatu) {
        await logEvent({
          portalId: row.portalId,
          actor: { userId: row.actorUserId, email: row.actorEmail ?? '', name: row.actorName },
          action: EVENT_TASK_CREATED,
          resourceId: task.id,
          meta: {
            source: row.source,
            taskName: task.name,
            url: task.url ?? null,
            // Widoczne w historii projektu: to zadanie przyszło z kolejki, czyli
            // przy zgłoszeniu ClickUp nie odpowiedział.
            zKolejki: true,
            czekaloMinut: Math.round((Date.now() - row.createdAt.getTime()) / 60_000),
          },
        })
      }

      wynik.delivered++
      console.info(`[kolejka] dowiezione zgłoszenie ${row.id} → zadanie ${task.id}`)
    } catch (e) {
      const attempts = row.attempts + 1
      await db
        .update(pendingReports)
        .set({
          attempts,
          lastError: e instanceof Error ? e.message : String(e),
          nextAttemptAt: new Date(now.getTime() + nextAttemptDelayMs(attempts)),
        })
        .where(eq(pendingReports.id, row.id))

      wynik.failed++
      if (shouldAlert({ createdAt: row.createdAt, attempts }, now)) {
        wynik.stale++
        await sendOpsAlert(
          `🟠 **Zgłoszenie klienta czeka w kolejce ponad ${ALERT_AFTER_MINUTES} min**\n` +
            `Kanał: \`${row.source}\` · prób: ${attempts}\n` +
            `Treść: ${payload.name}\n` +
            `Błąd: ${e instanceof Error ? e.message : String(e)}\n` +
            `To nie naprawi się samo, jeśli powodem jest token albo skasowana lista.`
        )
      }
    }
  }

  return wynik
}

/** Ile zgłoszeń czeka. Do panelu i do endpointu zdrowia. */
export async function pendingCount(portalId?: string): Promise<number> {
  const filters = [isNull(pendingReports.deliveredAt)]
  if (portalId) filters.push(eq(pendingReports.portalId, portalId))
  const [row] = await db
    .select({ ile: sql<number>`count(*)::int` })
    .from(pendingReports)
    .where(and(...filters))
  return row?.ile ?? 0
}

export type PendingRow = {
  id: string
  source: string
  taskName: string
  attempts: number
  lastError: string | null
  createdAt: Date
  nextAttemptAt: Date
}

/**
 * Zgłoszenia projektu, które CZEKAJĄ na dowiezienie. Do panelu admina.
 *
 * Dowiezione nie wchodzą: te są już zadaniami w ClickUpie i widać je w
 * historii projektu (z `zKolejki: true` w metadanych).
 */
export async function listPendingForPortal(portalId: string): Promise<PendingRow[]> {
  const rows = await db
    .select()
    .from(pendingReports)
    .where(and(eq(pendingReports.portalId, portalId), isNull(pendingReports.deliveredAt)))
    .orderBy(asc(pendingReports.createdAt))
    .limit(50)

  return rows.map(r => ({
    id: r.id,
    source: r.source,
    taskName: (r.payload as QueuedTaskPayload)?.name ?? '(bez nazwy)',
    attempts: r.attempts,
    lastError: r.lastError,
    createdAt: r.createdAt,
    nextAttemptAt: r.nextAttemptAt,
  }))
}

/**
 * Ile trzymamy DOWIEZIONE zgłoszenia. Dziewięćdziesiąt dni: tyle wystarcza na
 * pytanie „czy to zgłoszenie faktycznie doszło i kiedy", a zadanie i tak żyje
 * dalej w ClickUpie oraz w historii projektu.
 *
 * Zgłoszeń NIEDOWIEZIONYCH nie usuwamy nigdy. Wiersz, który czeka, jest
 * sprawą klienta, a nie zapisem historycznym.
 */
export const DELIVERED_KEEP_DAYS = 90

export async function prunePending(now = new Date()): Promise<number> {
  const granica = new Date(now.getTime() - DELIVERED_KEEP_DAYS * 86_400_000)
  const usuniete = await db
    .delete(pendingReports)
    .where(and(isNotNull(pendingReports.deliveredAt), lt(pendingReports.deliveredAt, granica)))
    .returning({ id: pendingReports.id })
  return usuniete.length
}
