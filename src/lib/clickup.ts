import type { ClickUpTask, ClickUpComment, ClickUpStatus, ClickUpTimeEntry } from './types'
import { taskBelongsToPortal } from './portalScope'

const CLICKUP_API = 'https://api.clickup.com/api/v2'
const TOKEN = process.env.CLICKUP_API_TOKEN!

/** Górna granica czekania po 429. Dłużej i tak lepiej zwrócić błąd. */
const RATE_LIMIT_MAX_WAIT_MS = 65_000

function sleep(ms: number): Promise<void> {
  return new Promise(resolve => setTimeout(resolve, ms))
}

async function clickupFetch<T>(path: string, options?: RequestInit): Promise<T> {
  // Jedna próba ponowienia po 429. ClickUp daje 100 zapytań na minutę na token
  // (Free/Unlimited/Business), a tym samym tokenem chodzi i portal klienta,
  // i synchronizacja indeksu. Bez tego 429 z backfillu mógłby wylądować na
  // żądaniu klienta i wyglądać jak awaria portalu.
  for (let attempt = 0; attempt < 2; attempt++) {
    const res = await fetch(`${CLICKUP_API}${path}`, {
      ...options,
      headers: {
        Authorization: TOKEN,
        'Content-Type': 'application/json',
        ...options?.headers,
      },
    })

    if (res.status === 429 && attempt === 0) {
      // X-RateLimit-Reset to znacznik czasu w sekundach, nie liczba sekund.
      const reset = Number(res.headers.get('x-ratelimit-reset'))
      const waitMs = Number.isFinite(reset) && reset > 0
        ? Math.min(Math.max(reset * 1000 - Date.now(), 1_000), RATE_LIMIT_MAX_WAIT_MS)
        : 5_000
      console.warn(`[clickup] 429 na ${path}, czekam ${Math.round(waitMs / 1000)}s i ponawiam`)
      await sleep(waitMs)
      continue
    }

    if (!res.ok) {
      const error = await res.text()
      throw new Error(`ClickUp API error ${res.status}: ${error}`)
    }

    return res.json()
  }

  throw new Error(`ClickUp API error 429: limit zapytań nadal przekroczony po ponowieniu (${path})`)
}

export async function getListsForFolder(folderId: string): Promise<Array<{ id: string; name: string }>> {
  const data = await clickupFetch<{ lists: Array<{ id: string; name: string }> }>(
    `/folder/${folderId}/list?archived=false`
  )
  return data.lists ?? []
}

export async function getTasksForList(
  listId: string,
  options: { includeClosed?: boolean; page?: number } = {}
): Promise<{ tasks: ClickUpTask[]; lastPage: boolean }> {
  const params = new URLSearchParams({
    subtasks: 'true',
    include_closed: String(options.includeClosed ?? false),
    page: String(options.page ?? 0),
  })

  const data = await clickupFetch<{ tasks: ClickUpTask[]; last_page?: boolean }>(
    `/list/${listId}/task?${params}`
  )
  return { tasks: data.tasks ?? [], lastPage: data.last_page ?? true }
}

/** Sufit stron na listę. Zabezpieczenie przed pętlą, nie normalny tryb pracy. */
const MAX_PAGES_PER_LIST = 11

/**
 * Zadania z PODANYCH list, nie z całego folderu.
 *
 * Powstało, bo folder klienta może zawierać listy, których do jego portalu nie
 * wybraliśmy. Wcześniej istniała tylko wersja folderowa i to ona zasilała
 * tablicę, więc wybór listy w panelu nie miał żadnego znaczenia przy odczycie.
 *
 * Pusta lista identyfikatorów zwraca pustą tablicę, NIE cały folder. Decyzja
 * „brak konfiguracji znaczy cały folder" należy do wołającego (lib/portalScope.ts),
 * bo tylko on wie, czy pustka to brak konfiguracji, czy wynik filtrowania.
 */
