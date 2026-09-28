import { and, asc, eq, inArray, isNull, or, sql } from 'drizzle-orm'
import { db } from './db'
import { taskIndex } from './db/schema'
import { getFolderTaskHistory, getTask, getTaskComments } from './clickup'
import { getPortalScope } from './portalScopeStore'
import { filterTasksToScope, isListInScope } from './portalScope'
import { computeVisibleIds, hasPortalTag } from './portalVisibility'
import { publicCommentTexts } from './publicComments'
import { syncPublishedComments } from './taskComments'
import { buildSearchText, escapeLikePattern, normalizeQuery } from './textSearch'

/**
 * Przerwa między wywołaniami ClickUpa w pętli po zadaniach. Limit to 100
 * zapytań na minutę na token, a tym samym tokenem chodzi portal klienta.
 * 800 ms daje ~75/min, czyli zapas na ruch użytkowników w tle.
 */
const SYNC_DELAY_MS = Number(process.env.CLICKUP_SYNC_DELAY_MS ?? 800)

function sleep(ms: number): Promise<void> {
  return new Promise(resolve => setTimeout(resolve, ms))
}

function toMs(value: string | number | null | undefined): number | null {
  if (value === null || value === undefined || value === '') return null
  const n = Number(value)
  return Number.isFinite(n) ? n : null
}

export type SyncResult = {
  /** Ile zadań przyszło z ClickUpa. */
  fetched: number
  /** Ile wierszy zapisaliśmy w polach podstawowych. */
  upserted: number
  /** Ile zadań doczytaliśmy pod kątem komentarzy i załączników. */
  contentSynced: number
  /** Ile zadań nadal czeka na doczytanie treści (budżet się skończył). */
  contentPending: number
  /** Ile wierszy usunęliśmy, bo zadania nie ma już w folderze. */
  deleted: number
  /** Czy pobór z ClickUpa został ucięty. Wtedy NIE kasujemy niczego. */
  truncated: boolean
}

/**
 * Synchronizuje lustro zadań jednego portalu.
 *
 * Dwa przebiegi, bo mają zupełnie różny koszt:
 *
 * 1. Pola podstawowe (nazwa, opis, status, daty) przychodzą darmowo razem
 *    z listą zadań, więc odświeżamy je za każdym razem, dla wszystkich zadań.
 * 2. Komentarze i załączniki wymagają DWÓCH wywołań na zadanie, bo ClickUp
 *    nie zwraca ich w liście. Robimy je tylko dla zadań zmienionych od
 *    ostatniego doczytania, i tylko do wyczerpania budżetu.
 *
 * Budżet sprawia, że pierwszy przebieg (backfill) nie musi zmieścić się w
 * jednym żądaniu HTTP. Wołający uruchamia crona kilka razy, a `contentPending`
 * mówi, ile jeszcze zostało. To zamiast skryptu odpalanego z laptopa przeciw
 * produkcyjnej bazie.
 *
 * `forceContent` ignoruje `contentSyncedAt` i przebudowuje treść wszystkiego.
 * Jest OBOWIĄZKOWY raz na tydzień: gdy ktoś zdejmie prefiks [PUBLIC] z
 * komentarza w ClickUpie, `date_updated` zadania niekoniecznie się rusza, więc
 * przebieg przyrostowy nigdy by tej zmiany nie zauważył i wycofana treść
 * zostałaby w indeksie na zawsze.
 */
