# Dropdown statusu + widoczna kolumna „zamknięte” — plan wdrożenia

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Klient może zobaczyć niedawno zamknięte zadania na kanbanie (z limitem i linkiem do Historii) i zmienić status zadania z dropdownu w widoku otwartego zadania, nie tylko przeciąganiem karty — cała funkcja za flagą per projekt, domyślnie wyłączona.

**Architecture:** Dodatkowe, ograniczone zapytanie do ClickUpa (`include_closed=true` + `date_updated_gt`) dociąga TYLKO niedawno zamknięte zadania, oddzielnie od istniejącego poboru otwartych zadań (który zostaje nietknięty). Wynik miesza się z otwartymi zadaniami po stronie serwera, a `buildColumns` przycina kolumnę „zamknięte” do limitu i sortuje po dacie zamknięcia. Dropdown statusu w `TaskDrawer` woła ten sam, już istniejący `PATCH /api/clickup/tasks/{id}`, którego dziś używa przeciąganie karty — zero zmian w backendzie zapisu.

**Tech Stack:** Next.js 16 (App Router), Drizzle ORM + PostgreSQL, shadcn `DropdownMenu` (Radix), Vitest (jednostkowe, komponentowe w jsdom, integracyjne na prawdziwym Postgresie), ClickUp REST API v2.

## Global Constraints

- Nowa funkcja dotyczy widoku klienta → jedzie na produkcję za flagą w tabeli `portals`, `DEFAULT false NOT NULL`, bez pytania o zgodę na ten wzorzec (ustalona reguła projektu). Brama jest w danych, które trafiają do klienta (serwer nie pobiera/nie wysyła nic nawigacyjnego, gdy flaga jest wyłączona) — nie tylko kosmetyczne ukrycie w UI.
- Nazwa flagi: `statusControlsEnabled` (kolumna `status_controls_enabled`). Bez checkboxa w `/admin` — włączana wyłącznie przez `PATCH /api/admin/portals` z tokenem, tak jak `sitepingEnabled`.
- Limit zadań w kolumnie „zamknięte”: **5**. Okno „niedawno zamknięte”: **30 dni**.
- Link „Zobacz więcej” prowadzi do `/${slug}/historia?status=zamkni%C4%99te` i renderuje się TYLKO gdy zakładka Historia jest włączona dla portalu (`flags.historyEnabled`).
- Zero zmian w istniejącym poborze otwartych zadań (`getAllTasksForLists`, `getAllTasksForFolder`, `getTasksForList`) i zero zmian w `PATCH /api/clickup/tasks/{taskId}` — dropdown i kolumna zamknięte to WYŁĄCZNIE nowy kod dobudowany obok.
- Każda zmiana kończy się przechodzącym `npm run verify` (tsc + eslint + vitest + `next build`).
- Spec źródłowy: `docs/superpowers/specs/2026-08-08-status-dropdown-i-kolumna-zamkniete-design.md`.

---

## Task 1: Flaga `statusControlsEnabled` w bazie i w API admina

**Files:**
- Modify: `src/lib/db/schema.ts:63` (po bloku `sitepingEnabled`)
- Create: migracja w `src/lib/db/migrations/` (nazwa po `db:generate`, patrz Step 1)
- Modify: `src/app/api/admin/portals/route.ts:21-25` (GET select), `:44-48` (schema PATCH), `:186-210` (returning po PATCH)
- Test: `tests/integration/routes.adminPanel.test.ts`

**Interfaces:**
- Produces: kolumna `portals.status_controls_enabled` (boolean, default `false`), dostępna na każdym `db.select().from(portals)` jako `portal.statusControlsEnabled` — używana przez Task 4 i Task 6.
- Produces: `PATCH /api/admin/portals` przyjmuje opcjonalne pole `statusControlsEnabled: boolean`.

- [ ] **Step 1: Dodaj kolumnę do schematu**

W `src/lib/db/schema.ts`, w tabeli `portals`, tuż po polu `sitepingEnabled` (linia 63):

```ts
  sitepingEnabled: boolean('siteping_enabled').notNull().default(false),
  /**
   * Dropdown zmiany statusu w szufladzie zadania + widoczna, ograniczona
   * kolumna "zamknięte" na kanbanie. Domyslnie false, jak kazda nowa funkcja
   * portalu (patrz reportsEnabled) — bez tej flagi kanban dziala tak jak dzis:
   * zamkniete zadania nie sa dociagane, status zmienia sie tylko przeciagnieciem
   * karty.
   */
  statusControlsEnabled: boolean('status_controls_enabled').notNull().default(false),
```

- [ ] **Step 2: Wygeneruj migrację**

Run: `npm run db:generate`

Sprawdź WYGENEROWANY plik SQL w `src/lib/db/migrations/` — musi zawierać WYŁĄCZNIE:

```sql
ALTER TABLE "portals" ADD COLUMN "status_controls_enabled" boolean DEFAULT false NOT NULL;
```

Jeśli plik zawiera więcej (np. `CREATE TABLE` dla istniejących tabel) — to jest drift meta-snapshotu opisany w `reference_clientportal_ops.md` ("Drizzle meta drift"). W takim wypadku PRZYCIĄĆ wygenerowany SQL do samej powyższej linii, ręcznie.

Zmień nazwę wygenerowanego pliku na `NNNN_status_controls.sql` (gdzie `NNNN` to numer, jaki drizzle-kit przydzielił) i zaktualizuj pole `"tag"` dla tego wpisu w `src/lib/db/migrations/meta/_journal.json` na `"NNNN_status_controls"`, zgodnie z konwencją innych ręcznie nazwanych migracji w tym katalogu (np. `0007_brand_color`, `0008_portal_contact`).

- [ ] **Step 3: Uruchom migrację na lokalnej bazie testowej**

Run: `docker start cp-test-pg && npm run db:migrate`
Expected: migracja `NNNN_status_controls` na liście zastosowanych, bez błędów.

- [ ] **Step 4: Dodaj pole do GET /api/admin/portals**

W `src/app/api/admin/portals/route.ts`, w `select` wewnątrz `GET` (obok `sitepingEnabled: portals.sitepingEnabled,`):

```ts
      sitepingEnabled: portals.sitepingEnabled,
      statusControlsEnabled: portals.statusControlsEnabled,
```

- [ ] **Step 5: Dodaj pole do walidacji PATCH**

W `UpdatePortalSchema` (obok `sitepingEnabled: z.boolean().optional(),`):

```ts
    sitepingEnabled: z.boolean().optional(),
    statusControlsEnabled: z.boolean().optional(),
```

- [ ] **Step 6: Dodaj pole do `returning` po PATCH**

W `db.update(portals).set(changes).where(...).returning({...})` (obok `sitepingEnabled: portals.sitepingEnabled,`):

```ts
      sitepingEnabled: portals.sitepingEnabled,
      statusControlsEnabled: portals.statusControlsEnabled,
```

- [ ] **Step 7: Napisz test integracyjny**

W `tests/integration/routes.adminPanel.test.ts`, w bloku `describe.skipIf(!maToken)('PATCH /api/admin/portals', ...)`, obok istniejących testów flag:

