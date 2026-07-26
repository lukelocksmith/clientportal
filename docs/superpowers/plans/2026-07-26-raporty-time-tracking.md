# Zakładka Raporty: plan wdrożenia

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Klient portalu widzi w osobnej zakładce, ile czasu zespół zalogował na jego zadaniach w wybranym zamkniętym tygodniu lub miesiącu.

**Architecture:** Dane pochodzą z endpointu ClickUp `time_entries` filtrowanego po `folder_id` klienta, nie z tabeli `task_time_snapshots`. Cała logika okresów i agregacji siedzi w czystym module `src/lib/timeReports.ts`, bez zależności od Next i bazy, więc daje się sprawdzić skryptem. Strona jest Server Componentem, okres trzymany w URL, więc raport da się podlinkować.

**Tech Stack:** Next 16.2.9 (App Router, Turbopack), TypeScript, Tailwind v4, shadcn (pilotaż), date-fns 4 z `@date-fns/tz`, Zod 4, Drizzle.

**Spec:** `docs/superpowers/specs/2026-07-26-raporty-time-tracking-design.md`

## Global Constraints

- Next 16.2.9: `params` i `searchParams` w `page.tsx` to **Promise**, trzeba je `await`. Potwierdzone w `node_modules/next/dist/docs/01-app/03-api-reference/03-file-conventions/page.md`.
- Cache pobrań: `fetch(url, { next: { revalidate: 300 } })`. Nie łączyć z `cache: 'no-store'`, obie opcje zostaną wtedy zignorowane. Potwierdzone w `node_modules/next/dist/docs/01-app/03-api-reference/04-functions/fetch.md`.
- Tailwind v4 bez pliku konfiguracyjnego. Tokeny kolorów żyją w bloku `@theme` w `src/app/globals.css` jako `--color-*`, dark mode nadpisuje je w `.dark`.
- **Turbopack gotcha:** nowo dodane klasy utility czasem nie kompilują się na hot reload. Objaw to element bez stylu przy poprawnej klasie w HTML. Fix: zatrzymać dev server, `rm -rf .next`, uruchomić ponownie.
- Formatowanie czasu wyłącznie przez istniejący `formatDuration` z `src/lib/utils.ts`. Zwraca pusty string dla wartości poniżej minuty.
- Klient nie widzi osób ani nazw list. Pole `user` z odpowiedzi ClickUp jest ignorowane w całości.
- **Teksty w UI bez myślnika (—).** Zamiast niego przecinek, kropka albo przebudowane zdanie.
- W repo nie ma runnera testów. Weryfikacja skryptami uruchamianymi przez `npx tsx`, z `node:assert/strict`. Skrypt kończy się niezerowym kodem przy błędzie.
- Import ścieżkowy `@/*` wskazuje na `src/*`.
- **Commity:** jesteśmy na `main`. Przed pierwszym commitem założyć branch `feat/raporty-time-tracking`. Kroki commitowe są w planie przygotowane, ale wykonujący pyta Łukasza o zgodę przed pierwszym commitem i nie pushuje bez wyraźnego polecenia.

## Odstępstwa od specu i ich powód

Dwa świadome odejścia od zapisu w specu, oba upraszczają wdrożenie:

1. **Przełącznik Tydzień/Miesiąc na dwóch `Link`ach, nie na shadcn `Tabs`.** Przełącznik zmienia URL, a nie stan komponentu, więc `Tabs` wymagałoby granicy klienta i hydratacji po to, żeby udawać nawigację. Dwa `Link`i stylowane jak segmented control dają ten sam wygląd, działają bez JS i nie potrzebują `'use client'`. shadcn dokłada więc `card`, `table` i `dropdown-menu`, bez `tabs`.
2. **Skrypty weryfikacyjne w repo, w `scripts/`, nie w katalogu roboczym sesji.** Node rozwiązuje `node_modules` względem katalogu pliku, nie względem `cwd`, więc skrypt leżący poza drzewem projektu nie zaimportuje ani `date-fns`, ani modułów z `src/`. Sprawdzone empirycznie: uruchomienie z katalogu tymczasowego wywala się na resolucji `dotenv`.

## File Structure

**Nowe:**

| Plik | Odpowiedzialność |
|---|---|
| `src/lib/timeReports.ts` | Czysta logika: definicje okresów, parsowanie i formatowanie kluczy, agregacja wpisów czasu. Zero zależności od Next, bazy i sieci. |
| `src/components/reports/ReportView.tsx` | Server Component. Cały układ raportu: suma, tabela, stan pusty, stan błędu. |
| `src/components/reports/PeriodPicker.tsx` | Client Component. Przełącznik Tydzień/Miesiąc, strzałki, lista okresów. Tylko nawigacja, bez pobierania danych. |
| `src/components/PortalHeader.tsx` | Client Component. Wspólny header portalu z zakładkami, akcje po prawej jako `children`. |
| `src/app/[slug]/raporty/page.tsx` | Odczyt sesji i portalu, walidacja parametrów URL, pobranie danych, złożenie widoku. |
| `src/components/ui/{card,table,dropdown-menu}.tsx` | Wygenerowane przez shadcn, nietykane ręcznie. |
| `components.json` | Konfiguracja CLI shadcn. |
| `scripts/check-timeReports.ts` | Weryfikacja `listPeriods`, `parsePeriodKey`, `shiftPeriod`. |
| `scripts/check-buildReport.ts` | Weryfikacja agregacji na zapisanej odpowiedzi ClickUp. |
| `scripts/fixtures/onyx-time-entries-2026-W29.json` | Odchudzona prawdziwa odpowiedź ClickUp, bez danych osobowych. |
| `scripts/check-clickup-time-entries.ts` | Weryfikacja na żywo, wymaga `.env.local`. |

**Modyfikowane:**

| Plik | Zmiana |
|---|---|
| `src/lib/types.ts` | Dochodzi typ `ClickUpTimeEntry`. |
| `src/lib/clickup.ts` | Dochodzą `getTimeEntries` i `getWorkspaceMemberIds`. |
| `src/app/globals.css` | Dochodzą tokeny `--color-popover` i `--color-popover-foreground`, w `@theme` i w `.dark`. |
| `src/components/kanban/KanbanBoard.tsx:170-204` | Header zastąpiony użyciem `PortalHeader`. |
| `.env.local` | Dochodzi `CLICKUP_TEAM_ID=4552118`. |
| `package.json` | Dochodzi `@date-fns/tz`. |

---

### Task 1: Okresy raportowe w strefie Warszawy

Fundament. Wszystko dalsze zależy od poprawnych granic tygodni i miesięcy.

**Files:**
- Create: `src/lib/timeReports.ts`
- Create: `scripts/check-timeReports.ts`
- Modify: `package.json` (dependency `@date-fns/tz`)

**Interfaces:**
- Consumes: nic z wcześniejszych zadań.
- Produces:
  - `type PeriodKind = 'tydzien' | 'miesiac'`
  - `interface Period { kind: PeriodKind; key: string; label: string; startMs: number; endMs: number }`
  - `listPeriods(kind: PeriodKind, count?: number, now?: Date): Period[]`
  - `parsePeriodKey(kind: PeriodKind, key: string, now?: Date): Period | null`
  - `shiftPeriod(period: Period, delta: number, now?: Date): Period | null`

- [ ] **Step 1: Dodaj zależność**

```bash
npm install @date-fns/tz@^1.5.0
```

Sprawdź, że `date-fns` zostało na wersji 4:

```bash
node -e "console.log(require('./package.json').dependencies['date-fns'], require('./package.json').dependencies['@date-fns/tz'])"
```

Oczekiwane: `^4.4.0 ^1.5.0`

- [ ] **Step 2: Napisz skrypt weryfikacyjny, który ma nie przejść**

Wartości w asercjach są policzone niezależnie, przez `zoneinfo` w Pythonie, i są prawdziwe dla strefy `Europe/Warsaw`.