export async function getAllTasksForLists(listIds: readonly string[]): Promise<ClickUpTask[]> {
  const allTasks: ClickUpTask[] = []
  for (const listId of listIds) {
    let page = 0
    let lastPage = false
    while (!lastPage) {
      const { tasks, lastPage: isLast } = await getTasksForList(listId, { page })
      allTasks.push(...tasks)
      lastPage = isLast
      page++
      if (page >= MAX_PAGES_PER_LIST) {
        if (!lastPage) {
          console.warn(
            `[clickup] pobór listy ${listId} UCIĘTY na ${MAX_PAGES_PER_LIST} stronach — część zadań pominięta`
          )
        }
        break
      }
    }
  }
  return buildTaskTree(allTasks)
}

export async function getAllTasksForFolder(folderId: string): Promise<ClickUpTask[]> {
  const lists = await getListsForFolder(folderId)
  const allTasks: ClickUpTask[] = []

  for (const list of lists) {
    let page = 0
    let lastPage = false
    while (!lastPage) {
      const { tasks, lastPage: isLast } = await getTasksForList(list.id, { page })
      allTasks.push(...tasks)
      lastPage = isLast
      page++
      if (page >= MAX_PAGES_PER_LIST) {
        // Wcześniej ten warunek ucinał pobór po cichu. Objawem byłyby po prostu
        // brakujące zadania, bez żadnego śladu w logach.
        if (!lastPage) {
          console.warn(
            `[clickup] pobór listy ${list.id} (folder ${folderId}) UCIĘTY na ${MAX_PAGES_PER_LIST} stronach — część zadań pominięta`
          )
        }
        break
      }
    }
  }

  return buildTaskTree(allTasks)
}

/**
 * Zadania zamkniete w ostatnich `sinceDays` dniach, najnowsze pierwsze,
 * przyciete do `limit`. Zrodlo danych dla podgladu w kolumnie "zamkniete" na
 * kanbanie — NIE dla Historii, ktora ma wlasne, kompletne pobieranie
 * (`getFolderTaskHistory` + `task_index`).
 *
 * Swiadomie NIE ciagniemy calej historii zamkniec (`include_closed: true` bez
 * filtra daty): u klienta dzialajacego od miesiecy to setki zadan, ktorych
 * i tak pokazujemy tylko `limit`, a `MAX_PAGES_PER_LIST` mogloby przy okazji
 * obciac swiezo otwarte zadania tej samej listy. `date_updated_gt` zawęża
 * pobor po stronie ClickUpa, zanim to dojedzie do nas.
 *
 * Jedna strona per lista, bez petli po stronach: okno 30 dni rzadko
 * przekracza 100 zamkniec na liste, a nawet gdyby przekroczylo, pokazujemy
 * i tak tylko `limit` najnowszych z tej strony — kolejna strona nie
 * zmienilaby ostatecznego wyniku dla typowego klienta.
 *
 * Filtr `status.type === 'closed'` jest PO NASZEJ stronie: `include_closed:
 * true` znaczy "nie wykluczaj zamknietych", NIE "pokaz TYLKO zamkniete" —
 * strona zwraca też otwarte zadania zaktualizowane w tym samym oknie.
 *
 * Zamkniety PODZADANIE w tym oknie pojawi sie tu jako samodzielna karta, bez
 * kontekstu rodzica (`subtasks: false`, zeby nie dotknac otwartego rodzica
 * przez pomylke) — akceptowalne dla podgladu ograniczonego do garstki
 * najnowszych; pelny kontekst jest w Historii.
 */
export async function getRecentlyClosedTasksForLists(
  listIds: readonly string[],
  options: { sinceDays?: number; limit?: number } = {}
): Promise<ClickUpTask[]> {
  const sinceDays = options.sinceDays ?? 30
  const limit = options.limit ?? 5
  const since = Date.now() - sinceDays * 24 * 60 * 60 * 1000

  const closed: ClickUpTask[] = []
  for (const listId of listIds) {
    const params = new URLSearchParams({
      subtasks: 'false',
      include_closed: 'true',
      date_updated_gt: String(since),
      page: '0',
    })
    const data = await clickupFetch<{ tasks: ClickUpTask[] }>(`/list/${listId}/task?${params}`)
    closed.push(...(data.tasks ?? []).filter(t => t.status.type === 'closed' && closedTimestamp(t) >= since))
  }

  return closed.sort((a, b) => closedTimestamp(b) - closedTimestamp(a)).slice(0, limit)
}