```ts
    it('statusControlsEnabled da sie wlaczyc i wylaczyc, bez wplywu na inne pola', async () => {
      const wlacz = await portalsPATCH(
        wyslij('/api/admin/portals', 'PATCH', { slug: portalA.slug, statusControlsEnabled: true })
      )
      const { portal: wlaczony } = await wlacz.json()
      assert.strictEqual(wlaczony.statusControlsEnabled, true)
      assert.strictEqual(wlaczony.brandColor, '#c8a24a', 'kolor nietkniety')

      const wylacz = await portalsPATCH(
        wyslij('/api/admin/portals', 'PATCH', { slug: portalA.slug, statusControlsEnabled: false })
      )
      const { portal: wylaczony } = await wylacz.json()
      assert.strictEqual(wylaczony.statusControlsEnabled, false)
    })
```

- [ ] **Step 8: Uruchom test**

Run: `docker start cp-test-pg && npx vitest run tests/integration/routes.adminPanel.test.ts`
Expected: PASS, w tym nowy test.

- [ ] **Step 9: Commit**

```bash
git add src/lib/db/schema.ts src/lib/db/migrations src/app/api/admin/portals/route.ts tests/integration/routes.adminPanel.test.ts
git commit -m "feat(portal): flaga statusControlsEnabled za dropdown statusu i kolumne zamknięte"
```

---

## Task 2: `getRecentlyClosedTasksForLists` / `getRecentlyClosedTasksForFolder` w `lib/clickup.ts`

**Files:**
- Modify: `src/lib/clickup.ts` (nowe funkcje, obok `getAllTasksForLists`/`getAllTasksForFolder`, ok. linii 88-137)
- Test: Create `src/lib/clickup.test.ts`

**Interfaces:**
- Consumes: `clickupFetch<T>(path, options?)` (istniejąca funkcja modułowa w tym pliku), `getListsForFolder(folderId): Promise<Array<{id: string; name: string}>>` (już istnieje).
- Produces: `getRecentlyClosedTasksForLists(listIds: readonly string[], options?: {sinceDays?: number; limit?: number}): Promise<ClickUpTask[]>` i `getRecentlyClosedTasksForFolder(folderId: string, options?: {sinceDays?: number; limit?: number}): Promise<ClickUpTask[]>` — używane przez Task 3.

- [ ] **Step 1: Napisz failing test dla filtrowania i sortowania**

Create `src/lib/clickup.test.ts`:

```ts
/**
 * `getRecentlyClosedTasksForLists`/`getRecentlyClosedTasksForFolder`: dodatkowy,
 * OGRANICZONY pobor zamknietych zadan pod podglad w kolumnie "zamkniete" na
 * kanbanie (patrz design 2026-08-08). Fetch jest podstawiony globalnie —
 * to sa jedyne dwie funkcje modulu, ktore ten plik sprawdza, reszta
 * `lib/clickup.ts` jest przechodzona przez testy tras (docs/testing.md).
 *
 *   npx vitest run src/lib/clickup.test.ts
 */
import { describe, it, beforeEach, vi } from 'vitest'
import assert from 'node:assert'
import type { ClickUpTask } from './types'

const fetchMock = vi.fn()

beforeEach(() => {
  vi.clearAllMocks()
  vi.stubGlobal('fetch', fetchMock)
})

import { getRecentlyClosedTasksForLists, getRecentlyClosedTasksForFolder } from './clickup'

function zadanie(nadpisz: Partial<ClickUpTask> & { id: string }): ClickUpTask {
  return {
    name: 'Zadanie',
    description: '',
    priority: null,
    tags: [],
    date_created: '1700000000000',
    date_updated: '1700000000000',
    ...nadpisz,
  } as unknown as ClickUpTask
}

function odpowiedzListy(tasks: ClickUpTask[]) {
  fetchMock.mockResolvedValue({ ok: true, json: async () => ({ tasks }) })
}

describe('getRecentlyClosedTasksForLists', () => {
  it('zapytanie niesie include_closed=true i date_updated_gt', async () => {
    odpowiedzListy([])
    await getRecentlyClosedTasksForLists(['lista-1'])

    const [adres] = fetchMock.mock.calls[0]
    assert.match(adres as string, /\/list\/lista-1\/task\?/)
    assert.match(adres as string, /include_closed=true/)
    assert.match(adres as string, /date_updated_gt=\d+/)
  })

  it('odsiewa zadania OTWARTE zwrocone w tym samym oknie', async () => {
    odpowiedzListy([
      zadanie({ id: '1', status: { status: 'w trakcie', type: 'custom', color: '', orderindex: 0 } }),
      zadanie({
        id: '2',
        status: { status: 'zamknięte', type: 'closed', color: '', orderindex: 6 },
        date_closed: '200',
      }),
    ])

    const wynik = await getRecentlyClosedTasksForLists(['lista-1'])

    assert.deepStrictEqual(wynik.map(t => t.id), ['2'])
  })

  it('sortuje po dacie zamkniecia (najnowsze pierwsze) i przycina do limitu', async () => {
    odpowiedzListy([
      zadanie({ id: 'a', status: { status: 'zamknięte', type: 'closed', color: '', orderindex: 6 }, date_closed: '100' }),
      zadanie({ id: 'b', status: { status: 'zamknięte', type: 'closed', color: '', orderindex: 6 }, date_closed: '300' }),
      zadanie({ id: 'c', status: { status: 'zamknięte', type: 'closed', color: '', orderindex: 6 }, date_closed: '200' }),
    ])

    const wynik = await getRecentlyClosedTasksForLists(['lista-1'], { limit: 2 })

    assert.deepStrictEqual(wynik.map(t => t.id), ['b', 'c'])
  })

  it('brak date_closed -> uzywa date_updated jako przyblizenia', async () => {
    odpowiedzListy([
      zadanie({
        id: 'stare',
        status: { status: 'zamknięte', type: 'closed', color: '', orderindex: 6 },
        date_closed: null,
        date_updated: '50',
      }),
      zadanie({
        id: 'nowe',
        status: { status: 'zamknięte', type: 'closed', color: '', orderindex: 6 },
        date_closed: '9999',
      }),
    ])

    const wynik = await getRecentlyClosedTasksForLists(['lista-1'])

    assert.deepStrictEqual(wynik.map(t => t.id), ['nowe', 'stare'])
  })

  it('woła jedna liste na kazde id, bez zapetlania stron', async () => {
    odpowiedzListy([])
    await getRecentlyClosedTasksForLists(['lista-1', 'lista-2'])

    assert.strictEqual(fetchMock.mock.calls.length, 2)
  })
})

describe('getRecentlyClosedTasksForFolder', () => {
  it('pobiera listy folderu, potem zamkniete z kazdej z nich', async () => {
    fetchMock.mockImplementation(async (url: string) => ({
      ok: true,
      json: async () =>
        url.includes('/folder/')
          ? { lists: [{ id: 'lista-a', name: 'A' }, { id: 'lista-b', name: 'B' }] }
          : { tasks: [] },
    }))

    await getRecentlyClosedTasksForFolder('folder-1')

    const adresy = fetchMock.mock.calls.map(c => c[0] as string)
    assert.ok(adresy.some(a => a.includes('/folder/folder-1/list')))
    assert.ok(adresy.some(a => a.includes('/list/lista-a/task')))
    assert.ok(adresy.some(a => a.includes('/list/lista-b/task')))
  })
})
```

- [ ] **Step 2: Uruchom test i sprawdź, że pada z powodu brakującego eksportu**

Run: `npx vitest run src/lib/clickup.test.ts`
Expected: FAIL — `getRecentlyClosedTasksForLists is not a function` (albo błąd importu).

- [ ] **Step 3: Zaimplementuj funkcje**

W `src/lib/clickup.ts`, po `getAllTasksForFolder` (po linii 137), przed komentarzem do `getFolderTaskHistory`:

```ts
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
    closed.push(...(data.tasks ?? []).filter(t => t.status.type === 'closed'))
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
```

- [ ] **Step 4: Uruchom test**

Run: `npx vitest run src/lib/clickup.test.ts`
Expected: PASS, wszystkie 6 testów.

- [ ] **Step 5: Commit**

```bash
git add src/lib/clickup.ts src/lib/clickup.test.ts
git commit -m "feat(clickup): getRecentlyClosedTasksForLists/Folder — ograniczony pobor niedawno zamknietych"
```

---

## Task 3: Cache — `getCachedRecentlyClosedTasksForScope`

**Files:**
- Modify: `src/lib/clickupCache.ts`
- Modify: `src/lib/clickupCache.test.ts`

**Interfaces:**
- Consumes: `getRecentlyClosedTasksForLists`, `getRecentlyClosedTasksForFolder` (Task 2), `scopeLimits`, `scopeCacheKey` (już importowane w tym pliku), `folderTasksTag`, `FOLDER_TASKS_TTL_SECONDS` (już w tym pliku).
- Produces: `getCachedRecentlyClosedTasksForScope(folderId: string, scope: PortalScope): Promise<ClickUpTask[]>` — używane przez Task 4.

- [ ] **Step 1: Napisz failing test klucza cache**

W `src/lib/clickupCache.test.ts`, w `vi.hoisted`, dopisz do obiektu `clickup`:

```ts
  clickup: {
    getAllTasksForFolder: vi.fn(),
    getAllTasksForLists: vi.fn(),
    getRecentlyClosedTasksForFolder: vi.fn(),
    getRecentlyClosedTasksForLists: vi.fn(),
  },
```

W `beforeEach`, obok istniejących `mockResolvedValue([])`:

```ts
  clickup.getRecentlyClosedTasksForFolder.mockResolvedValue([])
  clickup.getRecentlyClosedTasksForLists.mockResolvedValue([])
```

Nowy `describe`, obok `describe('getCachedTasksForScope — ...')`:

```ts
describe('getCachedRecentlyClosedTasksForScope — ten sam wzorzec klucza', () => {
  it('klucz zawiera identyfikator folderu i jest INNY niz klucz otwartych zadan', async () => {
    await getCachedTasksForScope('folder-A', [])
    await getCachedRecentlyClosedTasksForScope('folder-A', [])

    const [, keyOtwarte] = nextCache.unstable_cache.mock.calls[0]
    const [, keyZamkniete] = nextCache.unstable_cache.mock.calls[1]
    assert.ok((keyZamkniete as string[]).includes('folder-A'))
    assert.notDeepStrictEqual(keyOtwarte, keyZamkniete, 'dwa rozne wpisy, nie nadpisuja sie wzajemnie')
  })

  it('zakres pusty -> caly folder (tak jak przy otwartych zadaniach)', async () => {
    await getCachedRecentlyClosedTasksForScope('folder-1', [])
    assert.strictEqual(clickup.getRecentlyClosedTasksForFolder.mock.calls.length, 1)
    assert.strictEqual(clickup.getRecentlyClosedTasksForLists.mock.calls.length, 0)
  })

  it('zakres z listami -> tylko wybrane listy', async () => {
    await getCachedRecentlyClosedTasksForScope('folder-1', ['lista-a'])
    assert.strictEqual(clickup.getRecentlyClosedTasksForLists.mock.calls.length, 1)
    assert.strictEqual(clickup.getRecentlyClosedTasksForFolder.mock.calls.length, 0)
  })

  it('dzieli tag uniewazniania z otwartymi zadaniami tego folderu', async () => {
    await getCachedRecentlyClosedTasksForScope('folder-X', [])
    const [, , opcje] = nextCache.unstable_cache.mock.calls[0]
    assert.deepStrictEqual((opcje as { tags: string[] }).tags, [folderTasksTag('folder-X')])
  })
})
```

Dodaj `getCachedRecentlyClosedTasksForScope` do importu z `./clickupCache` na górze pliku testowego.

- [ ] **Step 2: Uruchom test, sprawdź że pada**

Run: `npx vitest run src/lib/clickupCache.test.ts`
Expected: FAIL — `getCachedRecentlyClosedTasksForScope is not a function`.

- [ ] **Step 3: Zaimplementuj funkcję**

W `src/lib/clickupCache.ts`, po `getCachedTasksForScope`:

```ts
/**
 * Wersja `getCachedTasksForScope` dla niedawno zamknietych zadan (patrz
 * `getRecentlyClosedTasksForLists` w lib/clickup.ts). Ten sam TTL i ten sam
 * TAG uniewazniania jak otwarte zadania — jedno wywolanie
 * `invalidateFolderTasks` po zmianie statusu uniewaznia OBA wpisy naraz,
 * bez dodatkowego okablowania.
 *
 * Klucz cache ma osobny prefiks ('clickup-folder-tasks-closed'), inaczej
 * ten wpis nadpisalby wpis otwartych zadan tego samego folderu i zakresu.
 */
export function getCachedRecentlyClosedTasksForScope(
  folderId: string,
  scope: PortalScope
): Promise<ClickUpTask[]> {
  return unstable_cache(
    () =>
      scopeLimits(scope)
        ? getRecentlyClosedTasksForLists(scope)
        : getRecentlyClosedTasksForFolder(folderId),
    ['clickup-folder-tasks-closed', folderId, scopeCacheKey(scope)],
    { revalidate: FOLDER_TASKS_TTL_SECONDS, tags: [folderTasksTag(folderId)] }
  )()
}
```

I zaktualizuj import z `./clickup` na górze pliku:

```ts
import { getAllTasksForFolder, getAllTasksForLists, getRecentlyClosedTasksForFolder, getRecentlyClosedTasksForLists } from './clickup'
```

- [ ] **Step 4: Uruchom test**

Run: `npx vitest run src/lib/clickupCache.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/lib/clickupCache.ts src/lib/clickupCache.test.ts
git commit -m "feat(cache): getCachedRecentlyClosedTasksForScope, ten sam tag co otwarte zadania"
```

---

## Task 4: Dołączenie niedawno zamknietych do danych kanbanu

**Files:**
- Modify: `src/app/[slug]/page.tsx`
- Modify: `src/app/api/clickup/tasks/route.ts`
- Test: `tests/integration/routes.clickupTasks.test.ts`

**Interfaces:**
- Consumes: `getCachedRecentlyClosedTasksForScope` (Task 3, w `page.tsx`), `getRecentlyClosedTasksForLists`/`getRecentlyClosedTasksForFolder` (Task 2, w trasie GET), `portal.statusControlsEnabled` (Task 1).
- Produces: `initialTasks`/odpowiedz `GET /api/clickup/tasks` zawiera zmieszane otwarte + niedawno zamkniete zadania, WYŁĄCZNIE gdy `portal.statusControlsEnabled === true`.

- [ ] **Step 1: Zaktualizuj `src/app/[slug]/page.tsx`**

Zamień:

```ts
  const scope = await getPortalScope(portal.id)
  const rawTasks = await getCachedTasksForScope(portal.clickupFolderId, scope)
  const snapshots = await getSnapshotMap(portal.id)
  const tasks = mergeTrackedTime(rawTasks, snapshots)
```

na:

```ts
  const scope = await getPortalScope(portal.id)
  const rawTasks = await getCachedTasksForScope(portal.clickupFolderId, scope)
  // Za flaga: bez niej kanban dziala jak dzis, zero dodatkowego wywolania
  // ClickUpa dla portali, ktore tej funkcji nie maja wlaczonej.
  const recentlyClosed = portal.statusControlsEnabled
    ? await getCachedRecentlyClosedTasksForScope(portal.clickupFolderId, scope)
    : []
  const snapshots = await getSnapshotMap(portal.id)
  const tasks = mergeTrackedTime([...rawTasks, ...recentlyClosed], snapshots)
```

I zaktualizuj import:

```ts
import { getCachedTasksForScope, getCachedRecentlyClosedTasksForScope } from '@/lib/clickupCache'
```

Przekaż flagę do `KanbanBoardClient` (dopisz do JSX na końcu funkcji, obok `siteUrl={portalSiteUrl(portal)}`):

```tsx
      statusControlsEnabled={portal.statusControlsEnabled}
```

- [ ] **Step 2: Zaktualizuj `src/app/api/clickup/tasks/route.ts` (GET)**

Zamień:

```ts
  const scope = await getPortalScope(portal.id)
  const rawTasks = scope.length > 0
    ? await getAllTasksForLists(scope)
    : await getAllTasksForFolder(portal.clickupFolderId)
  const snapshots = await getSnapshotMap(portal.id)
  const tasks = mergeTrackedTime(rawTasks, snapshots)
```

na:

```ts
  const scope = await getPortalScope(portal.id)
  const rawTasks = scope.length > 0
    ? await getAllTasksForLists(scope)
    : await getAllTasksForFolder(portal.clickupFolderId)
  const recentlyClosed = portal.statusControlsEnabled
    ? scope.length > 0
      ? await getRecentlyClosedTasksForLists(scope)
      : await getRecentlyClosedTasksForFolder(portal.clickupFolderId)
    : []
  const snapshots = await getSnapshotMap(portal.id)
  const tasks = mergeTrackedTime([...rawTasks, ...recentlyClosed], snapshots)
```

I zaktualizuj import:

```ts
import { getAllTasksForFolder, getAllTasksForLists, getRecentlyClosedTasksForFolder, getRecentlyClosedTasksForLists, createTask } from '@/lib/clickup'
```

- [ ] **Step 3: Napisz failing test integracyjny**

W `tests/integration/routes.clickupTasks.test.ts`, dopisz do hoisted mocka `clickup`:

```ts
    getRecentlyClosedTasksForFolder: vi.fn(),
    getRecentlyClosedTasksForLists: vi.fn(),
```

W `beforeEach` (obecnie trzy linie: `cookieJar.clear()`, `vi.clearAllMocks()`, `cache.invalidateFolderTasks.mockResolvedValue(undefined)`), dopisz:

```ts
    clickup.getRecentlyClosedTasksForFolder.mockResolvedValue([])
    clickup.getRecentlyClosedTasksForLists.mockResolvedValue([])
```

Nowy `describe`, w bloku `'GET /api/clickup/tasks (lista)'`:

```ts
    describe('niedawno zamkniete (statusControlsEnabled)', () => {
      it('flaga WYLACZONA -> nie dociaga zamknietych, zero wywolania', async () => {
        await loginClient()
        clickup.getAllTasksForLists.mockResolvedValue([])

        await tasksGET(req(`/api/clickup/tasks?slug=${portalA.slug}`))

        assert.strictEqual(clickup.getRecentlyClosedTasksForLists.mock.calls.length, 0)
        assert.strictEqual(clickup.getRecentlyClosedTasksForFolder.mock.calls.length, 0)
      })

      it('flaga WLACZONA -> zamkniete zadania trafiaja do odpowiedzi', async () => {
        await db.update(portals).set({ statusControlsEnabled: true }).where(eq(portals.id, portalA.id))
        await loginClient()
        clickup.getAllTasksForLists.mockResolvedValue([{ id: 'otwarte-1', name: 'Otwarte' }])
        clickup.getRecentlyClosedTasksForLists.mockResolvedValue([{ id: 'zamkniete-1', name: 'Zamkniete' }])

        const res = await tasksGET(req(`/api/clickup/tasks?slug=${portalA.slug}`))
        const { tasks } = await res.json()

        assert.deepStrictEqual(tasks.map((t: { id: string }) => t.id).sort(), ['otwarte-1', 'zamkniete-1'])
        // Portal A ma liste w zakresie (beforeAll), wiec droga to "...ForLists".
        assert.strictEqual(clickup.getRecentlyClosedTasksForLists.mock.calls.length, 1)
        assert.deepStrictEqual(clickup.getRecentlyClosedTasksForLists.mock.calls[0][0], ['lista-portalu'])

        await db.update(portals).set({ statusControlsEnabled: false }).where(eq(portals.id, portalA.id))
      })
    })
```

Plik importuje dziś tylko `auditLog` z `@/lib/db/schema` (linia 6). Zamień na:

```ts
import { auditLog, portals } from '@/lib/db/schema'
```

- [ ] **Step 4: Uruchom test, sprawdź że nowe testy padają**

Run: `docker start cp-test-pg && npx vitest run tests/integration/routes.clickupTasks.test.ts`
Expected: nowe dwa testy FAIL (funkcje w trasie jeszcze nie wołane / flaga nieużywana), reszta PASS.

- [ ] **Step 5: Zastosuj zmiany ze Step 1-2 (jeśli nie zrobione wcześniej) i uruchom ponownie**

Run: `npx vitest run tests/integration/routes.clickupTasks.test.ts`
Expected: PASS, wszystkie testy w pliku.

- [ ] **Step 6: `tsc` i `next build` (merge dotyka typów `portal.statusControlsEnabled`)**

Run: `npx tsc --noEmit`
Expected: brak błędów.

- [ ] **Step 7: Commit**

```bash
git add src/app/[slug]/page.tsx src/app/api/clickup/tasks/route.ts tests/integration/routes.clickupTasks.test.ts
git commit -m "feat(kanban): niedawno zamkniete zadania w danych tablicy, za flaga statusControlsEnabled"
```

---

## Task 5: Kolumna „zamknięte” — limit, sortowanie po dacie, link „Zobacz więcej”

**Files:**
- Modify: `src/lib/types.ts:139-145` (`KanbanColumn`)
- Modify: `src/components/kanban/KanbanBoard.tsx:67-90` (`buildColumns`)
- Modify: `src/components/kanban/KanbanColumn.tsx`
- Test: Create `src/components/kanban/KanbanBoard.buildColumns.test.ts`
- Test: Create `src/components/kanban/KanbanColumn.test.tsx`

**Interfaces:**
- Consumes: `STATUS_COLUMNS`, `getStatusColor` (`@/lib/utils`, już importowane w `KanbanBoard.tsx`).
- Produces: `KanbanColumn.moreHref?: string | null` (Task 6 go ustawia na podstawie `flags.historyEnabled` i `slug`). `buildColumns(tasks: ClickUpTask[], closedMoreHref: string | null): KanbanColumn[]` (zmieniona sygnatura, eksportowana — używa jej Task 6 i ten test).

- [ ] **Step 1: Dodaj `moreHref` do typu `KanbanColumn`**

W `src/lib/types.ts`:

```ts
export type KanbanColumn = {
  id: string
  title: string
  color: string
  type: ClickUpStatus['type']
  tasks: ClickUpTask[]
  /** Link "Zobacz wiecej" pod lista — dziś tylko kolumna "zamkniete", i tylko gdy Historia jest wlaczona. Null = bez linku. */
  moreHref?: string | null
}
```