```ts
// scripts/check-timeReports.ts
/**
 * Weryfikacja logiki okresów raportowych. Uruchomienie:
 *   npx tsx scripts/check-timeReports.ts
 * Kończy się kodem 1 przy pierwszej nieudanej asercji.
 *
 * Wartości oczekiwane policzone niezależnie dla strefy Europe/Warsaw.
 */
import assert from 'node:assert/strict'
import { listPeriods, parsePeriodKey, shiftPeriod } from '../src/lib/timeReports'

const H = 3_600_000

// Punkt odniesienia: niedziela 26 lipca 2026. Bieżący tydzień to 20-26 lipca,
// więc ostatni zamknięty to 13-19 lipca.
const ref = new Date('2026-07-26T12:00:00+02:00')

{
  const weeks = listPeriods('tydzien', 12, ref)
  assert.equal(weeks.length, 12)
  assert.equal(weeks[0].key, '2026-W29')
  assert.equal(weeks[0].startMs, 1783893600000)
  assert.equal(weeks[0].endMs, 1784498399999)
  assert.equal(weeks[0].label, '13-19 lipca 2026')
  assert.equal(weeks[1].key, '2026-W28')
  // Bieżący tydzień nie pojawia się na liście.
  assert.ok(!weeks.some(w => w.key === '2026-W30'))
}

{
  const months = listPeriods('miesiac', 12, ref)
  assert.equal(months[0].key, '2026-06')
  assert.equal(months[0].startMs, 1780264800000)
  assert.equal(months[0].endMs, 1782856799999)
  assert.equal(months[0].label, 'czerwiec 2026')
  assert.ok(!months.some(m => m.key === '2026-07'))
}

{
  // Przełom roku: 2026 ma 53 tygodnie ISO, więc ostatni zamknięty tydzień
  // na 4 stycznia 2027 to 2026-W53, nie 2027-W01.
  const weeks = listPeriods('tydzien', 3, new Date('2027-01-04T09:00:00+01:00'))
  assert.equal(weeks[0].key, '2026-W53')
  assert.equal(weeks[0].startMs, 1798412400000)
  assert.equal(weeks[0].endMs, 1799017199999)
}

{
  // Zmiana czasu na letni w nocy 28/29 marca 2026: ten tydzień ma 167 godzin.
  // Implementacja licząca granice w UTC da równe 168 i tu polegnie.
  const weeks = listPeriods('tydzien', 1, new Date('2026-04-01T09:00:00+02:00'))
  assert.equal(weeks[0].key, '2026-W13')
  assert.equal(weeks[0].startMs, 1774220400000)
  assert.equal(weeks[0].endMs, 1774821599999)
  const hours = (weeks[0].endMs - weeks[0].startMs + 1) / H
  assert.equal(hours, 167, `tydzień DST ma mieć 167h, jest ${hours}`)
}

{
  // Powrót z czasu letniego 25 października 2026: tydzień 26.10-1.11 ma 168h,
  // a tydzień 19-25.10 ma 169h.
  const weeks = listPeriods('tydzien', 2, new Date('2026-11-02T09:00:00+01:00'))
  assert.equal(weeks[0].key, '2026-W44')
  assert.equal(weeks[0].startMs, 1792969200000)
  assert.equal((weeks[1].endMs - weeks[1].startMs + 1) / H, 169)
}

{
  // Etykieta tygodnia przechodzącego między miesiącami.
  const weeks = listPeriods('tydzien', 1, new Date('2026-07-08T09:00:00+02:00'))
  assert.equal(weeks[0].label, '29 cze - 5 lip 2026')
}

{
  // parsePeriodKey przyjmuje zamknięty okres i odrzuca wszystko inne.
  assert.equal(parsePeriodKey('tydzien', '2026-W29', ref)?.startMs, 1783893600000)
  assert.equal(parsePeriodKey('tydzien', '2026-W30', ref), null, 'bieżący tydzień odrzucony')
  assert.equal(parsePeriodKey('tydzien', '2026-W40', ref), null, 'przyszły tydzień odrzucony')
  assert.equal(parsePeriodKey('tydzien', '2027-W53', ref), null, '2027 nie ma 53 tygodni')
  assert.equal(parsePeriodKey('tydzien', 'bzdura', ref), null)
  assert.equal(parsePeriodKey('tydzien', '2026-W00', ref), null)
  assert.equal(parsePeriodKey('miesiac', '2026-06', ref)?.key, '2026-06')
  assert.equal(parsePeriodKey('miesiac', '2026-07', ref), null, 'bieżący miesiąc odrzucony')
  assert.equal(parsePeriodKey('miesiac', '2026-13', ref), null)
}

{
  // shiftPeriod: -1 to starszy okres, +1 to nowszy. Nowszy niż ostatni
  // zamknięty nie istnieje, więc strzałka w prawo ma się wyłączyć.
  const last = listPeriods('tydzien', 1, ref)[0]
  assert.equal(shiftPeriod(last, -1, ref)?.key, '2026-W28')
  assert.equal(shiftPeriod(last, 1, ref), null)
  const older = parsePeriodKey('tydzien', '2026-W20', ref)!
  assert.equal(shiftPeriod(older, 1, ref)?.key, '2026-W21')
  const lastMonth = listPeriods('miesiac', 1, ref)[0]
  assert.equal(shiftPeriod(lastMonth, -1, ref)?.key, '2026-05')
  assert.equal(shiftPeriod(lastMonth, 1, ref), null)
}

console.log('check-timeReports: OK')
```

- [ ] **Step 3: Uruchom skrypt i potwierdź, że nie przechodzi**

Run: `npx tsx scripts/check-timeReports.ts`
Expected: FAIL, komunikat o nieudanym imporcie `../src/lib/timeReports` (moduł jeszcze nie istnieje).

- [ ] **Step 4: Zaimplementuj `src/lib/timeReports.ts`**