/**
 * `date_closed` bywa puste u zadan zamknietych, zanim ClickUp zaczal je
 * zapisywac (patrz ten sam problem w `lib/taskIndex.ts`) — `date_updated`
 * jest wtedy najlepszym przyblizeniem momentu zamkniecia.
 */
function closedTimestamp(task: ClickUpTask): number {
  return Number(task.date_closed ?? task.date_updated)
}

export async function getRecentlyClosedTasksForFolder(
  folderId: string,
  options: { sinceDays?: number; limit?: number } = {}
): Promise<ClickUpTask[]> {
  const lists = await getListsForFolder(folderId)
  return getRecentlyClosedTasksForLists(lists.map(l => l.id), options)
}

/**
 * Wszystkie zadania folderu, włącznie z zamkniętymi, jednym przelotem przez
 * endpoint zespołowy. Źródło danych dla indeksu Historii.
 *
 * Czemu nie pętla po listach jak w getAllTasksForFolder: `/team/{id}/task`
 * z `project_ids[]` bierze cały folder naraz, po 100 zadań na stronę, więc
 * zużywa mniej zapytań i nie ma sufitu per lista.
 *
 * Sprawdzone empirycznie na folderze Onyx, dwie rzeczy zaskakują:
 *
 * 1. `order_by=created` SAM daje malejąco, czyli najnowsze pierwsze.
 *    Dodanie `reverse=true` odwraca to na rosnąco. Parametr o nazwie
 *    "reverse" robi więc odwrotność tego, czego się po nim spodziewać, i
 *    dlatego go tu NIE MA. Nie dopisuj go "dla porządku".
 * 2. `last_page` w odpowiedzi JEST, mimo że dokumentacja go nie wymienia
 *    dla tego endpointu. Ufamy mu, ale trzymamy też warunek na krótką
 *    stronę, gdyby ClickUp przestał go zwracać.
 *
 * Odpowiedź NIE zawiera załączników ani komentarzy — te idą osobno,
 * per zadanie, i to jest powód istnienia lustra w naszej bazie.
 *
 * `project_ids[]` jest granicą bezpieczeństwa między klientami. Wartość musi
 * pochodzić z rekordu portalu w bazie, nigdy z URL-a.
 */
export async function getFolderTaskHistory(
  folderId: string,
  options: { maxPages?: number } = {}
): Promise<{ tasks: ClickUpTask[]; truncated: boolean }> {
  const teamId = process.env.CLICKUP_TEAM_ID
  if (!teamId) throw new Error('Brak CLICKUP_TEAM_ID w env')

  const maxPages = options.maxPages ?? 60 // 6000 zadań, daleko powyżej realnych rozmiarów
  const tasks: ClickUpTask[] = []
  let page = 0
  let truncated = false

  while (page < maxPages) {
    const params = new URLSearchParams({
      include_closed: 'true',
      subtasks: 'true',
      order_by: 'created',
      page: String(page),
    })
    params.append('project_ids[]', folderId)

    const data = await clickupFetch<{ tasks?: ClickUpTask[]; last_page?: boolean }>(
      `/team/${teamId}/task?${params.toString()}`
    )
    const batch = data.tasks ?? []
    tasks.push(...batch)

    if (data.last_page === true || batch.length === 0 || batch.length < 100) break
    page++

    if (page >= maxPages) {
      truncated = true
      console.warn(
        `[clickup] historia folderu ${folderId} UCIĘTA na ${maxPages} stronach — rekoncyliacja zostanie pominięta`
      )
    }
  }

  return { tasks, truncated }
}