- [ ] **Step 2: Napisz failing test dla `buildColumns`**

Create `src/components/kanban/KanbanBoard.buildColumns.test.ts`:

```ts
/**
 * `buildColumns`: kolumna "zamkniete" ma limit, wlasne sortowanie (po dacie
 * zamkniecia, nie po priorytecie jak reszta) i opcjonalny link "Zobacz wiecej".
 * Pozostale kolumny nie zmieniaja zachowania — to jest regresja, ktorej ten
 * plik pilnuje.
 *
 *   npx vitest run src/components/kanban/KanbanBoard.buildColumns.test.ts
 */
import { describe, it } from 'vitest'
import assert from 'node:assert'
import type { ClickUpTask } from '@/lib/types'
import { buildColumns } from './KanbanBoard'

function zadanie(nadpisz: Partial<ClickUpTask> & { id: string; status: string }): ClickUpTask {
  return {
    name: 'Zadanie',
    description: '',
    priority: null,
    tags: [],
    date_created: '1',
    date_updated: '1',
    ...nadpisz,
    status: { status: nadpisz.status, color: '#000', type: nadpisz.status === 'zamknięte' ? 'closed' : 'custom', orderindex: 0 },
  } as unknown as ClickUpTask
}

describe('buildColumns', () => {
  it('kolumna zamkniete przycina do 5, mimo wiecej zadan na wejsciu', () => {
    const zamkniete = Array.from({ length: 7 }, (_, i) =>
      zadanie({ id: `z${i}`, status: 'zamknięte', date_closed: String(i) } as Partial<ClickUpTask> & { id: string; status: string })
    )
    const kolumny = buildColumns(zamkniete, null)

    const kolumnaZamkniete = kolumny.find(k => k.id === 'zamknięte')!
    assert.strictEqual(kolumnaZamkniete.tasks.length, 5)
  })

  it('kolumna zamkniete sortuje po dacie zamkniecia, najnowsze pierwsze', () => {
    const zadania = [
      zadanie({ id: 'stare', status: 'zamknięte', date_closed: '100' } as Partial<ClickUpTask> & { id: string; status: string }),
      zadanie({ id: 'nowe', status: 'zamknięte', date_closed: '300' } as Partial<ClickUpTask> & { id: string; status: string }),
      zadanie({ id: 'srednie', status: 'zamknięte', date_closed: '200' } as Partial<ClickUpTask> & { id: string; status: string }),
    ]
    const kolumny = buildColumns(zadania, null)

    const kolumnaZamkniete = kolumny.find(k => k.id === 'zamknięte')!
    assert.deepStrictEqual(kolumnaZamkniete.tasks.map(t => t.id), ['nowe', 'srednie', 'stare'])
  })

  it('inne kolumny NIE dostaja limitu i zostaja sortowane po priorytecie jak dotychczas', () => {
    const zadania = [
      zadanie({ id: '1', status: 'w trakcie', priority: { priority: 'low', id: '1', color: '', orderindex: '1' } } as unknown as Partial<ClickUpTask> & { id: string; status: string }),
      zadanie({ id: '2', status: 'w trakcie', priority: { priority: 'urgent', id: '2', color: '', orderindex: '2' } } as unknown as Partial<ClickUpTask> & { id: string; status: string }),
    ]
    const kolumny = buildColumns(zadania, null)

    const wTrakcie = kolumny.find(k => k.id === 'w trakcie')!
    assert.deepStrictEqual(wTrakcie.tasks.map(t => t.id), ['2', '1'])
  })

  it('moreHref trafia WYLACZNIE do kolumny zamkniete', () => {
    const kolumny = buildColumns([], '/wdf/historia?status=zamkni%C4%99te')

    for (const kolumna of kolumny) {
      if (kolumna.id === 'zamknięte') assert.strictEqual(kolumna.moreHref, '/wdf/historia?status=zamkni%C4%99te')
      else assert.strictEqual(kolumna.moreHref, null, `kolumna ${kolumna.id} nie powinna mieć linku`)
    }
  })

  it('null jako closedMoreHref -> kolumna zamkniete bez linku', () => {
    const kolumny = buildColumns([], null)
    assert.strictEqual(kolumny.find(k => k.id === 'zamknięte')!.moreHref, null)
  })
})
```

- [ ] **Step 3: Uruchom test, sprawdź że pada**

Run: `npx vitest run src/components/kanban/KanbanBoard.buildColumns.test.ts`
Expected: FAIL — `buildColumns` nie jest eksportowana / zła sygnatura (1 argument).

- [ ] **Step 4: Zaktualizuj `buildColumns`**

W `src/components/kanban/KanbanBoard.tsx`, zamień funkcję (linie 67-90):

```ts
const CLOSED_STATUS = 'zamknięte'
const CLOSED_COLUMN_LIMIT = 5

export function buildColumns(tasks: ClickUpTask[], closedMoreHref: string | null): KanbanColumn[] {
  const tasksByStatus: Record<string, ClickUpTask[]> = {}

  for (const col of COLUMN_ORDER) {
    tasksByStatus[col] = []
  }

  for (const task of tasks) {
    const status = task.status.status
    if (tasksByStatus[status]) {
      tasksByStatus[status].push(task)
    } else {
      tasksByStatus['backlog'] = [...(tasksByStatus['backlog'] ?? []), task]
    }
  }

  return COLUMN_ORDER.map(status => {
    const isClosedColumn = status === CLOSED_STATUS
    // Kolumna "zamkniete" NIE sortuje po priorytecie: priorytet ma sens dla
    // pracy w toku, a tu liczy sie to, co zamknieto NAJPOZNIEJ. Reszta kolumn
    // zostaje przy dotychczasowym sortowaniu.
    const columnTasks = isClosedColumn
      ? [...(tasksByStatus[status] ?? [])]
          .sort((a, b) => closedTimestamp(b) - closedTimestamp(a))
          .slice(0, CLOSED_COLUMN_LIMIT)
      : sortByPriority(tasksByStatus[status] ?? [])

    return {
      id: status,
      title: status,
      color: getStatusColor(status),
      type: tasks.find(t => t.status.status === status)?.status.type ?? 'open',
      tasks: columnTasks,
      moreHref: isClosedColumn ? closedMoreHref : null,
    }
  })
}

/** Ten sam przyblizenie jak w lib/clickup.ts — date_closed bywa puste. */
function closedTimestamp(task: ClickUpTask): number {
  return Number(task.date_closed ?? task.date_updated)
}
```

Zaktualizuj wywołanie w komponencie `KanbanBoard` (Task 6 doda właściwy `closedMoreHref`; na razie, żeby plik się kompilował, ustaw prowizorycznie `null` — Task 6 to podmieni):

```ts
  const columns = buildColumns(tasks, null)
```

- [ ] **Step 5: Uruchom test**

Run: `npx vitest run src/components/kanban/KanbanBoard.buildColumns.test.ts`
Expected: PASS, wszystkie 5 testów.

- [ ] **Step 6: Napisz failing test dla linku w `KanbanColumn`**

Create `src/components/kanban/KanbanColumn.test.tsx`:

```tsx
// @vitest-environment jsdom
/**
 * Link "Zobacz wiecej" pod kolumna "zamkniete" — nowy element, wiec test od
 * zera, nie rozszerzenie istniejacego (KanbanColumn nie mial dotad testu).
 *
 *   npx vitest run src/components/kanban/KanbanColumn.test.tsx
 */
import { describe, it, afterEach, vi } from 'vitest'
import assert from 'node:assert'
import { render, screen, cleanup } from '@testing-library/react'
import type { KanbanColumn as KanbanColumnType } from '@/lib/types'
import { KanbanColumn } from './KanbanColumn'

afterEach(cleanup)

function kolumna(nadpisz: Partial<KanbanColumnType> = {}): KanbanColumnType {
  return { id: 'zamknięte', title: 'zamknięte', color: '#008844', type: 'closed', tasks: [], ...nadpisz }
}

describe('link "Zobacz wiecej"', () => {
  it('moreHref ustawiony -> link widoczny i prowadzi na podany adres', () => {
    render(<KanbanColumn column={kolumna({ moreHref: '/wdf/historia?status=zamkni%C4%99te' })} onTaskClick={vi.fn()} />)

    const link = screen.getByRole('link', { name: /Zobacz więcej/ })
    assert.strictEqual(link.getAttribute('href'), '/wdf/historia?status=zamkni%C4%99te')
  })

  it('moreHref null -> bez linku', () => {
    render(<KanbanColumn column={kolumna({ moreHref: null })} onTaskClick={vi.fn()} />)

    assert.strictEqual(screen.queryByRole('link', { name: /Zobacz więcej/ }), null)
  })

  it('kolumna bez pola moreHref (inne kolumny) -> bez linku, bez wywalenia', () => {
    render(<KanbanColumn column={kolumna({ id: 'w trakcie', title: 'w trakcie', moreHref: undefined })} onTaskClick={vi.fn()} />)

    assert.strictEqual(screen.queryByRole('link', { name: /Zobacz więcej/ }), null)
  })
})
```

- [ ] **Step 7: Uruchom test, sprawdź że pada**

Run: `npx vitest run src/components/kanban/KanbanColumn.test.tsx`
Expected: FAIL — link nie istnieje w drzewie.

- [ ] **Step 8: Dodaj link do `KanbanColumn.tsx`**

W `src/components/kanban/KanbanColumn.tsx`, zamień import lucide-react:

```ts
import { ChevronRight } from 'lucide-react'
```

Po zamknięciu drop-zone `</div>` (obecnie ostatni element przed zamknięciem głównego `<div>`), dopisz:

```tsx
      {column.moreHref && (
        <a
          href={column.moreHref}
          className="mt-1 flex items-center justify-center gap-1 rounded-md py-1.5 text-xs text-muted-foreground transition-colors hover:bg-muted hover:text-foreground"
        >
          Zobacz więcej
          <ChevronRight className="h-3 w-3" aria-hidden />
        </a>
      )}
```

- [ ] **Step 9: Uruchom test**

Run: `npx vitest run src/components/kanban/KanbanColumn.test.tsx`
Expected: PASS.

- [ ] **Step 10: Commit**

```bash
git add src/lib/types.ts src/components/kanban/KanbanBoard.tsx src/components/kanban/KanbanColumn.tsx src/components/kanban/KanbanBoard.buildColumns.test.ts src/components/kanban/KanbanColumn.test.tsx
git commit -m "feat(kanban): kolumna zamkniete z limitem 5, sortowaniem po dacie i linkiem do Historii"
```

---

## Task 6: Przekazanie `statusControlsEnabled` i `closedMoreHref` przez `KanbanBoardClient`/`KanbanBoard`, wznowienie `handleTaskUpdated`

**Files:**
- Modify: `src/components/kanban/KanbanBoardClient.tsx`
- Modify: `src/components/kanban/KanbanBoard.tsx`

**Interfaces:**
- Consumes: `buildColumns(tasks, closedMoreHref)` (Task 5), `flags.historyEnabled` (już prop `KanbanBoard`).
- Produces: `KanbanBoardProps.statusControlsEnabled: boolean`; `<TaskDrawer>` dostaje `statusControlsEnabled` i `onTaskUpdated` — konsumowane w Task 7.

- [ ] **Step 1: Dodaj prop do `KanbanBoardClient`**

W `src/components/kanban/KanbanBoardClient.tsx`:

```ts
interface Props {
  initialTasks: ClickUpTask[]
  slug: string
  portalName: string
  userEmail: string
  flags: PortalFlags
  branding: PortalBranding
  siteUrl: string | null
  statusControlsEnabled: boolean
}
```

(`KanbanBoard` odbiera te same propsy przez spread `{...props}`, więc wystarczy zmiana typu tutaj.)

- [ ] **Step 2: Dodaj prop do `KanbanBoardProps` i policz `closedMoreHref`**

W `src/components/kanban/KanbanBoard.tsx`, w `KanbanBoardProps`:

```ts
interface KanbanBoardProps {
  initialTasks: ClickUpTask[]
  slug: string
  portalName: string
  userEmail: string
  flags: PortalFlags
  branding: PortalBranding
  siteUrl: string | null
  statusControlsEnabled: boolean
}
```

W sygnaturze komponentu:

```ts
export function KanbanBoard({ initialTasks, slug, portalName, userEmail, flags, branding, siteUrl, statusControlsEnabled }: KanbanBoardProps) {
```

Zamień prowizoryczne `null` z Taska 5:

```ts
  // Link tylko gdy klient ma dostep do Historii — inaczej prowadziłby na
  // strone, ktora go odesle z powrotem (brama serwerowa w historia/page.tsx).
  const closedMoreHref = flags.historyEnabled
    ? `/${slug}/historia?status=${encodeURIComponent('zamknięte')}`
    : null

  const columns = buildColumns(tasks, closedMoreHref)
```

(Umieść to bezpośrednio przed dotychczasową linią `const columns = buildColumns(tasks)`, którą usuwasz.)

- [ ] **Step 3: Wznów `handleTaskUpdated` — zsynchronizuj też otwartą szufladę**

Zamień istniejącą, dotąd nieużywaną funkcję:

```ts
  function handleTaskUpdated(updatedTask: ClickUpTask) {
    setTasks(prev => prev.map(t => (t.id === updatedTask.id ? updatedTask : t)))
  }
```

na:

```ts
  /**
   * Podlaczone do dropdownu statusu w TaskDrawer (Task 7). Aktualizuje DWIE
   * rzeczy, nie jedna: `tasks` (żeby karta wskoczyła do nowej kolumny po
   * zamknieciu szuflady) i `selectedTask` (żeby OTWARTA szuflada natychmiast
   * pokazala nowy status, bez zamykania i otwierania zadania na nowo).
   */
  function handleTaskUpdated(updatedTask: ClickUpTask) {
    setTasks(prev => prev.map(t => (t.id === updatedTask.id ? updatedTask : t)))
    setSelectedTask(prev => (prev && prev.id === updatedTask.id ? updatedTask : prev))
  }
```

- [ ] **Step 4: Podłącz propsy do `<TaskDrawer>`**

Zamień:

```tsx
      {selectedTask && (
        <TaskDrawer
          task={selectedTask}
          slug={slug}
          onClose={() => setSelectedTask(null)}
          onNavigate={(id) => {
            const t = findTaskInTree(tasks, id)
            if (t) setSelectedTask(t)
          }}
        />
      )}
```

na:

```tsx
      {selectedTask && (
        <TaskDrawer
          task={selectedTask}
          slug={slug}
          statusControlsEnabled={statusControlsEnabled}
          onTaskUpdated={handleTaskUpdated}
          onClose={() => setSelectedTask(null)}
          onNavigate={(id) => {
            const t = findTaskInTree(tasks, id)
            if (t) setSelectedTask(t)
          }}
        />
      )}
```