```ts
/**
 * Okresy raportowe i agregacja czasu dla zakładki Raporty.
 *
 * Czysty moduł, bez zależności od Next, bazy i sieci, żeby dał się sprawdzić
 * skryptem (patrz scripts/check-timeReports.ts).
 *
 * WAŻNE, granice okresów liczymy jawnie w strefie Europe/Warsaw przez TZDate,
 * a nie na ambientnym TZ procesu. Kontener produkcyjny chodzi na UTC i bez tego
 * poniedziałek przed godziną 2:00 wpadałby do poprzedniego tygodnia, a sumy
 * nie zgadzałyby się z ClickUp.
 */
import { TZDate } from '@date-fns/tz'
import {
  endOfISOWeek,
  endOfMonth,
  format,
  getISOWeek,
  getISOWeekYear,
  isSameMonth,
  setISOWeek,
  setISOWeekYear,
  startOfISOWeek,
  startOfMonth,
  subMonths,
  subWeeks,
} from 'date-fns'
import { pl } from 'date-fns/locale'

const TZ = 'Europe/Warsaw'

export type PeriodKind = 'tydzien' | 'miesiac'

export interface Period {
  kind: PeriodKind
  /** '2026-W29' dla tygodnia, '2026-07' dla miesiąca. Trafia do URL. */
  key: string
  /** '13-19 lipca 2026' albo 'czerwiec 2026'. */
  label: string
  startMs: number
  /** Ostatnia milisekunda okresu, czyli 23:59:59.999 ostatniego dnia. */
  endMs: number
}

function inWarsaw(now: Date): TZDate {
  return new TZDate(now.getTime(), TZ)
}

function formatWeekLabel(start: Date, end: Date): string {
  if (isSameMonth(start, end)) {
    return `${format(start, 'd')}-${format(end, 'd MMMM yyyy', { locale: pl })}`
  }
  return `${format(start, 'd MMM', { locale: pl })} - ${format(end, 'd MMM yyyy', { locale: pl })}`
}

function weekFrom(start: Date): Period {
  const end = endOfISOWeek(start)
  return {
    kind: 'tydzien',
    key: `${getISOWeekYear(start)}-W${String(getISOWeek(start)).padStart(2, '0')}`,
    label: formatWeekLabel(start, end),
    startMs: start.getTime(),
    endMs: end.getTime(),
  }
}

function monthFrom(start: Date): Period {
  return {
    kind: 'miesiac',
    key: format(start, 'yyyy-MM'),
    label: format(start, 'LLLL yyyy', { locale: pl }),
    startMs: start.getTime(),
    endMs: endOfMonth(start).getTime(),
  }
}

/** Początek bieżącego, jeszcze niezamkniętego okresu. */
function currentPeriodStart(kind: PeriodKind, now: Date): Date {
  const base = inWarsaw(now)
  return kind === 'tydzien' ? startOfISOWeek(base) : startOfMonth(base)
}

/**
 * Zamknięte okresy, najnowszy pierwszy. Bieżący okres nigdy się tu nie pojawia,
 * bo klient nie ma widzieć liczby rosnącej w trakcie oglądania.
 */
export function listPeriods(kind: PeriodKind, count = 12, now: Date = new Date()): Period[] {
  const out: Period[] = []
  if (kind === 'tydzien') {
    const lastClosed = subWeeks(currentPeriodStart('tydzien', now), 1)
    for (let i = 0; i < count; i++) out.push(weekFrom(subWeeks(lastClosed, i)))
  } else {
    const lastClosed = subMonths(currentPeriodStart('miesiac', now), 1)
    for (let i = 0; i < count; i++) out.push(monthFrom(subMonths(lastClosed, i)))
  }
  return out
}

/**
 * Zamienia klucz z URL na okres. Zwraca null dla klucza niepoprawnego,
 * nieistniejącego (np. 2027-W53) oraz dla okresu bieżącego i przyszłego.
 */
export function parsePeriodKey(kind: PeriodKind, key: string, now: Date = new Date()): Period | null {
  const base = inWarsaw(now)

  if (kind === 'tydzien') {
    const m = /^(\d{4})-W(\d{2})$/.exec(key)
    if (!m) return null
    const week = Number(m[2])
    if (week < 1 || week > 53) return null
    const start = startOfISOWeek(setISOWeek(setISOWeekYear(base, Number(m[1])), week))
    const period = weekFrom(start)
    // Rok bez 53. tygodnia przepełni się na W01 następnego roku. Porównanie
    // klucza wyłapuje taki przypadek zamiast cicho pokazać zły tydzień.
    if (period.key !== key) return null
    if (period.startMs >= currentPeriodStart('tydzien', now).getTime()) return null
    return period
  }

  const m = /^(\d{4})-(\d{2})$/.exec(key)
  if (!m) return null
  const month = Number(m[2])
  if (month < 1 || month > 12) return null
  const start = startOfMonth(new TZDate(Number(m[1]), month - 1, 1, TZ))
  const period = monthFrom(start)
  if (period.startMs >= currentPeriodStart('miesiac', now).getTime()) return null
  return period
}

/**
 * Sąsiedni okres. delta -1 to starszy, +1 to nowszy. Zwraca null, gdy wynik
 * wyszedłby na okres bieżący lub przyszły, co wyłącza strzałkę w prawo.
 */
export function shiftPeriod(period: Period, delta: number, now: Date = new Date()): Period | null {
  const start = new TZDate(period.startMs, TZ)
  const shifted =
    period.kind === 'tydzien' ? subWeeks(start, -delta) : subMonths(start, -delta)
  const next = period.kind === 'tydzien' ? weekFrom(startOfISOWeek(shifted)) : monthFrom(startOfMonth(shifted))
  if (next.startMs >= currentPeriodStart(period.kind, now).getTime()) return null
  return next
}
```

- [ ] **Step 5: Uruchom skrypt i potwierdź, że przechodzi**

Run: `npx tsx scripts/check-timeReports.ts`
Expected: `check-timeReports: OK`

Jeśli poleci asercja na 167 godzinach, to znaczy że granice liczą się w UTC. Sprawdź, czy `inWarsaw` jest faktycznie użyte w `currentPeriodStart` i czy `subWeeks` dostaje `TZDate`, a nie zwykły `Date`.

- [ ] **Step 6: Sprawdź typy**

Run: `npx tsc --noEmit`
Expected: brak błędów. Gdyby `subWeeks` zwracało `Date` zamiast `TZDate`, dodaj jawny parametr typu: `subWeeks<TZDate>(start, 1)`.

- [ ] **Step 7: Commit**

```bash
git add package.json package-lock.json src/lib/timeReports.ts scripts/check-timeReports.ts
git commit -m "feat(raporty): okresy raportowe liczone w strefie Warszawy"
```

---

### Task 2: Agregacja wpisów czasu

**Files:**
- Modify: `src/lib/types.ts` (dopisz typ na końcu pliku)
- Modify: `src/lib/timeReports.ts` (dopisz `buildReport` i typy wyniku)
- Create: `scripts/check-buildReport.ts`
- Create: `scripts/fixtures/onyx-time-entries-2026-W29.json`

**Interfaces:**
- Consumes: `Period` z Task 1.
- Produces:
  - `interface ClickUpTimeEntry` (w `src/lib/types.ts`)
  - `interface ReportRow { taskId: string; taskName: string; status: string; durationMs: number }`
  - `interface TimeReport { period: Period; totalMs: number; rows: ReportRow[] }`
  - `buildReport(period: Period, entries: ClickUpTimeEntry[]): TimeReport`

- [ ] **Step 1: Zapisz fixture**

Prawdziwa odpowiedź ClickUp dla folderu Onyx za 13-19 lipca 2026, odchudzona do pól, których używamy. Obiekt `user` jest usunięty świadomie, bo zawierałby maile członków zespołu, a i tak go ignorujemy. Dwa ostatnie wpisy są dołożone celowo: jeden to uruchomiony stoper z ujemnym `duration`, drugi to stoper odpalony poza zadaniem.

```json
[
  {
    "id": "5152449135706323981",
    "duration": "7500000",
    "start": "1783939838458",
    "end": "1783947338458",
    "task": { "id": "869dyb6yg", "name": "[onyx] Warianty z baselinker - Wielowariantowość", "status": { "status": "w trakcie" } },
    "task_location": { "list_id": "901213438791", "folder_id": "90129337912", "space_id": "90100136256" }
  },
  {
    "id": "5152449135706323982",
    "duration": "3540000",
    "start": "1784025000000",
    "end": "1784028540000",
    "task": { "id": "869dxx111", "name": "Czas ładowania sklepu", "status": { "status": "w trakcie" } },
    "task_location": { "list_id": "901213438791", "folder_id": "90129337912", "space_id": "90100136256" }
  },
  {
    "id": "5152449135706323983",
    "duration": "2880000",
    "start": "1784111400000",
    "end": "1784114280000",
    "task": { "id": "869dxx222", "name": "Optymalizacja i automatyzacja wdrażania nowych wersji", "status": { "status": "w trakcie" } },
    "task_location": { "list_id": "901213438791", "folder_id": "90129337912", "space_id": "90100136256" }
  },
  {
    "id": "5152449135706323984",
    "duration": "60000",
    "start": "1784197800000",
    "end": "1784197860000",
    "task": { "id": "869dxx111", "name": "Czas ładowania sklepu", "status": { "status": "w trakcie" } },
    "task_location": { "list_id": "901213438791", "folder_id": "90129337912", "space_id": "90100136256" }
  },
  {
    "id": "5152449135706323985",
    "duration": "30000",
    "start": "1784198000000",
    "end": "1784198030000",
    "task": { "id": "869dxx333", "name": "Drobna poprawka poniżej minuty", "status": { "status": "zamknięte" } },
    "task_location": { "list_id": "901213438791", "folder_id": "90129337912", "space_id": "90100136256" }
  },
  {
    "id": "5152449135706323986",
    "duration": "-1784200000000",
    "start": "1784200000000",
    "end": "0",
    "task": { "id": "869dxx444", "name": "Zadanie z uruchomionym stoperem", "status": { "status": "w trakcie" } },
    "task_location": { "list_id": "901213438791", "folder_id": "90129337912", "space_id": "90100136256" }
  },
  {
    "id": "5152448587745672178",
    "duration": "2906",
    "start": "1784201000000",
    "end": "1784201002906",
    "task": null,
    "task_location": { "list_id": null, "folder_id": null, "space_id": null }
  }
]
```