export async function syncPortalIndex(
  portal: { id: string; clickupFolderId: string },
  options: { budget?: number; forceContent?: boolean } = {}
): Promise<SyncResult> {
  const budget = options.budget ?? 40
  const { tasks: wszystkie, truncated } = await getFolderTaskHistory(portal.clickupFolderId)

  // ClickUp zwraca caly folder, wiec do indeksu wpuszczamy tylko listy nalezace
  // do portalu. Inaczej wyszukiwarka i Historia pokazywalyby klientowi zadania
  // z list, ktorych mu nie udostepnilismy.
  //
  // Filtrujemy PO pobraniu, bo `truncated` dotyczy pobrania z ClickUpa i musi
  // zostac policzone na pelnym zbiorze: rekoncyliacja usuwa wiersze nieobecne
  // w odpowiedzi, wiec ucieta odpowiedz nie moze uchodzic za kompletna.
  const scope = await getPortalScope(portal.id)
  const tasks = filterTasksToScope(wszystkie, scope)

  // Widoczność po tagu `portal` (lib/portalVisibility.ts), liczona na PEŁNYM
  // zbiorze, bo tag może stać na przodku. Zapisujemy ją zawsze, niezależnie
  // od flagi projektu: zapytania Historii same sprawdzają flagę, więc jej
  // przełączenie działa od razu, bez przebudowy lustra.
  const visibleIds = computeVisibleIds(
    wszystkie.map(t => ({ id: t.id, parentId: t.parent ?? null, hasTag: hasPortalTag(t) }))
  )

  // Liczba podzadań per rodzic. Podzadania trzymamy w indeksie (żeby
  // wyszukiwarka je znajdowała), ale w tabeli Historii pokazujemy tylko
  // zadania nadrzędne z licznikiem.
  const childCount = new Map<string, number>()
  for (const task of tasks) {
    if (task.parent) childCount.set(task.parent, (childCount.get(task.parent) ?? 0) + 1)
  }

  let upserted = 0
  if (tasks.length > 0) {
    const rows = tasks.map(task => ({
      portalId: portal.id,
      clickupTaskId: task.id,
      name: task.name,
      description: task.text_content ?? null,
      status: task.status?.status ?? 'nieznany',
      statusType: task.status?.type ?? 'open',
      priority: task.priority?.priority ?? null,
      listName: task.list?.name ?? null,
      parentId: task.parent ?? null,
      url: task.url ?? null,
      dateCreated: toMs(task.date_created) ?? 0,
      dateUpdated: toMs(task.date_updated) ?? 0,
      dateClosed: toMs(task.date_closed),
      subtaskCount: childCount.get(task.id) ?? 0,
      hasPortalTag: hasPortalTag(task),
      portalVisible: visibleIds.has(task.id),
      // Tylko przy INSERT. Dzięki temu nowe zadanie jest przeszukiwalne po
      // nazwie i opisie od razu, nie dopiero po doczytaniu treści.
      searchText: buildSearchText({ name: task.name, description: task.text_content }),
    }))

    // Zbiorczy upsert, nie pętla round-tripów. Porcje po 200, żeby nie
    // przekroczyć limitu parametrów zapytania.
    for (let i = 0; i < rows.length; i += 200) {
      const chunk = rows.slice(i, i + 200)
      await db
        .insert(taskIndex)
        .values(chunk)
        .onConflictDoUpdate({
          target: [taskIndex.portalId, taskIndex.clickupTaskId],
          // searchText, contentSyncedAt, attachmentCount i publicCommentCount
          // celowo POMINIĘTE: należą do przebiegu treści i nadpisanie ich tutaj
          // wymazałoby zindeksowane komentarze przy każdej synchronizacji.
          set: {
            name: sql`excluded.name`,
            description: sql`excluded.description`,
            status: sql`excluded.status`,
            statusType: sql`excluded.status_type`,
            priority: sql`excluded.priority`,
            listName: sql`excluded.list_name`,
            parentId: sql`excluded.parent_id`,
            url: sql`excluded.url`,
            dateCreated: sql`excluded.date_created`,
            dateUpdated: sql`excluded.date_updated`,
            dateClosed: sql`excluded.date_closed`,
            subtaskCount: sql`excluded.subtask_count`,
            hasPortalTag: sql`excluded.has_portal_tag`,
            portalVisible: sql`excluded.portal_visible`,
            indexedAt: new Date(),
          },
        })
      upserted += chunk.length
    }
  }

  // Rekoncyliacja. To NIE jest higiena, to bezpieczeństwo: zadanie przeniesione
  // z folderu tego klienta do folderu innego zostawiłoby tu przeszukiwalną
  // kopię nazwy i opisu obcego zadania.
  //
  // Kasujemy tylko wtedy, gdy pobór był kompletny. Przy uciętym poborze
  // brakujące zadania wyglądają jak usunięte i wymazalibyśmy historię klienta.
  let deleted = 0
  if (!truncated) {
    const ids = tasks.map(t => t.id)
    const stale = await db
      .select({ id: taskIndex.id, clickupTaskId: taskIndex.clickupTaskId })
      .from(taskIndex)
      .where(eq(taskIndex.portalId, portal.id))

    const live = new Set(ids)
    const toDelete = stale.filter(row => !live.has(row.clickupTaskId)).map(row => row.id)
    if (toDelete.length > 0) {
      for (let i = 0; i < toDelete.length; i += 200) {
        await db.delete(taskIndex).where(inArray(taskIndex.id, toDelete.slice(i, i + 200)))
      }
      deleted = toDelete.length
      console.warn(`[taskIndex] usunięto ${deleted} wierszy nieobecnych już w folderze`)
    }
  }

  // Przebieg treści: komentarze i załączniki.
  const needsContent = await db
    .select({ clickupTaskId: taskIndex.clickupTaskId, name: taskIndex.name, description: taskIndex.description })
    .from(taskIndex)
    .where(
      options.forceContent
        ? eq(taskIndex.portalId, portal.id)
        : and(
            eq(taskIndex.portalId, portal.id),
            or(
              isNull(taskIndex.contentSyncedAt),
              // `date_updated` jest w milisekundach, kolumna czasu w timestampie.
              sql`${taskIndex.dateUpdated} > (extract(epoch from ${taskIndex.contentSyncedAt}) * 1000)`
            )
          )
    )
    .orderBy(asc(taskIndex.dateCreated))

  const batch = needsContent.slice(0, budget)
  let contentSynced = 0

  for (const row of batch) {
    try {
      // Załączniki są tylko w GET /task/{id}, endpointy listowe ich nie zwracają.
      const [full, comments] = await Promise.all([
        getTask(row.clickupTaskId),
        getTaskComments(row.clickupTaskId),
      ])

      // publicCommentTexts przepuszcza WYŁĄCZNIE komentarze z prefiksem
      // [PUBLIC]. Wewnętrzna korespondencja zespołu nigdy nie dotyka indeksu.
      const publicComments = publicCommentTexts(comments)
      const attachmentNames = (full.attachments ?? []).map(a => a.title).filter(Boolean)

      await db
        .update(taskIndex)
        .set({
          attachmentCount: attachmentNames.length,
          publicCommentCount: publicComments.length,
          searchText: buildSearchText({
            name: full.name ?? row.name,
            description: full.text_content ?? row.description,
            publicComments,
            attachmentNames,
          }),
          contentSyncedAt: new Date(),
          indexedAt: new Date(),
        })
        .where(and(eq(taskIndex.portalId, portal.id), eq(taskIndex.clickupTaskId, row.clickupTaskId)))

      // Ten sam przelot po komentarzach karmi drugi cel: tabelę task_comments
      // (krok 1 zejścia z ClickUpa). Osobny try/catch, żeby awaria zapisu tam
      // nie cofnęła już zapisanego indeksu wyszukiwania.
      try {
        await syncPublishedComments(portal.id, row.clickupTaskId, comments)
      } catch (e) {
        console.error(`[taskIndex] sync task_comments dla ${row.clickupTaskId} nie powiódł się:`, e)
      }

      contentSynced++
    } catch (e) {
      // Jedno zadanie nie może wywalić całego przebiegu. Bez ustawienia
      // contentSyncedAt zadanie wróci do kolejki przy następnym przebiegu.
      console.error(`[taskIndex] nie udało się doczytać zadania ${row.clickupTaskId}:`, e)
    }

    if (SYNC_DELAY_MS > 0) await sleep(SYNC_DELAY_MS)
  }

  return {
    fetched: tasks.length,
    upserted,
    contentSynced,
    contentPending: Math.max(needsContent.length - contentSynced, 0),
    deleted,
    truncated,
  }
}