/**
 * ClickUp returns subtasks as separate top-level task objects (each with a
 * `parent` pointer) when `subtasks=true`, NOT nested inside the parent. This
 * rebuilds the hierarchy: subtasks whose parent is present in the set are
 * moved under `parent.children`; everything else stays top-level. Orphans
 * (parent not in the fetched set) remain top-level so nothing is lost.
 * Building at the folder level (across all lists) is deliberate — a subtask
 * and its parent can live in the same list but be paginated separately.
 */
export function buildTaskTree(flat: ClickUpTask[]): ClickUpTask[] {
  const byId = new Map<string, ClickUpTask>()
  // Dedupe by id and give every node a fresh children array
  for (const t of flat) byId.set(t.id, { ...t, children: [] })

  const roots: ClickUpTask[] = []
  for (const task of byId.values()) {
    const parentId = task.parent
    if (parentId && byId.has(parentId)) {
      byId.get(parentId)!.children!.push(task)
    } else {
      roots.push(task)
    }
  }
  return roots
}

export async function getTask(taskId: string): Promise<ClickUpTask> {
  return clickupFetch<ClickUpTask>(`/task/${taskId}`)
}

export async function createTask(
  listId: string,
  data: {
    name: string
    description?: string
    priority?: number | null
    due_date?: number | null
    start_date?: number | null
    status?: string
    /**
     * ClickUp przyjmuje tagi przy tworzeniu jako tablicę nazw, ale TYLKO takie,
     * które już istnieją w przestrzeni. Nazwa spoza słownika jest po cichu
     * pomijana, zadanie powstaje bez niej i bez błędu.
     */
    tags?: string[]
  }
): Promise<ClickUpTask> {
  return clickupFetch<ClickUpTask>(`/list/${listId}/task`, {
    method: 'POST',
    body: JSON.stringify(data),
  })
}

export async function updateTask(
  taskId: string,
  data: {
    name?: string
    description?: string
    status?: string
    priority?: number | null
    due_date?: number | null
  }
): Promise<ClickUpTask> {
  return clickupFetch<ClickUpTask>(`/task/${taskId}`, {
    method: 'PUT',
    body: JSON.stringify(data),
  })
}

export async function deleteTask(taskId: string): Promise<void> {
  await clickupFetch<unknown>(`/task/${taskId}`, { method: 'DELETE' })
}

// Upload a file as an attachment on a ClickUp task (multipart/form-data).
// Do NOT set Content-Type — fetch derives the multipart boundary from FormData.
export async function addTaskAttachment(
  taskId: string,
  file: Blob,
  filename: string
): Promise<{ id: string; url: string; title: string }> {
  const form = new FormData()
  form.append('attachment', file, filename)
  const res = await fetch(`${CLICKUP_API}/task/${taskId}/attachment`, {
    method: 'POST',
    headers: { Authorization: TOKEN },
    body: form,
  })
  if (!res.ok) {
    throw new Error(`ClickUp attachment error ${res.status}: ${await res.text()}`)
  }
  return res.json()
}

export async function getTaskComments(taskId: string): Promise<ClickUpComment[]> {
  const data = await clickupFetch<{ comments: ClickUpComment[] }>(`/task/${taskId}/comment`)
  return data.comments ?? []
}

export async function addComment(taskId: string, text: string): Promise<ClickUpComment> {
  // ClickUp POST /task/{id}/comment returns the comment object directly, not wrapped
  return clickupFetch<ClickUpComment>(`/task/${taskId}/comment`, {
    method: 'POST',
    body: JSON.stringify({ comment_text: text }),
  })
}

export async function updateComment(commentId: string, text: string): Promise<void> {
  await clickupFetch<unknown>(`/comment/${commentId}`, {
    method: 'PUT',
    body: JSON.stringify({ comment_text: text }),
  })
}

export async function deleteComment(commentId: string): Promise<void> {
  await clickupFetch<unknown>(`/comment/${commentId}`, { method: 'DELETE' })
}