- [ ] **Step 2: Napisz skrypt weryfikacyjny, który ma nie przejść**

```ts
// scripts/check-buildReport.ts
/**
 * Weryfikacja agregacji wpisów czasu. Uruchomienie:
 *   npx tsx scripts/check-buildReport.ts
 */
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { buildReport, listPeriods } from '../src/lib/timeReports'
import type { ClickUpTimeEntry } from '../src/lib/types'

const entries: ClickUpTimeEntry[] = JSON.parse(
  readFileSync(join(import.meta.dirname, 'fixtures/onyx-time-entries-2026-W29.json'), 'utf8')
)

const period = listPeriods('tydzien', 1, new Date('2026-07-26T12:00:00+02:00'))[0]
const report = buildReport(period, entries)

// Suma liczona ze wszystkich dodatnich wpisów przypiętych do zadania:
// 7500000 + 3540000 + 2880000 + 60000 + 30000 = 14010000 ms
assert.equal(report.totalMs, 14010000)

// Wiersze: trzy zadania powyżej minuty, malejąco. Zadanie z 30 sekundami
// wypada z listy, bo formatDuration zwróciłoby dla niego pusty string.
assert.equal(report.rows.length, 3)
assert.deepEqual(
  report.rows.map(r => [r.taskId, r.durationMs]),
  [
    ['869dyb6yg', 7500000],
    ['869dxx111', 3600000], // 3540000 + 60000, dwa wpisy tego samego zadania
    ['869dxx222', 2880000],
  ]
)
assert.equal(report.rows[0].taskName, '[onyx] Warianty z baselinker - Wielowariantowość')
assert.equal(report.rows[0].status, 'w trakcie')

// Uruchomiony stoper i wpis bez zadania nie wchodzą nigdzie.
assert.ok(!report.rows.some(r => r.taskId === '869dxx444'), 'uruchomiony stoper odrzucony')
assert.ok(!report.rows.some(r => r.taskName.includes('poniżej minuty')), 'wiersz poniżej minuty odrzucony')

// Okres jest przepisany do wyniku bez zmian.
assert.equal(report.period.key, '2026-W29')

// Pusta lista wpisów to poprawny stan, nie błąd.
const empty = buildReport(period, [])
assert.equal(empty.totalMs, 0)
assert.equal(empty.rows.length, 0)

console.log('check-buildReport: OK')
```

- [ ] **Step 3: Uruchom skrypt i potwierdź, że nie przechodzi**

Run: `npx tsx scripts/check-buildReport.ts`
Expected: FAIL, `buildReport` nie jest eksportowane z `../src/lib/timeReports`.

- [ ] **Step 4: Dopisz typ do `src/lib/types.ts`**

```ts
/**
 * Wpis czasu z ClickUp, endpoint /team/{id}/time_entries.
 * Tylko pola, których używamy. `user` pomijamy świadomie: klient nie widzi,
 * kto logował czas.
 */
export interface ClickUpTimeEntry {
  id: string
  /** Milisekundy jako string. Uruchomiony stoper ma wartość ujemną. */
  duration: string
  start: string
  end: string
  task: {
    id: string
    name: string
    status: { status: string }
  } | null
  /** Stoper odpalony poza zadaniem ma tu wszystkie pola na null. */
  task_location: {
    list_id: string | null
    folder_id: string | null
    space_id: string | null
  }
}
```

- [ ] **Step 5: Dopisz `buildReport` na końcu `src/lib/timeReports.ts`**

Dopisz też import typu u góry pliku: `import type { ClickUpTimeEntry } from './types'`

```ts
export interface ReportRow {
  taskId: string
  taskName: string
  status: string
  durationMs: number
}

export interface TimeReport {
  period: Period
  totalMs: number
  rows: ReportRow[]
}

/** Wiersze krótsze niż minuta wypadają, bo formatDuration zwraca dla nich pusty string. */
const MIN_ROW_MS = 60_000

/**
 * Sumuje wpisy czasu po zadaniu. Odrzuca dwa rodzaje śmieci, oba widziane
 * w prawdziwych danych: uruchomione stopery (ujemny duration) oraz stopery
 * odpalone poza zadaniem (task_location.folder_id === null).
 *
 * Suma całkowita liczy się ze wszystkich poprawnych wpisów, także krótszych
 * niż minuta, żeby zgadzała się z ClickUp.
 */
export function buildReport(period: Period, entries: ClickUpTimeEntry[]): TimeReport {
  const byTask = new Map<string, ReportRow>()
  let totalMs = 0

  for (const entry of entries) {
    const ms = Number(entry.duration)
    if (!Number.isFinite(ms) || ms <= 0) continue
    if (!entry.task || !entry.task_location?.folder_id) continue

    totalMs += ms
    const existing = byTask.get(entry.task.id)
    if (existing) {
      existing.durationMs += ms
    } else {
      byTask.set(entry.task.id, {
        taskId: entry.task.id,
        taskName: entry.task.name,
        status: entry.task.status.status,
        durationMs: ms,
      })
    }
  }

  const rows = [...byTask.values()]
    .filter(row => row.durationMs >= MIN_ROW_MS)
    .sort((a, b) => b.durationMs - a.durationMs)

  return { period, totalMs, rows }
}
```

- [ ] **Step 6: Uruchom oba skrypty i sprawdź typy**

Run: `npx tsx scripts/check-buildReport.ts && npx tsx scripts/check-timeReports.ts && npx tsc --noEmit`
Expected: `check-buildReport: OK`, `check-timeReports: OK`, brak błędów typów.

- [ ] **Step 7: Commit**

```bash
git add src/lib/types.ts src/lib/timeReports.ts scripts/check-buildReport.ts scripts/fixtures/
git commit -m "feat(raporty): agregacja wpisow czasu po zadaniu"
```

---

### Task 3: Pobieranie wpisów czasu z ClickUp

**Files:**
- Modify: `src/lib/clickup.ts` (dopisz na końcu pliku)
- Modify: `.env.local` (dopisz `CLICKUP_TEAM_ID=4552118`)
- Create: `scripts/check-clickup-time-entries.ts`

**Interfaces:**
- Consumes: `ClickUpTimeEntry` z Task 2, `listPeriods` i `buildReport` z Task 1 i 2.
- Produces:
  - `getWorkspaceMemberIds(): Promise<string[]>`
  - `getTimeEntries(folderId: string, startMs: number, endMs: number): Promise<ClickUpTimeEntry[]>`

- [ ] **Step 1: Dopisz zmienną środowiskową**

Do `.env.local`, w sekcji ClickUp:

```
CLICKUP_TEAM_ID=4552118
```

Nie commitujemy tego pliku, jest w `.gitignore`. Ta sama zmienna musi trafić do env aplikacji w Coolify przed wdrożeniem na produkcję, inaczej strona raportu zwróci błąd.

- [ ] **Step 2: Napisz skrypt weryfikacyjny na żywo, który ma nie przejść**