/**
 * Pojedyncze zadanie, dla ścieżki webhooka. Tania aktualizacja jednego wiersza
 * zamiast przelotu po całym folderze, żeby zadanie utworzone przez czat AI
 * pojawiło się w Historii od razu, a nie po nocnym cronie.
 */
export async function indexSingleTask(portalId: string, taskId: string): Promise<boolean> {
  try {
    const full = await getTask(taskId)

    // Granica zakresu, ta sama co w syncPortalIndex. Webhook ustala portal po
    // folderze, a folder moze zawierac listy SPOZA zakresu portalu (patrz
    // komentarz przy portalScope.ts): bez tego sprawdzenia zadanie z listy,
    // ktorej klientowi nie udostepniono, trafialoby do jego Historii i
    // wyszukiwarki az do nastepnego przebiegu crona.
    //
    // Sprawdzamy PRZED doczytaniem komentarzy, zeby nie placic wywolaniami
    // ClickUpa za zadanie, ktorego i tak nie zaindeksujemy.
    const scope = await getPortalScope(portalId)
    if (!isListInScope(full.list?.id, scope)) {
      // Gdyby zadanie bylo wczesniej w indeksie (przeniesienie na liste spoza
      // zakresu), musi z niego wypasc — ta sama zasada co dla folderow obcych.
      await removeTaskFromIndex(portalId, taskId)
      return false
    }

    const comments = await getTaskComments(taskId)
    const publicComments = publicCommentTexts(comments)
    const attachmentNames = (full.attachments ?? []).map(a => a.title).filter(Boolean)

    // Ścieżka webhooka: dowolna zmiana zadania (nie tylko komentarz) dociąga
    // komentarze i tak, więc to jest realny „prawie od razu" punkt wciągania
    // do task_comments, zanim jeszcze ruszy subskrypcja webhooka dedykowana
    // komentarzom. Awaria nie może zablokować indeksu wyszukiwania.
    try {
      await syncPublishedComments(portalId, taskId, comments)
    } catch (e) {
      console.error(`[taskIndex] sync task_comments dla ${taskId} nie powiódł się:`, e)
    }

    await db
      .insert(taskIndex)
      .values({
        portalId,
        clickupTaskId: full.id,
        name: full.name,
        description: full.text_content ?? null,
        status: full.status?.status ?? 'nieznany',
        statusType: full.status?.type ?? 'open',
        priority: full.priority?.priority ?? null,
        listName: full.list?.name ?? null,
        parentId: full.parent ?? null,
        url: full.url ?? null,
        dateCreated: toMs(full.date_created) ?? 0,
        dateUpdated: toMs(full.date_updated) ?? 0,
        dateClosed: toMs(full.date_closed),
        hasPortalTag: hasPortalTag(full),
        attachmentCount: attachmentNames.length,
        publicCommentCount: publicComments.length,
        searchText: buildSearchText({
          name: full.name,
          description: full.text_content,
          publicComments,
          attachmentNames,
        }),
        contentSyncedAt: new Date(),
      })
      .onConflictDoUpdate({
        target: [taskIndex.portalId, taskIndex.clickupTaskId],
        set: {
          name: sql`excluded.name`,
          description: sql`excluded.description`,
          status: sql`excluded.status`,
          statusType: sql`excluded.status_type`,
          priority: sql`excluded.priority`,
          listName: sql`excluded.list_name`,
          parentId: sql`excluded.parent_id`,
          url: sql`excluded.url`,
          dateUpdated: sql`excluded.date_updated`,
          dateClosed: sql`excluded.date_closed`,
          hasPortalTag: sql`excluded.has_portal_tag`,
          attachmentCount: sql`excluded.attachment_count`,
          publicCommentCount: sql`excluded.public_comment_count`,
          searchText: sql`excluded.search_text`,
          contentSyncedAt: sql`excluded.content_synced_at`,
          indexedAt: new Date(),
        },
      })

    // Tag mógł się zmienić na tym zadaniu, a od niego zależy widoczność całego
    // poddrzewa. Przeliczamy portal z lustra, bez wywołań ClickUpa.
    await recomputePortalVisibility(portalId)

    return true
  } catch (e) {
    console.error(`[taskIndex] indexSingleTask ${taskId} nie powiodło się:`, e)
    return false
  }
}