export async function getListStatuses(listId: string): Promise<ClickUpStatus[]> {
  const data = await clickupFetch<{ statuses: ClickUpStatus[] }>(`/list/${listId}`)
  return data.statuses ?? []
}

export async function getFolderLists(
  folderId: string
): Promise<Array<{ id: string; name: string }>> {
  const data = await clickupFetch<{ lists: Array<{ id: string; name: string }> }>(
    `/folder/${folderId}/list`
  )
  return data.lists ?? []
}

// Security: verify taskId belongs to this folder before any mutation
/**
 * Czy zadanie nalezy do portalu. Granica miedzy klientami, a od teraz takze
 * miedzy listami W OBREBIE folderu jednego klienta.
 *
 * `scope` pusty znaczy caly folder, zgodnie z reszta systemu. Gdy zakres jest
 * zawezony, samo dopasowanie folderu NIE WYSTARCZA: bez sprawdzenia listy klient
 * mogl odczytac zadanie z listy, ktorej mu nie udostepnilismy, znajac jego
 * identyfikator, mimo ze na tablicy go nie widzial.
 */
export async function verifyTaskBelongsToFolder(
  taskId: string,
  folderId: string,
  scope: readonly string[] = []
): Promise<boolean> {
  try {
    // Reguła jest w portalScope.ts, bo trasa szczegółów zadania stosuje ją do
    // zadania, które już pobrała. Tutaj dokładamy tylko pobranie.
    return taskBelongsToPortal(await getTask(taskId), folderId, scope)
  } catch {
    return false
  }
}

/**
 * Id wszystkich członków workspace, potrzebne jako parametr `assignee`
 * dla time_entries. Cache w module, bo skład zespołu zmienia się rzadko,
 * a lista jest potrzebna przy każdym raporcie.
 */
let cachedMemberIds: string[] | null = null

export async function getWorkspaceMemberIds(): Promise<string[]> {
  if (cachedMemberIds) return cachedMemberIds

  const teamId = process.env.CLICKUP_TEAM_ID
  if (!teamId) throw new Error('Brak CLICKUP_TEAM_ID w env')

  const data = await clickupFetch<{
    teams: Array<{ id: string; members: Array<{ user: { id: number } }> }>
  }>('/team')

  const team = data.teams?.find(t => t.id === teamId)
  if (!team) throw new Error(`ClickUp: workspace ${teamId} niedostępny dla tego tokena`)

  cachedMemberIds = team.members.map(m => String(m.user.id))
  return cachedMemberIds
}

/**
 * Wpisy czasu dla jednego folderu klienta w podanym zakresie.
 *
 * Dwie rzeczy, które łatwo zgubić przy refaktorze:
 *
 * 1. `assignee` jest OBOWIĄZKOWE. Bez tego parametru ClickUp zwraca wyłącznie
 *    wpisy właściciela tokena. Ten sam zakres dat daje 1 wpis bez assignee
 *    i 72 wpisy z listą wszystkich członków.
 * 2. `folder_id` jest granicą bezpieczeństwa między klientami. Wartość musi
 *    pochodzić z rekordu portalu w bazie, nigdy z URL-a.
 */
export async function getTimeEntries(
  folderId: string,
  startMs: number,
  endMs: number
): Promise<ClickUpTimeEntry[]> {
  const teamId = process.env.CLICKUP_TEAM_ID
  if (!teamId) throw new Error('Brak CLICKUP_TEAM_ID w env')

  const assignee = (await getWorkspaceMemberIds()).join(',')
  const params = new URLSearchParams({
    start_date: String(startMs),
    end_date: String(endMs),
    folder_id: folderId,
    assignee,
  })

  // Zamknięty okres się nie zmienia, ale ktoś może dopisać czas wstecz,
  // więc pięć minut zamiast cache'owania na zawsze.
  const data = await clickupFetch<{ data: ClickUpTimeEntry[] }>(
    `/team/${teamId}/time_entries?${params.toString()}`,
    { next: { revalidate: 300 } }
  )
  return data.data ?? []
}