```ts
// scripts/check-clickup-time-entries.ts
/**
 * Weryfikacja na żywo, wymaga .env.local z CLICKUP_API_TOKEN i CLICKUP_TEAM_ID.
 *   npx tsx scripts/check-clickup-time-entries.ts
 *
 * Punkt odniesienia: folder Onyx, tydzień 13-19 lipca 2026, suma 3h 52m.
 * Wartość może się zmienić, jeśli ktoś dopisze czas wstecz w tym tygodniu.
 */
import dotenv from 'dotenv'
dotenv.config({ path: '.env.local' })

import assert from 'node:assert/strict'
import { getTimeEntries, getWorkspaceMemberIds } from '../src/lib/clickup'
import { buildReport, parsePeriodKey } from '../src/lib/timeReports'
import { formatDuration } from '../src/lib/utils'

const ONYX_FOLDER = '90129337912'

const members = await getWorkspaceMemberIds()
assert.ok(members.length >= 5, `spodziewane co najmniej 5 osób w workspace, jest ${members.length}`)

const period = parsePeriodKey('tydzien', '2026-W29', new Date('2026-07-26T12:00:00+02:00'))
assert.ok(period, 'okres 2026-W29 ma być zamknięty i poprawny')

const entries = await getTimeEntries(ONYX_FOLDER, period.startMs, period.endMs)
const report = buildReport(period, entries)

console.log(`okres:    ${report.period.label}`)
console.log(`łącznie:  ${formatDuration(report.totalMs)}`)
for (const row of report.rows) {
  console.log(`  ${formatDuration(row.durationMs).padStart(8)}  [${row.status}]  ${row.taskName}`)
}

assert.ok(report.rows.length > 0, 'spodziewane wpisy czasu w tym tygodniu')
assert.equal(formatDuration(report.totalMs), '3h 52m')

// Izolacja klienta: każdy wpis ma pochodzić z folderu, o który pytaliśmy.
for (const entry of entries) {
  if (!entry.task_location?.folder_id) continue
  assert.equal(entry.task_location.folder_id, ONYX_FOLDER, 'wpis z obcego folderu')
}

console.log('check-clickup-time-entries: OK')
```

- [ ] **Step 3: Uruchom skrypt i potwierdź, że nie przechodzi**

Run: `npx tsx scripts/check-clickup-time-entries.ts`
Expected: FAIL, `getTimeEntries` nie jest eksportowane z `../src/lib/clickup`.

- [ ] **Step 4: Dopisz funkcje na końcu `src/lib/clickup.ts`**

Dopisz też `ClickUpTimeEntry` do istniejącego importu typów u góry pliku.

```ts
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
```

- [ ] **Step 5: Uruchom skrypt i potwierdź, że przechodzi**

Run: `npx tsx scripts/check-clickup-time-entries.ts`
Expected: wypisana lista trzech zadań i `check-clickup-time-entries: OK`.

Jeśli suma wyjdzie inna niż `3h 52m`, sprawdź w ClickUp, czy ktoś nie dopisał czasu w tym tygodniu. Jeśli tak, zaktualizuj oczekiwaną wartość w skrypcie i dopisz w komentarzu datę zmiany. Jeśli wpisów jest zero, sprawdź w pierwszej kolejności, czy `assignee` faktycznie leci w zapytaniu.

- [ ] **Step 6: Sprawdź typy**

Run: `npx tsc --noEmit`
Expected: brak błędów. Pole `next` w opcjach `fetch` jest poprawne, bo Next rozszerza globalny typ `RequestInit` przez `next-env.d.ts`, który jest w `include` w `tsconfig.json`.

- [ ] **Step 7: Commit**

```bash
git add src/lib/clickup.ts scripts/check-clickup-time-entries.ts
git commit -m "feat(raporty): pobieranie wpisow czasu z ClickUp dla folderu klienta"
```

---

### Task 4: Fundament shadcn

**Files:**
- Create: `components.json`
- Create: `src/components/ui/card.tsx`, `src/components/ui/table.tsx`, `src/components/ui/dropdown-menu.tsx` (generowane przez CLI)
- Modify: `src/app/globals.css` (dwa nowe tokeny w `@theme` i w `.dark`)

**Interfaces:**
- Consumes: nic.
- Produces: komponenty `Card`, `CardHeader`, `CardTitle`, `CardContent`, `Table`, `TableHeader`, `TableBody`, `TableRow`, `TableHead`, `TableCell`, `DropdownMenu`, `DropdownMenuTrigger`, `DropdownMenuContent`, `DropdownMenuItem`.

- [ ] **Step 1: Napisz `components.json` ręcznie**

Świadomie **nie** uruchamiamy `npx shadcn init`, bo init przepisuje `globals.css` pod swój zestaw zmiennych, a ten projekt ma własny blok `@theme` z tokenami `--color-*`, na których stoi cały istniejący portal.

```json
{
  "$schema": "https://ui.shadcn.com/schema.json",
  "style": "new-york",
  "rsc": true,
  "tsx": true,
  "tailwind": {
    "config": "",
    "css": "src/app/globals.css",
    "baseColor": "slate",
    "cssVariables": true,
    "prefix": ""
  },
  "aliases": {
    "components": "@/components",
    "utils": "@/lib/utils",
    "ui": "@/components/ui",
    "lib": "@/lib",
    "hooks": "@/hooks"
  },
  "iconLibrary": "lucide"
}
```

`"config": ""` jest poprawne dla Tailwinda v4, który nie ma pliku konfiguracyjnego. `baseColor: "slate"` odpowiada obecnej palecie w `globals.css`.

- [ ] **Step 2: Zapisz stan `globals.css` przed zmianą**

```bash
cp src/app/globals.css /tmp/globals-before-shadcn.css
```

- [ ] **Step 3: Dodaj komponenty**

```bash
npx shadcn@4 add card table dropdown-menu
```

Oczekiwane: trzy nowe pliki w `src/components/ui/`. CLI nie powinno pytać o nadpisanie niczego, bo `button.tsx`, `input.tsx`, `label.tsx` i `badge.tsx` nie są w tej liście. **Jeśli zapyta o nadpisanie któregokolwiek istniejącego pliku, odmów.**

- [ ] **Step 4: Sprawdź, czy CLI nie ruszyło motywu**

```bash
diff /tmp/globals-before-shadcn.css src/app/globals.css && echo "globals.css nietknięte"
git status --short
```

Expected: `globals.css nietknięte`, a w `git status` tylko `components.json` i trzy pliki w `src/components/ui/`.

Jeśli `globals.css` zostało zmienione, przywróć je: `cp /tmp/globals-before-shadcn.css src/app/globals.css`. Motyw zmieniamy tylko ręcznie, w następnym kroku.

- [ ] **Step 5: Dodaj brakujące tokeny motywu**

`dropdown-menu` używa klas `bg-popover` i `text-popover-foreground`, a obecny motyw nie definiuje tych tokenów. Bez nich lista okresów wyszłaby przezroczysta, z nieczytelnym tekstem na tle strony.

W `src/app/globals.css`, w bloku `@theme`, po linii `--color-accent-foreground: #1e293b;` dodaj:

```css
  --color-popover: #ffffff;
  --color-popover-foreground: #0f172a;
```

W bloku `.dark`, po linii `--color-accent-foreground: #f8fafc;` dodaj:

```css
  --color-popover: #1e293b;
  --color-popover-foreground: #f8fafc;
```

- [ ] **Step 6: Sprawdź, że projekt się buduje**

```bash
npx tsc --noEmit && npm run lint
```

Expected: brak błędów typów, lint bez błędów. Ostrzeżenia w wygenerowanych plikach shadcn są dopuszczalne, plików generowanych nie poprawiamy ręcznie.

- [ ] **Step 7: Commit**

```bash
git add components.json src/components/ui/card.tsx src/components/ui/table.tsx src/components/ui/dropdown-menu.tsx src/app/globals.css
git commit -m "chore(ui): konfiguracja shadcn i komponenty card, table, dropdown-menu"
```

---

### Task 5: Strona raportu

Po tym zadaniu raport działa i jest dostępny pod adresem, ale jeszcze nie ma do niego zakładki. Kolejność jest celowa: nigdy nie zostawiamy w interfejsie linku do strony, która nie istnieje.