/**
 * Przelicza `portal_visible` dla całego portalu z samych danych lustra
 * (`has_portal_tag` + `parent_id`). Zapisuje tylko wiersze, którym wartość się
 * zmieniła. Tanie: jedno zapytanie po kilkaset do półtora tysiąca wierszy.
 *
 * Potrzebne na ścieżce webhooka: zdjęcie albo dodanie tagu na RODZICU zmienia
 * widoczność podzadań, które same żadnego zdarzenia nie dostały.
 */
export async function recomputePortalVisibility(portalId: string): Promise<number> {
  const rows = await db
    .select({
      id: taskIndex.clickupTaskId,
      parentId: taskIndex.parentId,
      hasTag: taskIndex.hasPortalTag,
      visible: taskIndex.portalVisible,
    })
    .from(taskIndex)
    .where(eq(taskIndex.portalId, portalId))

  const visibleIds = computeVisibleIds(rows)
  const toShow = rows.filter(r => !r.visible && visibleIds.has(r.id)).map(r => r.id)
  const toHide = rows.filter(r => r.visible && !visibleIds.has(r.id)).map(r => r.id)

  for (const [ids, value] of [[toShow, true], [toHide, false]] as const) {
    for (let i = 0; i < ids.length; i += 200) {
      await db
        .update(taskIndex)
        .set({ portalVisible: value })
        .where(and(eq(taskIndex.portalId, portalId), inArray(taskIndex.clickupTaskId, ids.slice(i, i + 200))))
    }
  }
  return toShow.length + toHide.length
}