- [ ] **Step 5: Sprawdź typy**

Run: `npx tsc --noEmit`
Expected: błąd — `TaskDrawer` (jeszcze) nie przyjmuje `statusControlsEnabled`/`onTaskUpdated`. To jest oczekiwane, Task 7 to naprawia. Zanotuj błąd i przejdź do Task 7 PRZED commitem tego taska (te dwa taski scommitujesz razem, żeby drzewo nigdy nie było w stanie nieprzechodzącym `tsc`).

---

## Task 7: Dropdown zmiany statusu w `TaskDrawer`

**Files:**
- Modify: `src/components/kanban/TaskDrawer.tsx`
- Modify: `src/components/kanban/TaskDrawer.test.tsx`

**Interfaces:**
- Consumes: `statusControlsEnabled: boolean`, `onTaskUpdated?: (task: ClickUpTask) => void` (Task 6), `STATUS_COLUMNS` (`@/lib/utils`), `PATCH /api/clickup/tasks/{taskId}?slug=` (istniejąca trasa, bez zmian — patrz `src/app/api/clickup/tasks/[taskId]/route.ts:59-107`, przyjmuje `{status: string}`, zwraca `{task}`).
- Produces: kompletuje Task 6 (TaskDrawer.tsx przyjmuje propsy, które KanbanBoard.tsx już przekazuje).

- [ ] **Step 1: Napisz failing testy komponentowe**

W `src/components/kanban/TaskDrawer.test.tsx`, dopisz na końcu pliku:

```tsx
describe('dropdown statusu (statusControlsEnabled)', () => {
  it('flaga WYLACZONA (domyslnie) -> plakietka statusu, BEZ dropdownu', async () => {
    render(<TaskDrawer task={zadanie()} {...wlasciwosci} />)
    await screen.findByText('Brak komentarzy')

    const status = screen.getByText('w trakcie')
    assert.notStrictEqual(status.tagName, 'BUTTON', 'bez flagi to nadal plakietka, nie przycisk')
  })

  it('flaga WLACZONA -> status jest przyciskiem z rozwijanym menu', async () => {
    render(<TaskDrawer task={zadanie()} {...wlasciwosci} statusControlsEnabled />)
    await screen.findByText('Brak komentarzy')

    const przycisk = screen.getByRole('button', { name: /w trakcie/ })
    assert.ok(przycisk)
  })

  it('wybor NOWEGO statusu wysyla PATCH i zglasza sie do onTaskUpdated', async () => {
    const uzytkownik = userEvent.setup()
    const onTaskUpdated = vi.fn()
    render(<TaskDrawer task={zadanie()} {...wlasciwosci} statusControlsEnabled onTaskUpdated={onTaskUpdated} />)
    await screen.findByText('Brak komentarzy')

    fetchMock.mockImplementation(async (url: string, opcje: RequestInit) => ({
      ok: true,
      json: async () =>
        (opcje as RequestInit).method === 'PATCH'
          ? { task: { ...zadanie(), status: { status: 'zamknięte', color: '#008844', type: 'closed' } } }
          : { attachments: [], reporter: null },
    }))

    await uzytkownik.click(screen.getByRole('button', { name: /w trakcie/ }))
    await uzytkownik.click(await screen.findByRole('menuitem', { name: /zamknięte/ }))

    const wywolaniePatch = fetchMock.mock.calls.find(c => (c[1] as RequestInit)?.method === 'PATCH')
    assert.ok(wywolaniePatch, 'PATCH zostal wyslany')
    assert.match(wywolaniePatch![0] as string, /\/api\/clickup\/tasks\/zad-1\?slug=wdf/)
    assert.deepStrictEqual(JSON.parse((wywolaniePatch![1] as RequestInit).body as string), { status: 'zamknięte' })

    await waitFor(() => assert.strictEqual(onTaskUpdated.mock.calls.length, 1))
    assert.strictEqual(onTaskUpdated.mock.calls[0][0].status.status, 'zamknięte')
  })

  it('wybor TEGO SAMEGO statusu nie wysyla PATCH', async () => {
    const uzytkownik = userEvent.setup()
    render(<TaskDrawer task={zadanie()} {...wlasciwosci} statusControlsEnabled />)
    await screen.findByText('Brak komentarzy')
    fetchMock.mockClear()

    await uzytkownik.click(screen.getByRole('button', { name: /w trakcie/ }))
    const pozycjaAktualna = await screen.findByRole('menuitem', { name: /^w trakcie$/ })
    assert.strictEqual(pozycjaAktualna.getAttribute('aria-disabled'), 'true')
  })

  it('blad PATCH pokazuje toast i NIE zglasza sie do onTaskUpdated', async () => {
    const uzytkownik = userEvent.setup()
    const onTaskUpdated = vi.fn()
    render(<TaskDrawer task={zadanie()} {...wlasciwosci} statusControlsEnabled onTaskUpdated={onTaskUpdated} />)
    await screen.findByText('Brak komentarzy')

    fetchMock.mockImplementation(async (url: string, opcje: RequestInit) => ({
      ok: (opcje as RequestInit)?.method !== 'PATCH',
      json: async () => ({ attachments: [], reporter: null }),
    }))

    await uzytkownik.click(screen.getByRole('button', { name: /w trakcie/ }))
    await uzytkownik.click(await screen.findByRole('menuitem', { name: /zamknięte/ }))

    await waitFor(() => assert.strictEqual(toast.error.mock.calls.length, 1))
    assert.strictEqual(onTaskUpdated.mock.calls.length, 0)
  })
})
```

- [ ] **Step 2: Uruchom testy, sprawdź że padają**

Run: `npx vitest run src/components/kanban/TaskDrawer.test.tsx`
Expected: nowe testy z bloku `'dropdown statusu'` FAIL (props jeszcze nie istnieją); wszystkie wcześniejsze testy w pliku dalej PASS (żadny stary test nie odwołuje się do propsów, które dopiero dodajesz).

- [ ] **Step 3: Dodaj importy**

W `src/components/kanban/TaskDrawer.tsx`, zamień:

```ts
import { useState, useEffect, useRef } from 'react'
import type { ClickUpTask, ClickUpComment, ClickUpAttachment } from '@/lib/types'
import { formatDate, formatDuration, getPriorityColor, getPriorityLabel, getStatusColor, isAwaria } from '@/lib/utils'
import { X, Calendar, MessageSquare, Send, Loader2, CheckSquare, Clock, Timer, ChevronLeft, ChevronRight, Paperclip, FileText, User, AlertTriangle } from 'lucide-react'
```

na:

```ts
import { useState, useEffect, useRef } from 'react'
import type { ClickUpTask, ClickUpComment, ClickUpAttachment } from '@/lib/types'
import { formatDate, formatDuration, getPriorityColor, getPriorityLabel, getStatusColor, isAwaria, STATUS_COLUMNS } from '@/lib/utils'
import { X, Calendar, MessageSquare, Send, Loader2, CheckSquare, Clock, Timer, ChevronLeft, ChevronRight, ChevronDown, Paperclip, FileText, User, AlertTriangle } from 'lucide-react'
import {
  DropdownMenu,
  DropdownMenuTrigger,
  DropdownMenuContent,
  DropdownMenuItem,
} from '@/components/ui/dropdown-menu'
```

- [ ] **Step 4: Zaktualizuj propsy i dodaj stan/handler**

Zamień:

```ts
interface TaskDrawerProps {
  task: ClickUpTask
  slug: string
  onClose: () => void
  onNavigate?: (taskId: string) => void
}

export function TaskDrawer({ task, slug, onClose, onNavigate }: TaskDrawerProps) {
```

na:

```ts
interface TaskDrawerProps {
  task: ClickUpTask
  slug: string
  onClose: () => void
  onNavigate?: (taskId: string) => void
  /** Za flaga portalu `statusControlsEnabled`. Bez niej: plakietka statusu jak dotychczas, bez interakcji. */
  statusControlsEnabled?: boolean
  /** Wywolywane PO potwierdzonej przez serwer zmianie statusu — task niesie SWIEZY stan z ClickUpa. */
  onTaskUpdated?: (task: ClickUpTask) => void
}

export function TaskDrawer({ task, slug, onClose, onNavigate, statusControlsEnabled = false, onTaskUpdated }: TaskDrawerProps) {
```

Po `const [reporter, setReporter] = useState<...>(null)` dodaj:

```ts
  const [changingStatus, setChangingStatus] = useState(false)
```

Po funkcji `handleSendComment` (przed `const priorityColor = ...`) dodaj:

```ts
  /**
   * Ten sam PATCH, ktorego dzis wola przeciagniecie karty (KanbanBoard.tsx).
   * SWIADOMIE bez optymistycznej zmiany widoku: plakietka pokazuje nowy
   * status wylacznie PO potwierdzeniu przez serwer, wiec nigdy nie pokazuje
   * stanu, ktory sie nie zapisal.
   */
  async function handleStatusChange(newStatus: string) {
    if (newStatus === task.status.status || changingStatus) return

    setChangingStatus(true)
    try {
      const res = await fetch(`/api/clickup/tasks/${task.id}?slug=${encodeURIComponent(slug)}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ status: newStatus }),
      })
      if (!res.ok) throw new Error('Update failed')
      const data = await res.json()
      onTaskUpdated?.(data.task)
    } catch {
      toast.error('Nie udało się zmienić statusu')
    } finally {
      setChangingStatus(false)
    }
  }
```

- [ ] **Step 5: Zamień plakietkę statusu na warunkowy dropdown**

Zamień (linie ok. 199-205):

```tsx
              {/* Status badge */}
              <span
                className="inline-flex items-center rounded-full px-2 py-0.5 text-xs font-medium text-white"
                style={{ backgroundColor: statusColor }}
              >
                {task.status.status}
              </span>
```

na:

```tsx
              {/* Status: dropdown za flaga, inaczej plakietka jak dotychczas. */}
              {statusControlsEnabled ? (
                <DropdownMenu>
                  <DropdownMenuTrigger asChild>
                    <button
                      type="button"
                      disabled={changingStatus}
                      className="inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-xs font-medium text-white disabled:opacity-60"
                      style={{ backgroundColor: statusColor }}
                    >
                      {task.status.status}
                      <ChevronDown className="h-3 w-3 opacity-80" aria-hidden />
                    </button>
                  </DropdownMenuTrigger>
                  <DropdownMenuContent align="start">
                    {STATUS_COLUMNS.map(status => (
                      <DropdownMenuItem
                        key={status}
                        disabled={status === task.status.status}
                        onSelect={() => handleStatusChange(status)}
                      >
                        <span
                          className="h-2 w-2 rounded-full flex-shrink-0"
                          style={{ backgroundColor: getStatusColor(status) }}
                          aria-hidden
                        />
                        {status}
                      </DropdownMenuItem>
                    ))}
                  </DropdownMenuContent>
                </DropdownMenu>
              ) : (
                <span
                  className="inline-flex items-center rounded-full px-2 py-0.5 text-xs font-medium text-white"
                  style={{ backgroundColor: statusColor }}
                >
                  {task.status.status}
                </span>
              )}
```

- [ ] **Step 6: Uruchom testy**

Run: `npx vitest run src/components/kanban/TaskDrawer.test.tsx`
Expected: PASS, wszystkie testy w pliku (stare i nowe).

- [ ] **Step 7: `tsc` na całym projekcie (domyka Task 6 + Task 7 razem)**

Run: `npx tsc --noEmit`
Expected: 0 błędów.

- [ ] **Step 8: Commit (Task 6 + Task 7 razem — Task 6 sam nie kompilował się bez tego)**

```bash
git add src/components/kanban/KanbanBoardClient.tsx src/components/kanban/KanbanBoard.tsx src/components/kanban/TaskDrawer.tsx src/components/kanban/TaskDrawer.test.tsx
git commit -m "feat(kanban): dropdown zmiany statusu w szufladzie zadania, za flaga statusControlsEnabled"
```

---

## Task 8: Weryfikacja końcowa

**Files:** żadne nowe — ten task tylko uruchamia całość i sprawdza ręcznie.

- [ ] **Step 1: Pełna weryfikacja**

Run: `docker start cp-test-pg && npm run verify`
Expected: kod wyjścia 0 (tsc + eslint + wszystkie testy + `next build`).

- [ ] **Step 2: Ręczny smoke test na `dev`**

```bash
npm run db:migrate     # jeśli jeszcze nie wykonane w Task 1
npm run db:seed        # portal wdf + klient@wdf.pl, jeśli baza jest pusta
npm run dev
```

Włącz flagę dla portalu `wdf` (wymaga `CLICKUP_API_TOKEN` w `.env.local`, żeby kanban miał realne dane):

```bash
curl -X PATCH localhost:3000/api/admin/portals \
  -H "Authorization: Bearer $ADMIN_API_TOKEN" -H 'Content-Type: application/json' \
  -d '{"slug":"wdf","statusControlsEnabled":true,"historyEnabled":true}'
```

W przeglądarce, zalogowany jako `klient@wdf.pl` na `/wdf`:
1. Otwórz jakiekolwiek zadanie — status ma być teraz klikalnym przyciskiem z ikoną rozwijania.
2. Zmień status na dowolny inny — plakietka ma się zmienić PO chwili (czeka na serwer), karta na tablicy ma wskoczyć do nowej kolumny po zamknięciu szuflady.
3. Zmień status jakiegoś zadania na „zamknięte” (przeciągnięciem albo dropdownem) — poczekaj na odświeżenie (przycisk „Odśwież” w headerze) i sprawdź, że karta NIE zniknęła, tylko stoi w kolumnie „zamknięte”.
4. Sprawdź kolumnę „zamknięte”: nie więcej niż 5 kart, i pod nimi link „Zobacz więcej” prowadzący do `/wdf/historia?status=zamkni%C4%99te` z przefiltrowaną listą.
5. Wyłącz flagę tym samym curlem (`"statusControlsEnabled":false`) i odśwież `/wdf` — status ma wrócić do statycznej plakietki, kolumna „zamknięte” ma wrócić do stanu sprzed zmiany (puste albo tylko to, co tam było zanim włączono flagę — bez nowego wywołania ClickUpa).

- [ ] **Step 3: Zdaj raport Łukaszowi**

Flaga `statusControlsEnabled` zostaje WYŁĄCZONA na produkcji po wdrożeniu (zgodnie z regułą projektu — nowa funkcja klienta nigdy nie włącza się sama). Włączenie per projekt to osobna decyzja, przez:

```bash
curl -X PATCH https://portal.important.is/api/admin/portals \
  -H "Authorization: Bearer $ADMIN_API_TOKEN" -H 'Content-Type: application/json' \
  -d '{"slug":"<slug>","statusControlsEnabled":true}'
```