**Files:**
- Create: `src/app/[slug]/raporty/page.tsx`
- Create: `src/components/reports/ReportView.tsx`
- Create: `src/components/reports/PeriodPicker.tsx`

**Interfaces:**
- Consumes: `listPeriods`, `parsePeriodKey`, `shiftPeriod`, `buildReport`, `Period`, `PeriodKind`, `TimeReport` z Task 1 i 2; `getTimeEntries` z Task 3; `Card`, `Table`, `DropdownMenu` z Task 4; `getSession` z `@/lib/auth`; `formatDuration` z `@/lib/utils`.
- Produces:
  - `ReportView(props: { slug: string; kind: PeriodKind; periods: Period[]; period: Period; report: TimeReport | null; olderKey: string | null; newerKey: string | null })`
  - `PeriodPicker(props: { slug: string; kind: PeriodKind; period: Period; periods: Period[]; olderKey: string | null; newerKey: string | null })`

- [ ] **Step 1: Napisz `PeriodPicker`**

Klient tylko dla dropdownu Radixa. Reszta to linki, więc przełączanie okresu działa też bez JS.

```tsx
// src/components/reports/PeriodPicker.tsx
'use client'
import Link from 'next/link'
import { ChevronLeft, ChevronRight, ChevronDown } from 'lucide-react'
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu'
import { cn } from '@/lib/utils'
import type { Period, PeriodKind } from '@/lib/timeReports'

interface PeriodPickerProps {
  slug: string
  kind: PeriodKind
  period: Period
  periods: Period[]
  /** Klucz starszego okresu albo null, gdy sięgamy poza listę. */
  olderKey: string | null
  /** Klucz nowszego okresu albo null, gdy jesteśmy na ostatnim zamkniętym. */
  newerKey: string | null
}

function href(slug: string, kind: PeriodKind, key: string): string {
  return `/${slug}/raporty?typ=${kind}&okres=${key}`
}

export function PeriodPicker({ slug, kind, period, periods, olderKey, newerKey }: PeriodPickerProps) {
  const arrow = 'inline-flex h-8 w-8 items-center justify-center rounded-md text-muted-foreground transition-colors'
  const arrowActive = 'hover:bg-muted hover:text-foreground'
  const arrowOff = 'opacity-30 pointer-events-none'

  return (
    <div className="flex flex-wrap items-center gap-4">
      {/* Przełącznik rodzaju okresu. Zawsze prowadzi na ostatni zamknięty
          okres danego rodzaju, bo klucz tygodnia nie ma sensu dla miesiąca. */}
      <div className="inline-flex rounded-lg border border-border bg-card p-0.5">
        {(['tydzien', 'miesiac'] as const).map(option => (
          <Link
            key={option}
            href={`/${slug}/raporty?typ=${option}`}
            className={cn(
              'rounded-md px-3 py-1.5 text-sm font-medium transition-colors',
              option === kind
                ? 'bg-primary text-primary-foreground'
                : 'text-muted-foreground hover:text-foreground'
            )}
          >
            {option === 'tydzien' ? 'Tydzień' : 'Miesiąc'}
          </Link>
        ))}
      </div>

      <div className="flex items-center gap-1">
        {olderKey ? (
          <Link href={href(slug, kind, olderKey)} className={cn(arrow, arrowActive)} aria-label="Starszy okres">
            <ChevronLeft className="h-4 w-4" />
          </Link>
        ) : (
          <span className={cn(arrow, arrowOff)} aria-hidden="true">
            <ChevronLeft className="h-4 w-4" />
          </span>
        )}

        <DropdownMenu>
          <DropdownMenuTrigger className="inline-flex items-center gap-1.5 rounded-md px-3 py-1.5 text-sm font-medium text-foreground hover:bg-muted transition-colors">
            {period.label}
            <ChevronDown className="h-4 w-4 text-muted-foreground" />
          </DropdownMenuTrigger>
          <DropdownMenuContent align="center">
            {periods.map(option => (
              <DropdownMenuItem key={option.key} asChild>
                <Link href={href(slug, kind, option.key)}>{option.label}</Link>
              </DropdownMenuItem>
            ))}
          </DropdownMenuContent>
        </DropdownMenu>

        {newerKey ? (
          <Link href={href(slug, kind, newerKey)} className={cn(arrow, arrowActive)} aria-label="Nowszy okres">
            <ChevronRight className="h-4 w-4" />
          </Link>
        ) : (
          <span className={cn(arrow, arrowOff)} aria-hidden="true">
            <ChevronRight className="h-4 w-4" />
          </span>
        )}
      </div>
    </div>
  )
}
```

- [ ] **Step 2: Napisz `ReportView`**

Server Component. `report === null` znaczy, że ClickUp nie odpowiedział.

```tsx
// src/components/reports/ReportView.tsx
import Link from 'next/link'
import { Card, CardContent } from '@/components/ui/card'
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table'
import { formatDuration, getStatusColor } from '@/lib/utils'
import { PeriodPicker } from './PeriodPicker'
import type { Period, PeriodKind, TimeReport } from '@/lib/timeReports'

interface ReportViewProps {
  slug: string
  kind: PeriodKind
  periods: Period[]
  period: Period
  /** null oznacza, że ClickUp nie odpowiedział. */
  report: TimeReport | null
  olderKey: string | null
  newerKey: string | null
}

export function ReportView({ slug, kind, periods, period, report, olderKey, newerKey }: ReportViewProps) {
  return (
    <div className="mx-auto w-full max-w-4xl px-6 py-8">
      <h2 className="text-xl font-semibold text-foreground">Raport czasu pracy</h2>
      <p className="mt-1 text-sm text-muted-foreground">
        Czas zalogowany na Twoich zadaniach w zamkniętym okresie.
      </p>

      <div className="mt-6">
        <PeriodPicker
          slug={slug}
          kind={kind}
          period={period}
          periods={periods}
          olderKey={olderKey}
          newerKey={newerKey}
        />
      </div>

      {report === null ? (
        <Card className="mt-6">
          <CardContent className="py-8 text-center">
            <p className="text-sm text-foreground">Nie udało się pobrać danych o czasie pracy.</p>
            <p className="mt-1 text-sm text-muted-foreground">
              Spróbuj ponownie za chwilę. Jeśli to się powtarza, kliknij Alarm na tablicy.
            </p>
            <Link
              href={`/${slug}/raporty?typ=${kind}&okres=${period.key}`}
              className="mt-4 inline-flex rounded-md bg-primary px-3 py-1.5 text-sm font-medium text-primary-foreground hover:bg-primary/90 transition-colors"
            >
              Spróbuj ponownie
            </Link>
          </CardContent>
        </Card>
      ) : (
        <>
          <Card className="mt-6">
            <CardContent className="flex items-baseline justify-between py-5">
              <span className="text-sm font-medium text-muted-foreground">Łącznie</span>
              <span className="text-2xl font-semibold tabular-nums text-foreground">
                {formatDuration(report.totalMs) || '0m'}
              </span>
            </CardContent>
          </Card>

          {report.rows.length === 0 ? (
            <p className="mt-6 rounded-lg border border-border bg-card px-4 py-8 text-center text-sm text-muted-foreground">
              W tym okresie nie zalogowano czasu.
            </p>
          ) : (
            <div className="mt-6 overflow-x-auto">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Zadanie</TableHead>
                    <TableHead className="w-32">Status</TableHead>
                    <TableHead className="w-24 text-right">Czas</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {report.rows.map(row => (
                    <TableRow key={row.taskId}>
                      <TableCell className="font-medium text-foreground">{row.taskName}</TableCell>
                      <TableCell>
                        <span
                          className="inline-flex rounded-full px-2 py-0.5 text-xs font-medium"
                          style={{ backgroundColor: `${getStatusColor(row.status)}1f`, color: getStatusColor(row.status) }}
                        >
                          {row.status}
                        </span>
                      </TableCell>
                      <TableCell className="text-right tabular-nums text-foreground">
                        {formatDuration(row.durationMs)}
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </div>
          )}
        </>
      )}
    </div>
  )
}
```