/**
 * Czy zadanie jest widoczne dla klienta według lustra: flaga projektu
 * wyłączona albo `portal_visible`. Brak wiersza = niewidoczne. Używane przez
 * webhook, żeby nie wysyłać klientowi powiadomień o ukrytych zadaniach.
 */
export async function isIndexedTaskVisible(portalId: string, taskId: string): Promise<boolean> {
  const rows = await db.execute<{ ok: boolean }>(sql`
    SELECT ${visibleIn('t')} AS ok
    FROM task_index t
    WHERE t.portal_id = ${portalId} AND t.clickup_task_id = ${taskId}
    LIMIT 1
  `)
  return rows[0]?.ok === true
}

/** Usuwa jeden wiersz, dla zdarzenia taskDeleted z webhooka. */
export async function removeTaskFromIndex(portalId: string, taskId: string): Promise<void> {
  await db
    .delete(taskIndex)
    .where(and(eq(taskIndex.portalId, portalId), eq(taskIndex.clickupTaskId, taskId)))
}

// ---------------------------------------------------------------------------
// Zapytania pod widok Historii
// ---------------------------------------------------------------------------

/**
 * Co uznajemy za wiersz tabeli Historii: zadanie bez rodzica ALBO sierotę,
 * czyli podzadanie, którego rodzica nie ma w indeksie (rodzic leży poza
 * folderem klienta). Bez drugiego warunku takie zadanie byłoby niewidoczne.
 * Tak samo zachowuje się buildTaskTree dla kanbanu, więc oba widoki są spójne.
 *
 * Wyciągnięte do stałej, bo używają tego DWA zapytania: lista i liczniki przy
 * filtrach. Dwie osobne definicje dawały licznik „Zrobione 12" przy trzynastu
 * wierszach po kliknięciu, czyli widoczny dla klienta rozjazd.
 *
 * Zakłada alias tabeli `t` i, w podzapytaniu, `p`.
 */
/**
 * Czy wiersz o podanym aliasie jest widoczny dla klienta: projekt NIE ma
 * włączonego `portal_tag_only` ALBO zadanie ma `portal_visible` (własny tag
 * `portal` lub tag przodka, lib/portalVisibility.ts).
 *
 * Flaga jest czytana w zapytaniu, a nie przekazywana z wywołującego: każde
 * zapytanie o lustro dostaje ten warunek w jednym miejscu i nie da się go
 * zapomnieć przy nowym wywołaniu. Alias jest stałą z kodu, nigdy z wejścia.
 */
function visibleIn(alias: 't' | 'p' | 'c') {
  return sql.raw(
    `(${alias}.portal_visible OR NOT COALESCE((SELECT pp.portal_tag_only FROM portals pp WHERE pp.id = ${alias}.portal_id), false))`
  )
}

/**
 * Rodzic liczy się tylko wtedy, gdy klient go widzi. Podzadanie z własnym
 * tagiem `portal` pod ukrytym rodzicem jest więc wierszem głównym, tak samo
 * jak na tablicy (filterTaskTreeToPortal). Przy wyłączonej fladze `visibleIn`
 * jest zawsze prawdą i warunek działa jak dawniej.
 */
const IS_ROOT_TASK = sql`(
  t.parent_id IS NULL
  OR NOT EXISTS (
    SELECT 1 FROM task_index p
    WHERE p.portal_id = t.portal_id AND p.clickup_task_id = t.parent_id
      AND ${visibleIn('p')}
  )
)`

export type HistoryRow = {
  clickupTaskId: string
  name: string
  status: string
  statusType: string
  priority: string | null
  dateCreated: number
  dateClosed: number | null
  attachmentCount: number
  publicCommentCount: number
  subtaskCount: number
  /**
   * Nazwy podzadań, w których trafiła fraza. Puste, gdy trafiło samo zadanie.
   * Bez tego klient widziałby wiersz bez szukanego słowa i uznał to za błąd.
   */
  matchedSubtasks: string[]
}

export type HistoryFilters = {
  q?: string | null
  /** Nazwa statusu, dokładnie jak w ClickUpie. */
  status?: string | null
  priority?: string | null
  /** Tylko zamknięte albo tylko otwarte. */
  onlyClosed?: boolean
  onlyOpen?: boolean
  limit?: number
  /** Kursor `${dateCreated}_${clickupTaskId}` z poprzedniej strony. */
  cursor?: string | null
}

export type HistoryPage = {
  rows: HistoryRow[]
  /** Kursor następnej strony albo null, gdy to koniec. */
  nextCursor: string | null
  /** Liczba zadań nadrzędnych spełniających filtry, bez stronicowania. */
  total: number
}

function parseCursor(cursor: string | null | undefined): { dateCreated: number; taskId: string } | null {
  if (!cursor) return null
  const idx = cursor.indexOf('_')
  if (idx < 1) return null
  const dateCreated = Number(cursor.slice(0, idx))
  const taskId = cursor.slice(idx + 1)
  if (!Number.isFinite(dateCreated) || taskId.length === 0) return null
  return { dateCreated, taskId }
}

/**
 * Lista zgłoszeń, chronologicznie od najnowszych, z filtrami i szukaniem.
 *
 * Trzy rzeczy warte uwagi:
 *
 * 1. Wiersze to zadania nadrzędne. Za nadrzędne uznajemy też sierotę, czyli
 *    podzadanie, którego rodzica nie ma w indeksie (rodzic poza folderem).
 *    Inaczej takie zadanie byłoby niewidoczne. Tak samo robi buildTaskTree
 *    dla kanbanu, więc oba widoki są spójne.
 * 2. Fraza szuka też w podzadaniach, ale wynikiem jest wiersz RODZICA, wraz
 *    z nazwami trafionych podzadań.
 * 3. Stronicowanie jest kursorowe, po (date_created, clickup_task_id), nie po
 *    OFFSET. Przy OFFSET dopisanie zadań przez crona przesuwałoby stronę pod
 *    klientem, który widziałby te same wiersze dwa razy albo pomijał inne.
 *
 * `portalId` pochodzi z sesji, nigdy z URL-a. To granica między klientami.
 */