`getStatusColor` z `src/lib/utils.ts:34` zwraca kolor w hex, na przykład `#F4BF44` dla statusu "w trakcie", dlatego kolor idzie przez `style`, a nie przez klasę Tailwinda. Sufiks `1f` w tle to alfa około 12 procent, ta sama technika co na kartach zadań.

- [ ] **Step 3: Napisz stronę**

```tsx
// src/app/[slug]/raporty/page.tsx
import { redirect } from 'next/navigation'
import { z } from 'zod'
import { eq } from 'drizzle-orm'
import { getSession } from '@/lib/auth'
import { db } from '@/lib/db'
import { portals } from '@/lib/db/schema'
import { getTimeEntries } from '@/lib/clickup'
import { buildReport, listPeriods, parsePeriodKey, shiftPeriod, type TimeReport } from '@/lib/timeReports'
import { ReportView } from '@/components/reports/ReportView'

interface RaportyPageProps {
  params: Promise<{ slug: string }>
  searchParams: Promise<{ [key: string]: string | string[] | undefined }>
}

/**
 * Cokolwiek niepoprawnego w URL cicho wraca do domyślnego okresu, zamiast
 * zwracać 404. Podesłany klientowi link nigdy nie ma umrzeć.
 */
const searchSchema = z.object({
  typ: z.enum(['tydzien', 'miesiac']).catch('tydzien'),
  okres: z.string().max(16).optional().catch(undefined),
})

function first(value: string | string[] | undefined): string | undefined {
  return Array.isArray(value) ? value[0] : value
}

export default async function RaportyPage({ params, searchParams }: RaportyPageProps) {
  const { slug } = await params

  const session = await getSession(slug)
  if (!session || session.portalSlug !== slug) {
    redirect(`/${slug}/login`)
  }

  const [portal] = await db.select().from(portals).where(eq(portals.slug, slug)).limit(1)
  if (!portal) redirect('/')

  const raw = await searchParams
  const { typ: kind, okres } = searchSchema.parse({ typ: first(raw.typ), okres: first(raw.okres) })

  const periods = listPeriods(kind, 12)
  const period = (okres ? parsePeriodKey(kind, okres) : null) ?? periods[0]

  let report: TimeReport | null = null
  try {
    // folderId pochodzi z bazy, nie z URL-a. To granica między klientami.
    const entries = await getTimeEntries(portal.clickupFolderId, period.startMs, period.endMs)
    report = buildReport(period, entries)
  } catch (error) {
    console.error('[raporty] ClickUp nie odpowiedział:', error)
  }

  return (
    <ReportView
      slug={slug}
      kind={kind}
      periods={periods}
      period={period}
      report={report}
      olderKey={shiftPeriod(period, -1)?.key ?? null}
      newerKey={shiftPeriod(period, 1)?.key ?? null}
    />
  )
}
```

- [ ] **Step 4: Sprawdź typy i lint**

Run: `npx tsc --noEmit && npm run lint`
Expected: brak błędów.

- [ ] **Step 5: Uruchom lokalnie i sprawdź w przeglądarce**

Warunki wstępne: Postgres na porcie 5433, portal `onyx` w bazie wskazujący na folder `90129337912`, użytkownik do zalogowania.

```bash
rm -rf .next && npm run dev
```

`rm -rf .next` jest tu obowiązkowe, nie opcjonalne: dochodzą nowe klasy utility, a Turbopack ich nie kompiluje na hot reload.

Sprawdź po zalogowaniu:

1. `http://localhost:3000/onyx/raporty` pokazuje ostatni zamknięty tydzień, sumę i tabelę zadań.
2. Strzałka w lewo cofa o tydzień, etykieta się zmienia, suma się zmienia.
3. Strzałka w prawo jest wyszarzona na ostatnim zamkniętym tygodniu.
4. Klik w etykietę otwiera listę dwunastu okresów, wybór działa. Lista ma tło, nie jest przezroczysta. Jeśli jest, wróć do Task 4 Step 5, brakuje tokenów `popover`.
5. Przełączenie na Miesiąc pokazuje ostatni zamknięty miesiąc.
6. `?typ=tydzien&okres=2026-W30` (bieżący) wraca na ostatni zamknięty, bez błędu.
7. `?typ=bzdura&okres=bzdura` też wraca na ostatni zamknięty tydzień.
8. Nigdzie na stronie nie ma imion ani nazw list.

- [ ] **Step 6: Sprawdź stan pusty i błąd**

Stan pusty: wybierz okres wystarczająco stary, żeby nie miał wpisów, na przykład `?typ=miesiac&okres=2026-01`. Oczekiwane: "W tym okresie nie zalogowano czasu", bez tabeli.

Stan błędu: tymczasowo zepsuj token, uruchamiając dev server z podmienioną zmienną:

```bash
CLICKUP_API_TOKEN=pk_zle npm run dev
```

Oczekiwane: komunikat "Nie udało się pobrać danych o czasie pracy" z przyciskiem, żadnej pięćsetki. Potem przywróć normalne uruchomienie.

- [ ] **Step 7: Commit**

```bash
git add src/app/\[slug\]/raporty/page.tsx src/components/reports/
git commit -m "feat(raporty): strona raportu czasu pracy z wyborem okresu"
```

---

### Task 6: Wspólny header z zakładkami

**Files:**
- Create: `src/components/PortalHeader.tsx`
- Modify: `src/components/kanban/KanbanBoard.tsx:170-204`
- Modify: `src/app/[slug]/raporty/page.tsx` (owinięcie w header)

`ReportView` zostaje bez zmian. Header wchodzi na poziomie strony, żeby oba widoki składały go tak samo.

**Interfaces:**
- Consumes: `cn` z `@/lib/utils`.
- Produces: `PortalHeader(props: { slug: string; portalName: string; userEmail: string; children?: React.ReactNode })`

- [ ] **Step 1: Napisz `PortalHeader`**

Markup części tożsamościowej jest przeniesiony jeden do jednego z `KanbanBoard.tsx:173-182`, żeby wygląd tablicy się nie zmienił.

```tsx
// src/components/PortalHeader.tsx
'use client'
import Link from 'next/link'
import { usePathname } from 'next/navigation'
import { cn } from '@/lib/utils'

interface PortalHeaderProps {
  slug: string
  portalName: string
  userEmail: string
  /** Akcje po prawej stronie. Tablica wstawia tu Alarm, Odśwież i Nowe zadanie. */
  children?: React.ReactNode
}

export function PortalHeader({ slug, portalName, userEmail, children }: PortalHeaderProps) {
  const pathname = usePathname()
  const tabs = [
    { href: `/${slug}`, label: 'Tablica' },
    { href: `/${slug}/raporty`, label: 'Raporty' },
  ]

  return (
    <header className="border-b border-border bg-card px-6 py-4">
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-3">
          <div className="h-8 w-8 rounded-lg bg-primary flex items-center justify-center text-primary-foreground text-sm font-bold">
            {portalName[0]?.toUpperCase()}
          </div>
          <div>
            <h1 className="font-semibold text-foreground">{portalName}</h1>
            <p className="text-xs text-muted-foreground">{userEmail}</p>
          </div>
        </div>

        <div className="flex items-center gap-2">{children}</div>
      </div>

      <nav className="mt-3 flex gap-1">
        {tabs.map(tab => {
          // Tablica jest aktywna tylko przy dokładnym trafieniu, inaczej
          // podświetlałaby się także na podstronach.
          const active = tab.href === `/${slug}` ? pathname === tab.href : pathname.startsWith(tab.href)
          return (
            <Link
              key={tab.href}
              href={tab.href}
              className={cn(
                'rounded-md px-3 py-1.5 text-sm font-medium transition-colors',
                active ? 'bg-muted text-foreground' : 'text-muted-foreground hover:bg-muted hover:text-foreground'
              )}
            >
              {tab.label}
            </Link>
          )
        })}
      </nav>
    </header>
  )
}
```