export async function queryHistory(
  portalId: string,
  filters: HistoryFilters = {}
): Promise<HistoryPage> {
  const limit = Math.min(Math.max(filters.limit ?? 25, 1), 100)
  const q = normalizeQuery(filters.q)
  const pattern = q ? `%${escapeLikePattern(q)}%` : null

  const conditions = [sql`t.portal_id = ${portalId}`, visibleIn('t'), IS_ROOT_TASK]

  if (pattern) {
    // Trafienie w samym zadaniu albo w którymkolwiek z jego podzadań.
    conditions.push(sql`(
      t.search_text LIKE ${pattern}
      OR EXISTS (
        SELECT 1 FROM task_index c
        WHERE c.portal_id = t.portal_id
          AND c.parent_id = t.clickup_task_id
          AND ${visibleIn('c')}
          AND c.search_text LIKE ${pattern}
      )
    )`)
  }

  if (filters.status) conditions.push(sql`t.status = ${filters.status}`)
  if (filters.priority) conditions.push(sql`t.priority = ${filters.priority}`)
  if (filters.onlyClosed) conditions.push(sql`t.status_type IN ('done', 'closed')`)
  if (filters.onlyOpen) conditions.push(sql`t.status_type NOT IN ('done', 'closed')`)

  const where = sql.join(conditions, sql` AND `)

  const countRows = await db.execute<{ total: string }>(
    sql`SELECT count(*)::text AS total FROM task_index t WHERE ${where}`
  )
  const total = Number(countRows[0]?.total ?? 0)

  // Kursor dokłada się dopiero tutaj, żeby licznik dotyczył całego zbioru.
  const cursor = parseCursor(filters.cursor)
  const paged = cursor
    ? sql`${where} AND (t.date_created, t.clickup_task_id) < (${cursor.dateCreated}, ${cursor.taskId})`
    : where

  // limit + 1, żeby wiedzieć, czy jest następna strona, bez drugiego zapytania.
  const rows = await db.execute<{
    clickup_task_id: string
    name: string
    status: string
    status_type: string
    priority: string | null
    date_created: string
    date_closed: string | null
    attachment_count: number
    public_comment_count: number
    subtask_count: number
  }>(sql`
    SELECT t.clickup_task_id, t.name, t.status, t.status_type, t.priority,
           t.date_created::text, t.date_closed::text,
           t.attachment_count, t.public_comment_count, t.subtask_count
    FROM task_index t
    WHERE ${paged}
    ORDER BY t.date_created DESC, t.clickup_task_id DESC
    LIMIT ${limit + 1}
  `)

  const hasMore = rows.length > limit
  const visible = hasMore ? rows.slice(0, limit) : rows

  // Nazwy trafionych podzadań, jednym zapytaniem dla całej strony.
  const matchedByParent = new Map<string, string[]>()
  if (pattern && visible.length > 0) {
    const parentIds = visible.map(r => r.clickup_task_id)
    const subs = await db.execute<{ parent_id: string; name: string }>(sql`
      SELECT c.parent_id, c.name
      FROM task_index c
      WHERE c.portal_id = ${portalId}
        AND c.parent_id IN (${sql.join(parentIds.map(id => sql`${id}`), sql`, `)})
        AND ${visibleIn('c')}
        AND c.search_text LIKE ${pattern}
      ORDER BY c.date_created DESC
    `)
    for (const sub of subs) {
      const list = matchedByParent.get(sub.parent_id) ?? []
      list.push(sub.name)
      matchedByParent.set(sub.parent_id, list)
    }
  }

  return {
    rows: visible.map(r => ({
      clickupTaskId: r.clickup_task_id,
      name: r.name,
      status: r.status,
      statusType: r.status_type,
      priority: r.priority,
      dateCreated: Number(r.date_created),
      dateClosed: r.date_closed === null ? null : Number(r.date_closed),
      attachmentCount: Number(r.attachment_count),
      publicCommentCount: Number(r.public_comment_count),
      subtaskCount: Number(r.subtask_count),
      // Trafione podzadania doklejamy ZAWSZE, także gdy fraza jest również w
      // samym zadaniu. Wyglądałoby to na szum tylko wtedy, gdyby dopasowanie
      // rodzica było widoczne w wierszu, a nie jest: fraza mogła trafić w jego
      // opis albo komentarz [PUBLIC], których tabela nie pokazuje. Ukrywanie
      // adnotacji w takim przypadku zostawiałoby klienta z wierszem bez
      // widocznego uzasadnienia, czyli z dokładnie tym problemem, który
      // adnotacja ma rozwiązywać.
      matchedSubtasks: matchedByParent.get(r.clickup_task_id) ?? [],
    })),
    nextCursor: hasMore
      ? `${visible[visible.length - 1].date_created}_${visible[visible.length - 1].clickup_task_id}`
      : null,
    total,
  }
}

/**
 * Ostatnio domknięte zgłoszenia, pod blok „Ostatnia aktywność" na Dashboardzie.
 *
 * Świadomie tylko domknięte i tylko lista, bez żadnych liczb. Licznik typu
 * „w tym miesiącu zamknęliśmy 12" rozjechałby się z kanbanem, który liczy na
 * żywo z ClickUpa, a lustro ma stan z ostatniej synchronizacji. Lista pozycji
 * takiego problemu nie ma: jest albo jej nie ma.
 *
 * `date_closed` bierzemy z ClickUpa i dla części zadań bywa puste (status
 * zmieniony bez domknięcia), dlatego warunek jest na NOT NULL, a nie na
 * `status_type`. Inaczej w bloku pojawiałyby się pozycje bez daty.
 */