- [ ] **Step 2: Podmień header w `KanbanBoard.tsx`**

Dodaj import: `import { PortalHeader } from '@/components/PortalHeader'`

Zastąp cały blok `<header>` z linii 173-204 tym:

```tsx
      <PortalHeader slug={slug} portalName={portalName} userEmail={userEmail}>
        <PanicButton slug={slug} />

        <button
          onClick={handleRefresh}
          disabled={refreshing}
          className="inline-flex items-center gap-1.5 text-sm text-muted-foreground hover:text-foreground transition-colors px-2 py-1.5 rounded-md hover:bg-muted disabled:opacity-50"
        >
          <RefreshCw className={`h-4 w-4 ${refreshing ? 'animate-spin' : ''}`} />
          Odśwież
        </button>

        <button
          onClick={() => openChat('new-task')}
          className="inline-flex items-center gap-1.5 rounded-md bg-primary px-3 py-1.5 text-sm font-medium text-primary-foreground shadow hover:bg-primary/90 transition-colors"
        >
          <Plus className="h-4 w-4" />
          Nowe zadanie
        </button>
      </PortalHeader>
```

Komentarz `{/* Header */}` w linii 172 zostaw.

- [ ] **Step 3: Dodaj header na stronie raportu**

W `src/app/[slug]/raporty/page.tsx` dodaj import:

```tsx
import { PortalHeader } from '@/components/PortalHeader'
```

i zamień samotny `<ReportView ... />` na:

```tsx
  return (
    <div className="min-h-screen bg-background">
      <PortalHeader slug={slug} portalName={portal.name} userEmail={session.email} />
      <ReportView
        slug={slug}
        kind={kind}
        periods={periods}
        period={period}
        report={report}
        olderKey={shiftPeriod(period, -1)?.key ?? null}
        newerKey={shiftPeriod(period, 1)?.key ?? null}
      />
    </div>
  )
```

- [ ] **Step 4: Sprawdź typy i lint**

Run: `npx tsc --noEmit && npm run lint`
Expected: brak błędów.

- [ ] **Step 5: Sprawdź, że tablica nie ucierpiała**

```bash
rm -rf .next && npm run dev
```

Na `http://localhost:3000/onyx`:

1. Header wygląda jak przedtem, doszedł tylko rząd zakładek pod spodem.
2. Zakładka Tablica jest podświetlona, Raporty nie.
3. Alarm otwiera modal.
4. Odśwież działa i ikona się kręci.
5. Nowe zadanie otwiera czat.
6. **Drag & drop zadań między kolumnami nadal działa.** To najbardziej wrażliwa rzecz w tym pliku.
7. Klik w zadanie otwiera drawer, subtaski są rozwinięte i klikalne.

Na `http://localhost:3000/onyx/raporty`: podświetlona zakładka Raporty, klik w Tablicę wraca na kanban.

- [ ] **Step 6: Commit**

```bash
git add src/components/PortalHeader.tsx src/components/kanban/KanbanBoard.tsx src/app/\[slug\]/raporty/page.tsx
git commit -m "refactor(portal): wspolny header z zakladkami Tablica i Raporty"
```

---

### Task 7: Domknięcie i porównanie z ClickUp

**Files:**
- Modify: żaden, o ile weryfikacja nie wykaże usterek.

**Interfaces:**
- Consumes: całość.
- Produces: nic.

- [ ] **Step 1: Uruchom wszystkie skrypty weryfikacyjne**

```bash
npx tsx scripts/check-timeReports.ts && \
npx tsx scripts/check-buildReport.ts && \
npx tsx scripts/check-clickup-time-entries.ts
```

Expected: trzy linie `OK`.

- [ ] **Step 2: Zbuduj produkcyjnie**

```bash
npm run build
```

Expected: build przechodzi. Trasa `/[slug]/raporty` ma być wypisana jako dynamiczna, bo używa `searchParams` i ciasteczka sesji.

- [ ] **Step 3: Porównaj sumę z ClickUp ręcznie**

W ClickUp otwórz widok czasu dla folderu Onyx, ustaw zakres 13-19 lipca 2026, zsumuj wszystkich członków zespołu. Porównaj z tym, co pokazuje portal na `?typ=tydzien&okres=2026-W29`.

Expected: te same wartości. Punkt odniesienia z dnia pisania planu: `3h 52m` łącznie na trzech zadaniach.

Jeśli portal pokazuje mniej, sprawdź w pierwszej kolejności, czy `assignee` faktycznie leci w zapytaniu, bo bez tego parametru widać tylko wpisy właściciela tokena.

- [ ] **Step 4: Sprawdź drugi portal**

Wejdź na `http://localhost:3000/wdf/raporty` (portal WDF, folder `90129337874`). Sprawdź, że dane są inne niż dla Onyx i że nie ma tam ani jednego zadania z Onyx. To potwierdzenie izolacji klientów.

- [ ] **Step 5: Zapisz, czego brakuje do produkcji**

Zanim to pojedzie na `portal.important.is`, do env aplikacji w Coolify musi dojść `CLICKUP_TEAM_ID=4552118`. Bez tego strona raportu pokaże stan błędu. Wdrożenie i zmiana env w Coolify wymagają wyraźnej zgody Łukasza, więc na tym etapie tylko to zapisujemy, nie robimy.

- [ ] **Step 6: Commit**

Jeśli krok 1 do 4 nie wymusił żadnych zmian, nie ma czego commitować. Jeśli wymusił, commituj poprawki osobno z opisem tego, co się rozjechało.

---

## Self-Review

**Pokrycie specu:**

| Wymaganie ze specu | Zadanie |
|---|---|
| Źródło danych `time_entries` z `folder_id` i `assignee` | Task 3 |
| Odrzucanie `duration <= 0` i wpisów bez zadania | Task 2 |
| Agregacja po zadaniu, bez pola `user` | Task 2 |
| `listPeriods`, `parsePeriodKey`, `formatPeriodLabel`, `buildReport` | Task 1, Task 2 |
| Granice okresów w `Europe/Warsaw` | Task 1 |
| `getTimeEntries`, `getWorkspaceMemberIds`, `revalidate: 300` | Task 3 |
| Typ `ClickUpTimeEntry` w `types.ts` | Task 2 |
| Strona z sesją, walidacją Zodem i cichym fallbackiem | Task 5 |
| `PortalHeader` z akcjami jako `children` | Task 6 |
| `components.json` plus `card`, `table`, `dropdown-menu` | Task 4 |
| Stan błędu, stan pusty, przekierowanie bez sesji | Task 5 |
| Weryfikacja skryptami i porównanie z ClickUp | Task 1, 2, 3, 7 |
| `CLICKUP_TEAM_ID` | Task 3, Task 7 |
| Tylko zamknięte okresy | Task 1, sprawdzane w Task 5 Step 5 punkt 6 |

Dwie rzeczy ze specu nazwane w planie inaczej, świadomie, powód w sekcji "Odstępstwa": `formatPeriodLabel` jest wewnętrzną funkcją `formatWeekLabel` plus `format` z locale, bo etykieta miesiąca nie potrzebuje własnej funkcji; `Tabs` zastąpione linkami.

**Spójność nazw:** `Period`, `PeriodKind`, `ReportRow`, `TimeReport`, `listPeriods`, `parsePeriodKey`, `shiftPeriod`, `buildReport`, `getTimeEntries`, `getWorkspaceMemberIds`, `ClickUpTimeEntry`, `PortalHeader`, `ReportView`, `PeriodPicker` używane w tej samej formie w każdym zadaniu. `olderKey` i `newerKey` przekazywane przez `ReportView` do `PeriodPicker` bez zmiany nazwy.