export async function getRecentlyClosed(
  portalId: string,
  limit = 5
): Promise<Array<{ clickupTaskId: string; name: string; status: string; dateClosed: number }>> {
  const rows = await db.execute<{
    clickup_task_id: string
    name: string
    status: string
    date_closed: string
  }>(sql`
    SELECT t.clickup_task_id, t.name, t.status, t.date_closed::text
    FROM task_index t
    WHERE t.portal_id = ${portalId}
      AND t.date_closed IS NOT NULL
      AND ${visibleIn('t')}
      AND ${IS_ROOT_TASK}
    ORDER BY t.date_closed DESC
    LIMIT ${Math.min(Math.max(limit, 1), 20)}
  `)

  return rows.map(r => ({
    clickupTaskId: r.clickup_task_id,
    name: r.name,
    status: r.status,
    dateClosed: Number(r.date_closed),
  }))
}

/** Statusy i priorytety obecne w indeksie portalu, do zasilenia filtrów. */
export async function getHistoryFacets(portalId: string): Promise<{
  statuses: Array<{ status: string; count: number }>
  priorities: Array<{ priority: string; count: number }>
  indexedCount: number
}> {
  // Ta sama definicja wiersza co w queryHistory (IS_ROOT_TASK). Wcześniej było
  // tu `parent_id IS NULL`, co przy sierocie dawało licznik „Zrobione 12" i
  // trzynaście wierszy po kliknięciu, czyli rozjazd widoczny dla klienta.
  const statuses = await db.execute<{ status: string; count: string }>(sql`
    SELECT t.status, count(*)::text AS count
    FROM task_index t
    WHERE t.portal_id = ${portalId} AND ${visibleIn('t')} AND ${IS_ROOT_TASK}
    GROUP BY t.status
    ORDER BY count(*) DESC
  `)
  const priorities = await db.execute<{ priority: string; count: string }>(sql`
    SELECT t.priority, count(*)::text AS count
    FROM task_index t
    WHERE t.portal_id = ${portalId} AND ${visibleIn('t')} AND ${IS_ROOT_TASK} AND t.priority IS NOT NULL
    GROUP BY t.priority
    ORDER BY count(*) DESC
  `)
  const total = await db.execute<{ count: string }>(sql`
    SELECT count(*)::text AS count FROM task_index t WHERE t.portal_id = ${portalId} AND ${visibleIn('t')}
  `)

  return {
    statuses: statuses.map(s => ({ status: s.status, count: Number(s.count) })),
    priorities: priorities.map(p => ({ priority: p.priority, count: Number(p.count) })),
    indexedCount: Number(total[0]?.count ?? 0),
  }
}

/**
 * Nazwy zadań z indeksu, zawężone do JEDNEGO portalu.
 *
 * Zawężenie po `portalId` nie jest optymalizacją, tylko granicą bezpieczeństwa:
 * funkcja służy do rozwiązywania wzmianek w komentarzach, a nazwa zadania z
 * portalu innego klienta nie ma prawa wyjść (patrz lib/commentMentions.ts).
 */
export async function getIndexedTaskNames(
  portalId: string,
  taskIds: readonly string[]
): Promise<Map<string, string>> {
  if (taskIds.length === 0) return new Map()
  const rows = await db
    .select({ id: taskIndex.clickupTaskId, name: taskIndex.name })
    .from(taskIndex)
    .where(
      and(
        eq(taskIndex.portalId, portalId),
        inArray(taskIndex.clickupTaskId, [...taskIds]),
        // Nazwa ukrytego zadania nie wychodzi nawet jako tekst wzmianki.
        sql`(${taskIndex.portalVisible} OR NOT COALESCE((SELECT pp.portal_tag_only FROM portals pp WHERE pp.id = ${taskIndex.portalId}), false))`
      )
    )

  return new Map(rows.map(row => [row.id, row.name]))
}
