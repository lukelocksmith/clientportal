# SitePing → ClickUp Backend Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** A public endpoint (`/api/siteping/[slug]`) that accepts submissions from a `@siteping/widget` instance embedded on a client's live website and turns each one into a ClickUp task carrying the exact DOM location (CSS selector, XPath, screenshot), gated per-portal behind a feature flag and an Origin allowlist.

**Architecture:** `@siteping/adapter-prisma`'s `createSitepingHandler({ store, allowedOrigins, apiKey, publicEndpoints })` does all HTTP routing/validation/CORS — despite the package name, it accepts an abstract `store` and never touches Prisma when we do. Our only code is a `SitepingStore` implementation (`src/lib/siteping/store.ts`) that maps the store's CRUD contract onto ClickUp calls already in `src/lib/clickup.ts`. ClickUp stays the single source of truth (no new table): the annotation JSON rides along as a task attachment (same mechanism the chat already uses for screenshots), and reads scan the folder's task list live.

**Tech Stack:** Next.js 16 App Router route handler, `@siteping/adapter-prisma` (HTTP handler factory, store-mode), `@siteping/widget` (devDependency, manual testing only in this plan), Drizzle ORM + Postgres, Vitest (`describe`/`it` + `node:assert`, per this repo's existing convention — see `src/lib/reporter.test.ts`).

## Global Constraints

- Spec: `docs/superpowers/specs/2026-08-06-siteping-clickup-backend-design.md` — every task below implements one of its decisions; do not deviate without updating the spec first.
- Package versions are pinned to what was verified by hand: `@siteping/widget@0.10.7`, `@siteping/adapter-prisma@0.6.4`. Do not blindly bump to `latest` — re-verify the `.d.ts` contract first (see spec's "Ryzyko" history for why).
- **Production will crash on first request without `SITEPING_API_KEY` set.** `createSitepingHandler` throws synchronously when `NODE_ENV === 'production'` and no `apiKey` is configured (verified in the compiled package, not just its docs). Task 6 sets this up; do not skip it before any Coolify deploy.
- Follow existing repo conventions exactly: `db.select().from(portals).where(eq(portals.slug, slug))` for portal lookup, `withReporterFooter`/`reporterFooter` for ClickUp descriptions, `invalidateFolderTasks` after every mutation, dynamic route params as `{ params }: { params: Promise<{ slug: string }> }` (Next 16 async params).
- Real ClickUp statuses in the clients space are exactly: `backlog`, `do zrobienia`, `w trakcie`, `zablokowane`, `przegląd`, `weryfikacja`, `zamknięte` (from `STATUS_COLUMNS` in `src/lib/utils.ts`). Do not invent other status strings.

---

### Task 1: DB schema — `siteping_enabled` + `site_domains`

**Files:**
- Modify: `src/lib/db/schema.ts` (the `portals` table)
- Create: a new Drizzle migration under `migrations/` (name assigned by `drizzle-kit generate`, not hand-written)

**Interfaces:**
- Produces: `portals.sitepingEnabled: boolean`, `portals.siteDomains: text | null` — consumed by Task 6's portal-resolution helper.

- [ ] **Step 1: Add the two columns to the schema**

In `src/lib/db/schema.ts`, right after the existing `dashboardEnabled` field (before `createdAt`):

```ts
  dashboardEnabled: boolean('dashboard_enabled').notNull().default(false),
  /**
   * Widget SitePing na stronie klienta wolno pod tym flagiem. Domyslnie
   * false, jak kazda nowa funkcja portalu (patrz reportsEnabled) — endpoint
   * /api/siteping/[slug] zwraca 404 dopoki nie wlaczone w /admin.
   */
  sitepingEnabled: boolean('siteping_enabled').notNull().default(false),
  /**
   * Domeny, z ktorych /api/siteping/[slug] przyjmuje zadania — po przecinku
   * (np. "wdf.important.is,wodadlafirmy.pl"). Klient moze miec staging i
   * produkcje jako dwie realne, rozne domeny (nie www/non-www warianty
   * jednej). Null = flaga bez sensu wlaczac, endpoint i tak 404uje.
   */
  siteDomains: text('site_domains'),
  createdAt: timestamp('created_at').notNull().defaultNow(),
```

- [ ] **Step 2: Generate the migration**

Run: `npm run db:generate`

Expected: a new file appears under `migrations/`, e.g. `migrations/0006_<random-name>.sql`, containing exactly two `ALTER TABLE "portals" ADD COLUMN ...` statements. Open it and confirm it does **not** contain anything else (no `CREATE TABLE`, no unrelated columns) — the "Drizzle meta drift" gotcha in this repo has bitten before when the snapshot was stale.

- [ ] **Step 3: Apply the migration to your local Postgres**

Prerequisite (if not already running): `docker run -d --name cp-test-pg -e POSTGRES_PASSWORD=postgres -e POSTGRES_DB=clientportal -p 5433:5432 postgres:16-alpine`

Run: `npm run db:migrate`

- [ ] **Step 4: Verify the columns exist**

Run: `docker exec cp-test-pg psql -U postgres -d clientportal -c "\d portals"` and confirm `siteping_enabled` (boolean, not null, default false) and `site_domains` (text, nullable) are listed.

- [ ] **Step 5: Commit**

```bash
git add src/lib/db/schema.ts migrations/
git commit -m "feat(siteping): add siteping_enabled and site_domains to portals"
```

---

### Task 2: `reporter.ts` — new `'siteping'` report source

**Files:**
- Modify: `src/lib/reporter.ts`
- Test: `src/lib/reporter.test.ts`

**Interfaces:**
- Produces: `ReportSource` now includes `'siteping'` — consumed by Task 5's `store.ts` (via `withReporterFooter(..., { source: 'siteping' })`).

- [ ] **Step 1: Write the failing test**

Add to `src/lib/reporter.test.ts` (alongside the existing `describe('withReporterFooter', ...)` block):

```ts
it('etykietuje kanal siteping', () => {
  const out = reporterFooter({ ...KLIENT, source: 'siteping' })
  assert.match(out, /\*\*Kanał:\*\* zgłoszenie z widgetu na stronie/)
})
```

- [ ] **Step 2: Run it to verify it fails**

Run: `npx vitest run src/lib/reporter.test.ts`
Expected: FAIL — `Property 'siteping' does not exist` (TS) or a thrown error from `SOURCE_LABELS['siteping']` being `undefined` in the template string.

- [ ] **Step 3: Add `'siteping'` to the type and the label map**

In `src/lib/reporter.ts`:

```ts
export type ReportSource = 'form' | 'ai' | 'idea' | 'panic' | 'comment' | 'siteping'
```

```ts
const SOURCE_LABELS: Record<ReportSource, string> = {
  form: 'formularz w portalu',
  ai: 'asystent AI w portalu',
  idea: 'Dashboard, pomysł na ulepszenie portalu',
  panic: 'przycisk alarmowy w portalu',
  comment: 'komentarz w portalu',
  siteping: 'zgłoszenie z widgetu na stronie',
}
```

- [ ] **Step 4: Run the test again to verify it passes**

Run: `npx vitest run src/lib/reporter.test.ts`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add src/lib/reporter.ts src/lib/reporter.test.ts
git commit -m "feat(siteping): add siteping report source"
```

---

### Task 3: `annotationMarker.ts` — pure description/marker helpers

**Files:**
- Create: `src/lib/siteping/annotationMarker.ts`
- Test: `src/lib/siteping/annotationMarker.test.ts`

**Interfaces:**
- Consumes: `AnnotationCreateInput` type from `@siteping/adapter-prisma` (installed in Task 6, but the type-only import can be written now — TypeScript resolves it at build time, not at test-run time for these pure-logic tests since we only pass plain object literals shaped like it).
- Produces: `embedClientIdMarker(clientId: string): string`, `extractClientIdFromDescription(description: string | null): string | null`, `embedUrlMarker(url: string): string`, `extractUrlFromDescription(description: string | null): string | null`, `buildFeedbackDescription(input): string`, `buildFeedbackTitle(message: string): string` — all consumed by Task 5 (`store.ts`).

- [ ] **Step 1: Write the failing tests**

Create `src/lib/siteping/annotationMarker.test.ts`:

```ts
import { describe, it } from 'vitest'
import assert from 'node:assert'
import {
  embedClientIdMarker,
  extractClientIdFromDescription,
  embedUrlMarker,
  extractUrlFromDescription,
  buildFeedbackDescription,
  buildFeedbackTitle,
} from './annotationMarker'

describe('client id marker', () => {
  it('round-trips through a description', () => {
    const marker = embedClientIdMarker('abc-123')
    assert.strictEqual(extractClientIdFromDescription(`${marker}\n\nresztka opisu`), 'abc-123')
  })

  it('returns null when there is no marker', () => {
    assert.strictEqual(extractClientIdFromDescription('zwykly opis bez markera'), null)
  })

  it('returns null for null description', () => {
    assert.strictEqual(extractClientIdFromDescription(null), null)
  })
})

describe('url marker', () => {
  it('round-trips a url with query string through a description', () => {
    const marker = embedUrlMarker('https://wodadlafirmy.pl/oferta?ref=fb')
    assert.strictEqual(
      extractUrlFromDescription(`${marker}\ntresc`),
      'https://wodadlafirmy.pl/oferta?ref=fb'
    )
  })
})

describe('buildFeedbackDescription', () => {
  it('includes selector, xpath and position when annotation is present', () => {
    const out = buildFeedbackDescription({
      clientId: 'c1',
      url: 'https://wodadlafirmy.pl/',
      message: 'Ten przycisk jest za maly',
      annotation: {
        cssSelector: 'main > button.cta',
        xpath: '/html/body/main/button',
        textSnippet: 'Zamow teraz',
        elementTag: 'BUTTON',
        elementId: null,
        textPrefix: '',
        textSuffix: '',
        fingerprint: '0:2:abc',
        neighborText: '',
        anchorKey: null,
        xPct: 0.42,
        yPct: 0.15,
        wPct: 0.2,
        hPct: 0.05,
        scrollX: 0,
        scrollY: 0,
        viewportW: 1440,
        viewportH: 900,
        devicePixelRatio: 2,
      },
    })
    assert.match(out, /main > button\.cta/)
    assert.match(out, /\/html\/body\/main\/button/)
    assert.match(out, /42%, 15%/)
    assert.match(out, /Ten przycisk jest za maly/)
  })

  it('omits the element section when there is no annotation', () => {
    const out = buildFeedbackDescription({
      clientId: 'c1',
      url: 'https://wodadlafirmy.pl/',
      message: 'Ogolna uwaga bez klikniecia',
      annotation: null,
    })
    assert.doesNotMatch(out, /Selektor CSS/)
    assert.match(out, /Ogolna uwaga bez klikniecia/)
  })
})

describe('buildFeedbackTitle', () => {
  it('falls back to a generic title for empty messages', () => {
    assert.strictEqual(buildFeedbackTitle('   '), 'Zgłoszenie ze strony')
  })

  it('truncates long messages to 80 characters with an ellipsis', () => {
    const long = 'x'.repeat(120)
    const title = buildFeedbackTitle(long)
    assert.strictEqual(title.length, 80)
    assert.ok(title.endsWith('...'))
  })

  it('keeps short messages verbatim', () => {
    assert.strictEqual(buildFeedbackTitle('Literowka w naglowku'), 'Literowka w naglowku')
  })
})
```

- [ ] **Step 2: Run to verify it fails**

Run: `npx vitest run src/lib/siteping/annotationMarker.test.ts`
Expected: FAIL — module `./annotationMarker` does not exist.

- [ ] **Step 3: Implement**

Create `src/lib/siteping/annotationMarker.ts`:

```ts
/**
 * Budowa opisu zadania ClickUp z danych SitePing, i odczyt z powrotem.
 *
 * Czysty modul: bez ClickUp, bez bazy, bez sieci. ClickUp jest jedynym
 * miejscem przechowywania — ten modul tylko koduje/dekoduje to, co trzeba
 * odnalezc bez dociagania zalacznika (clientId do dedupu, url do filtrowania
 * getFeedbacks), zeby findByClientId/getFeedbacks dzialaly na tym, co juz
 * zwraca lista zadan, bez zadania per-task fetcha.
 */

interface AnnotationLike {
  cssSelector: string
  xpath: string
  textSnippet: string
  elementTag: string
  elementId?: string | null
  xPct: number
  yPct: number
  wPct: number
  hPct: number
}

const CLIENT_ID_MARKER = /<!--\s*siteping-client-id:([a-zA-Z0-9_-]+)\s*-->/
const URL_MARKER = /<!--\s*siteping-url:([^\s]+)\s*-->/

export function embedClientIdMarker(clientId: string): string {
  return `<!-- siteping-client-id:${clientId} -->`
}

export function extractClientIdFromDescription(description: string | null): string | null {
  if (!description) return null
  const match = description.match(CLIENT_ID_MARKER)
  return match ? match[1] : null
}

export function embedUrlMarker(url: string): string {
  return `<!-- siteping-url:${encodeURIComponent(url)} -->`
}

export function extractUrlFromDescription(description: string | null): string | null {
  if (!description) return null
  const match = description.match(URL_MARKER)
  return match ? decodeURIComponent(match[1]) : null
}

export function buildFeedbackDescription(input: {
  clientId: string
  url: string
  message: string
  annotation: AnnotationLike | null
}): string {
  const lines = [
    embedClientIdMarker(input.clientId),
    embedUrlMarker(input.url),
    '',
    `**Strona:** ${input.url}`,
  ]

  if (input.annotation) {
    const a = input.annotation
    const tag = a.elementTag.toLowerCase()
    lines.push(
      `**Element:** \`${tag}${a.elementId ? '#' + a.elementId : ''}\``,
      `**Selektor CSS:** \`${a.cssSelector}\``,
      `**XPath:** \`${a.xpath}\``,
      `**Pozycja na elemencie:** ${Math.round(a.xPct * 100)}%, ${Math.round(a.yPct * 100)}% ` +
        `(zaznaczenie ${Math.round(a.wPct * 100)}%×${Math.round(a.hPct * 100)}%)`
    )
    if (a.textSnippet) lines.push(`**Tekst elementu:** "${a.textSnippet}"`)
  }

  lines.push('', input.message.trim())

  return lines.join('\n')
}

export function buildFeedbackTitle(message: string): string {
  const trimmed = message.trim()
  if (!trimmed) return 'Zgłoszenie ze strony'
  return trimmed.length > 80 ? `${trimmed.slice(0, 77)}...` : trimmed
}
```

- [ ] **Step 4: Run to verify it passes**

Run: `npx vitest run src/lib/siteping/annotationMarker.test.ts`
Expected: PASS (10 tests)

- [ ] **Step 5: Commit**

```bash
git add src/lib/siteping/annotationMarker.ts src/lib/siteping/annotationMarker.test.ts
git commit -m "feat(siteping): pure helpers for description markers and formatting"
```

---

### Task 4: `rateLimit.ts` — in-memory per-key limiter

**Files:**
- Create: `src/lib/siteping/rateLimit.ts`
- Test: `src/lib/siteping/rateLimit.test.ts`

**Interfaces:**
- Produces: `checkRateLimit(key: string, options?: { max?: number; windowMs?: number }): boolean` (true = allowed), `resetRateLimits(): void` (test-only escape hatch) — consumed by Task 6's route handler.

- [ ] **Step 1: Write the failing test**

Create `src/lib/siteping/rateLimit.test.ts`:

```ts
import { describe, it, beforeEach } from 'vitest'
import assert from 'node:assert'
import { checkRateLimit, resetRateLimits } from './rateLimit'

describe('checkRateLimit', () => {
  beforeEach(() => resetRateLimits())

  it('allows requests up to the max within the window', () => {
    for (let i = 0; i < 5; i++) {
      assert.strictEqual(checkRateLimit('k1', { max: 5, windowMs: 60_000 }), true)
    }
  })

  it('rejects the request once max is exceeded', () => {
    for (let i = 0; i < 5; i++) checkRateLimit('k2', { max: 5, windowMs: 60_000 })
    assert.strictEqual(checkRateLimit('k2', { max: 5, windowMs: 60_000 }), false)
  })

  it('tracks separate keys independently', () => {
    for (let i = 0; i < 5; i++) checkRateLimit('k3', { max: 5, windowMs: 60_000 })
    assert.strictEqual(checkRateLimit('k4', { max: 5, windowMs: 60_000 }), true)
  })
})
```

- [ ] **Step 2: Run to verify it fails**

Run: `npx vitest run src/lib/siteping/rateLimit.test.ts`
Expected: FAIL — module `./rateLimit` does not exist.

- [ ] **Step 3: Implement**

Create `src/lib/siteping/rateLimit.ts`:

```ts
/**
 * Rate-limit w pamieci procesu dla /api/siteping/[slug].
 *
 * `@siteping/adapter-prisma` jawnie NIE robi rate-limitu (dokumentacja
 * pakietu: "apply at framework/reverse-proxy level") — to jest ten poziom.
 *
 * W PAMIECI, nie w bazie: portal.important.is chodzi jako jeden kontener na
 * Coolify, wiec limit per-instancja jest wystarczajacy i nie wymaga
 * dodatkowej tabeli. Reset przy kazdym redeployu jest akceptowalny —
 * to ochrona przed spamem, nie mechanizm bezpieczenstwa z gwarancja.
 */

interface Window {
  count: number
  resetAt: number
}

const windows = new Map<string, Window>()

export function checkRateLimit(
  key: string,
  options: { max?: number; windowMs?: number } = {}
): boolean {
  const max = options.max ?? 10
  const windowMs = options.windowMs ?? 60_000
  const now = Date.now()

  const existing = windows.get(key)
  if (!existing || existing.resetAt <= now) {
    windows.set(key, { count: 1, resetAt: now + windowMs })
    return true
  }

  if (existing.count >= max) return false

  existing.count++
  return true
}

/** Test-only: czysci cały stan miedzy testami. */
export function resetRateLimits(): void {
  windows.clear()
}
```

- [ ] **Step 4: Run to verify it passes**

Run: `npx vitest run src/lib/siteping/rateLimit.test.ts`
Expected: PASS (3 tests)

- [ ] **Step 5: Commit**

```bash
git add src/lib/siteping/rateLimit.ts src/lib/siteping/rateLimit.test.ts
git commit -m "feat(siteping): in-memory rate limiter for the public endpoint"
```

---

### Task 5: `clickup.ts` — add `deleteTask`, and `store.ts` — the `SitepingStore`

**Files:**
- Modify: `src/lib/clickup.ts` (add one function)
- Create: `src/lib/siteping/store.ts`

**Interfaces:**
- Consumes: `createTask`, `updateTask`, `addTaskAttachment`, `getTask`, `getAllTasksForFolder`, `verifyTaskBelongsToFolder` from `@/lib/clickup`; `embedClientIdMarker`, `extractClientIdFromDescription`, `embedUrlMarker`, `extractUrlFromDescription`, `buildFeedbackDescription`, `buildFeedbackTitle` from `@/lib/siteping/annotationMarker`; `withReporterFooter` from `@/lib/reporter`; `logEvent`, `EVENT_TASK_CREATED` from `@/lib/portalEvents`; `invalidateFolderTasks` from `@/lib/clickupCache`.
- Produces: `createClickUpSitepingStore(portal: { id: string; slug: string; name: string; clickupFolderId: string; defaultListId: string }): SitepingStore` — consumed by Task 6's route handler. `SitepingStore` type comes from `@siteping/adapter-prisma` (installed in Task 6 — this task's file type-checks once that dependency exists; see note in Step 1 of Task 6 about running Task 5 and Task 6 together if `tsc` is run in between).

This task is not written test-first: it wires three already-tested pure modules (Task 2, 3, 4) together with live ClickUp calls, matching how the rest of this codebase treats ClickUp-dependent code (`ai/chat/route.ts`, `portalIdeas.ts` — no unit tests, verified by manual/integration use, because mocking `fetch` for ClickUp isn't an existing pattern here and would test the mock more than the code). Task 7 is the real verification: a manual end-to-end run against live ClickUp.

- [ ] **Step 1: Add `deleteTask` to `clickup.ts`**

In `src/lib/clickup.ts`, right after `updateTask`:

```ts
export async function deleteTask(taskId: string): Promise<void> {
  await clickupFetch<unknown>(`/task/${taskId}`, { method: 'DELETE' })
}
```

- [ ] **Step 2: Create the store**

Create `src/lib/siteping/store.ts`:

```ts
import type {
  SitepingStore,
  FeedbackCreateInput,
  FeedbackRecord,
  FeedbackUpdateInput,
  FeedbackQuery,
  FeedbackPage,
  AnnotationRecord,
} from '@siteping/adapter-prisma'
import { StoreNotFoundError } from '@siteping/adapter-prisma'
import { randomUUID } from 'node:crypto'
import {
  createTask,
  updateTask,
  deleteTask,
  addTaskAttachment,
  getTask,
  getAllTasksForFolder,
  verifyTaskBelongsToFolder,
} from '@/lib/clickup'
import type { ClickUpTask } from '@/lib/types'
import {
  embedUrlMarker,
  extractClientIdFromDescription,
  extractUrlFromDescription,
  buildFeedbackDescription,
  buildFeedbackTitle,
} from '@/lib/siteping/annotationMarker'
import { withReporterFooter } from '@/lib/reporter'
import { logEvent, EVENT_TASK_CREATED } from '@/lib/portalEvents'
import { invalidateFolderTasks } from '@/lib/clickupCache'

const SITEPING_TAG = 'siteping'
const DATA_ATTACHMENT_NAME = 'siteping-data.json'

const STATUS_TO_CLICKUP: Record<FeedbackUpdateInput['status'], string> = {
  open: 'do zrobienia',
  in_progress: 'w trakcie',
  resolved: 'zamknięte',
  wont_fix: 'zamknięte',
}

const STATUS_FROM_CLICKUP: Record<string, FeedbackRecord['status']> = {
  'backlog': 'open',
  'do zrobienia': 'open',
  'w trakcie': 'in_progress',
  'zablokowane': 'in_progress',
  'przegląd': 'in_progress',
  'weryfikacja': 'in_progress',
  'zamknięte': 'resolved',
}

interface StoredPayload {
  data: FeedbackCreateInput
  taskId: string
}

interface PortalContext {
  id: string
  slug: string
  name: string
  clickupFolderId: string
  defaultListId: string
}

function isSitepingTask(task: ClickUpTask): boolean {
  return (task.tags ?? []).some(t => t.name === SITEPING_TAG)
}

function toAnnotationRecords(input: FeedbackCreateInput, feedbackId: string): AnnotationRecord[] {
  // AnnotationRecord requires elementId/anchorKey as `string | null` (never
  // undefined) — AnnotationCreateInput leaves them optional/undefined when
  // absent, so a plain spread would produce a type mismatch.
  return input.annotations.map(a => ({
    ...a,
    elementId: a.elementId ?? null,
    anchorKey: a.anchorKey ?? null,
    id: randomUUID(),
    feedbackId,
    createdAt: new Date(),
  }))
}

function recordFromCreateInput(input: FeedbackCreateInput, taskId: string, createdAt: Date): FeedbackRecord {
  return {
    id: taskId,
    type: input.type,
    message: input.message,
    status: 'open',
    projectName: input.projectName,
    url: input.url,
    urlPattern: input.urlPattern ?? null,
    authorName: input.authorName,
    authorEmail: input.authorEmail,
    clientId: input.clientId,
    viewport: input.viewport,
    userAgent: input.userAgent,
    resolvedAt: null,
    createdAt,
    updatedAt: createdAt,
    annotations: toAnnotationRecords(input, taskId),
    screenshotUrl: input.screenshotDataUrl ?? null,
    screenshotRegion: input.screenshotRegion ?? null,
    diagnostics: input.diagnostics ?? null,
  }
}

/** Dociaga zalacznik JSON zadania i odtwarza pelny FeedbackRecord. */
async function reconstructFeedbackRecord(task: ClickUpTask): Promise<FeedbackRecord | null> {
  const attachment = (task.attachments ?? []).find(a => a.title === DATA_ATTACHMENT_NAME)
  if (!attachment) return null

  const res = await fetch(attachment.url)
  if (!res.ok) return null
  const payload = (await res.json()) as StoredPayload

  const createdAt = new Date(task.date_created ? Number(task.date_created) : Date.now())
  const record = recordFromCreateInput(payload.data, task.id, createdAt)
  record.status = STATUS_FROM_CLICKUP[task.status.status] ?? 'open'
  record.resolvedAt = task.date_closed ? new Date(Number(task.date_closed)) : null
  record.updatedAt = new Date(Number(task.date_updated))
  return record
}

export function createClickUpSitepingStore(portal: PortalContext): SitepingStore {
  return {
    async createFeedback(data: FeedbackCreateInput): Promise<FeedbackRecord> {
      const existing = await this.findByClientId(data.clientId)
      if (existing) return existing

      const annotation = data.annotations[0] ?? null
      const body = buildFeedbackDescription({
        clientId: data.clientId,
        url: data.url,
        message: data.message,
        annotation,
      })
      const description = withReporterFooter(body, {
        name: data.authorName || null,
        email: data.authorEmail,
        portalName: portal.name,
        portalSlug: portal.slug,
        source: 'siteping',
      })

      const task = await createTask(portal.defaultListId, {
        name: buildFeedbackTitle(data.message),
        description,
        tags: [SITEPING_TAG],
        status: STATUS_TO_CLICKUP.open,
      })

      if (data.screenshotDataUrl) {
        const [, base64] = data.screenshotDataUrl.split(',')
        const bytes = Buffer.from(base64, 'base64')
        await addTaskAttachment(
          task.id,
          new Blob([bytes], { type: 'image/jpeg' }),
          'siteping-screenshot.jpg'
        )
      }

      const payload: StoredPayload = { data, taskId: task.id }
      await addTaskAttachment(
        task.id,
        new Blob([JSON.stringify(payload)], { type: 'application/json' }),
        DATA_ATTACHMENT_NAME
      )

      await invalidateFolderTasks(portal.clickupFolderId)
      await logEvent({
        portalId: portal.id,
        actor: { userId: null, email: data.authorEmail, name: data.authorName || null },
        action: EVENT_TASK_CREATED,
        resourceId: task.id,
        meta: { source: 'siteping', taskName: task.name, url: data.url },
      })

      return recordFromCreateInput(data, task.id, new Date(Number(task.date_created)))
    },

    async findByClientId(clientId: string): Promise<FeedbackRecord | null> {
      const tasks = await getAllTasksForFolder(portal.clickupFolderId)
      const match = tasks.find(
        t => isSitepingTask(t) && extractClientIdFromDescription(t.description) === clientId
      )
      if (!match) return null

      const full = await getTask(match.id)
      return reconstructFeedbackRecord(full)
    },

    async getFeedbacks(query: FeedbackQuery): Promise<FeedbackPage> {
      const tasks = await getAllTasksForFolder(portal.clickupFolderId)
      const candidates = tasks.filter(t => {
        if (!isSitepingTask(t)) return false
        if (extractClientIdFromDescription(t.description) === null) return false
        if (query.url && extractUrlFromDescription(t.description) !== query.url) return false
        return true
      })

      const page = query.page ?? 1
      const limit = query.limit ?? 50
      const pageSlice = candidates.slice((page - 1) * limit, page * limit)

      const fullTasks = await Promise.all(pageSlice.map(t => getTask(t.id)))
      const records = await Promise.all(fullTasks.map(reconstructFeedbackRecord))
      const feedbacks = records.filter((r): r is FeedbackRecord => r !== null)

      return { feedbacks, total: candidates.length }
    },

    async updateFeedback(id: string, data: FeedbackUpdateInput): Promise<FeedbackRecord> {
      const belongs = await verifyTaskBelongsToFolder(id, portal.clickupFolderId)
      if (!belongs) throw new StoreNotFoundError(`Feedback ${id} not found`)

      await updateTask(id, { status: STATUS_TO_CLICKUP[data.status] })
      await invalidateFolderTasks(portal.clickupFolderId)

      const full = await getTask(id)
      const record = await reconstructFeedbackRecord(full)
      if (!record) throw new StoreNotFoundError(`Feedback ${id} has no siteping data attachment`)
      return record
    },

    async deleteFeedback(id: string): Promise<void> {
      const belongs = await verifyTaskBelongsToFolder(id, portal.clickupFolderId)
      if (!belongs) throw new StoreNotFoundError(`Feedback ${id} not found`)

      await deleteTask(id)
      await invalidateFolderTasks(portal.clickupFolderId)
    },

    async deleteAllFeedbacks(): Promise<void> {
      const tasks = await getAllTasksForFolder(portal.clickupFolderId)
      const targets = tasks.filter(isSitepingTask)
      await Promise.all(targets.map(t => deleteTask(t.id)))
      if (targets.length > 0) await invalidateFolderTasks(portal.clickupFolderId)
    },

    async verifyProjectOwnership(id: string): Promise<boolean> {
      return verifyTaskBelongsToFolder(id, portal.clickupFolderId)
    },
  }
}
```

Note: `embedUrlMarker` is imported but not called directly in `store.ts` — it's used inside `buildFeedbackDescription` (Task 3). Remove the unused import if your editor flags it; keep `extractUrlFromDescription` (used in `getFeedbacks`).

- [ ] **Step 3: Type-check**

This will fail right now because `@siteping/adapter-prisma` isn't installed yet — that's expected and resolved by Task 6, Step 1. Do not try to run `tsc --noEmit` standalone after this task; run it after Task 6, Step 1 instead (noted there).

- [ ] **Step 4: Commit**

```bash
git add src/lib/clickup.ts src/lib/siteping/store.ts
git commit -m "feat(siteping): SitepingStore backed by ClickUp (no new table)"
```

---

### Task 6: Install packages, wire the route, configure the API key

**Files:**
- Modify: `package.json` (add `@siteping/adapter-prisma` dependency, `@siteping/widget` devDependency)
- Create: `src/app/api/siteping/[slug]/route.ts`
- Modify: `.env.local` (document the new var; do not commit real secret values)

**Interfaces:**
- Consumes: `createClickUpSitepingStore` from `@/lib/siteping/store`, `checkRateLimit` from `@/lib/siteping/rateLimit`, `portals`/`portalLists` from `@/lib/db/schema`.
- Produces: `GET/POST/PATCH/DELETE/OPTIONS /api/siteping/[slug]` — this is the deliverable Task 7 exercises manually.

- [ ] **Step 1: Install the packages**

Run: `npm install @siteping/adapter-prisma@0.6.4` and `npm install -D @siteping/widget@0.10.7`

Expected: npm prints an "unmet peer dependency @prisma/client" warning for `@siteping/adapter-prisma` — **this is expected and harmless**. The package's compiled code never imports `@prisma/client` when you pass `store` instead of `prisma` (verified: `grep -i prisma dist/index.js` shows only the structural `PrismaStore` class, no `require`/`import` of the real package). Do not add `@prisma/client` to satisfy the warning.

Then run: `npx tsc --noEmit` to confirm Task 5's `store.ts` now type-checks cleanly against the real package types.
Expected: no errors.

- [ ] **Step 2: Add the env var**

In `.env.local`, add a line (generate a real random value, e.g. `openssl rand -hex 32`):

```
SITEPING_API_KEY=<random-hex-string-here>
```

This key is never sent to the browser — it only guards `PATCH`/`DELETE` on the endpoint, and the widget config (Task 7) never sets `apiKey`/`headers`, so those two methods stay 401 for everyone, including us, until we deliberately build an authenticated admin tool that sends this header. Its only other job is satisfying the production startup guard (Global Constraints, third bullet).

- [ ] **Step 3: Write the route**

Create `src/app/api/siteping/[slug]/route.ts`:

```ts
import { NextRequest } from 'next/server'
import { eq } from 'drizzle-orm'
import { createSitepingHandler, type SitepingHandler } from '@siteping/adapter-prisma'
import { db } from '@/lib/db'
import { portals, portalLists } from '@/lib/db/schema'
import { createClickUpSitepingStore } from '@/lib/siteping/store'
import { checkRateLimit } from '@/lib/siteping/rateLimit'

export const runtime = 'nodejs'

interface ResolvedPortal {
  id: string
  slug: string
  name: string
  clickupFolderId: string
  defaultListId: string
  siteDomains: string[]
}

/**
 * Portal utworzony przez SitePing (flaga + domeny + domyslna lista) albo
 * null — kazdy null-case konczy sie 404, nie 403, zeby nie zdradzac
 * istnienia portalu komus, kto zna/zgadnie slug.
 */
async function resolvePortal(slug: string): Promise<ResolvedPortal | null> {
  const rows = await db.select().from(portals).where(eq(portals.slug, slug)).limit(1)
  const portal = rows[0]
  if (!portal || !portal.sitepingEnabled || !portal.siteDomains) return null

  const siteDomains = portal.siteDomains.split(',').map(d => d.trim()).filter(Boolean)
  if (siteDomains.length === 0) return null

  const lists = await db
    .select()
    .from(portalLists)
    .where(eq(portalLists.portalId, portal.id))
    .orderBy(portalLists.sortOrder)
  const defaultList = lists.find(l => l.isDefault) ?? lists[0]
  if (!defaultList) return null

  return {
    id: portal.id,
    slug: portal.slug,
    name: portal.name,
    clickupFolderId: portal.clickupFolderId,
    defaultListId: defaultList.clickupListId,
    siteDomains,
  }
}

function clientIp(request: NextRequest): string {
  return request.headers.get('x-forwarded-for')?.split(',')[0]?.trim() ?? 'unknown'
}

function buildHandler(portal: ResolvedPortal): SitepingHandler {
  return createSitepingHandler({
    store: createClickUpSitepingStore(portal),
    allowedOrigins: portal.siteDomains,
    apiKey: process.env.SITEPING_API_KEY,
    // POST: widget submits from an unauthenticated browser. GET: the
    // widget's own panel lists past feedback, also unauthenticated.
    // PATCH/DELETE are deliberately NOT here — see Task 6 Step 2.
    publicEndpoints: ['POST', 'GET', 'OPTIONS'],
  })
}

async function withPortal(
  slug: string,
  run: (handler: SitepingHandler) => Promise<Response>
): Promise<Response> {
  const portal = await resolvePortal(slug)
  if (!portal) return new Response('Not found', { status: 404 })

  try {
    return await run(buildHandler(portal))
  } catch (error) {
    // Most likely cause: SITEPING_API_KEY missing in production (Global
    // Constraints, third bullet) — createSitepingHandler throws
    // synchronously in that case. A 500 here is far better than an
    // unhandled crash with no response at all.
    console.error(`[siteping] handler construction failed for portal ${slug}:`, error)
    return Response.json({ error: 'SitePing misconfigured' }, { status: 500 })
  }
}

type Params = { params: Promise<{ slug: string }> }

export async function POST(request: NextRequest, { params }: Params) {
  const { slug } = await params
  const portal = await resolvePortal(slug)
  if (!portal) return new Response('Not found', { status: 404 })

  if (!checkRateLimit(`${portal.id}:${clientIp(request)}`, { max: 10, windowMs: 60_000 })) {
    return Response.json({ error: 'Too many requests' }, { status: 429 })
  }

  return withPortal(slug, handler => handler.POST(request))
}

export async function GET(request: NextRequest, { params }: Params) {
  const { slug } = await params
  return withPortal(slug, handler => handler.GET(request))
}

export async function PATCH(request: NextRequest, { params }: Params) {
  const { slug } = await params
  return withPortal(slug, handler => handler.PATCH(request))
}

export async function DELETE(request: NextRequest, { params }: Params) {
  const { slug } = await params
  return withPortal(slug, handler => handler.DELETE(request))
}

export async function OPTIONS(request: NextRequest, { params }: Params) {
  const { slug } = await params
  return withPortal(slug, handler => handler.OPTIONS(request))
}
```

Note the `POST` handler calls `resolvePortal` twice (once for the rate-limit key, once inside `withPortal`) — a second, cheap DB read rather than restructuring `withPortal` to accept a pre-resolved portal, which would need every other method to pass one through too. If this bothers a reviewer, it's a fine simplification for a later pass; it is not a correctness issue.

- [ ] **Step 4: Verify the route builds**

Run: `npx tsc --noEmit`
Expected: no errors.

Run: `npm run build`
Expected: build succeeds, `route.ts` appears in the build output under `/api/siteping/[slug]`.

- [ ] **Step 5: Commit**

```bash
git add package.json package-lock.json src/app/api/siteping
git commit -m "feat(siteping): wire the public endpoint with createSitepingHandler"
```

(Do not commit `.env.local`.)

---

### Task 7: Manual end-to-end verification (this is "how do I test it locally")

There is no automated test for the ClickUp round-trip (see Task 5's rationale). This task is the real check, and it **creates real tasks in a real ClickUp list** — use a sandbox list you control, not WDF/Onyx's production list, and delete the test tasks afterward.

**Files:**
- Create: `scripts/siteping-manual-test.html` (dev-only; deliberately outside `public/` so it is never served by the Next.js app in production)

- [ ] **Step 1: Point a portal at a real ClickUp list**

You need a portal row with `siteping_enabled = true`, `site_domains` including your local test page's origin, and a `portal_lists` row pointing at a real ClickUp list you're willing to see test tasks land in.

If you already have a local portal seeded (`npm run db:seed` or a copy of prod data) pointing at a real folder/list, just flip the flag and add the domain:

```bash
docker exec cp-test-pg psql -U postgres -d clientportal -c \
  "UPDATE portals SET siteping_enabled = true, site_domains = 'http://localhost:5500' WHERE slug = '<your-test-portal-slug>';"
```

Otherwise, insert one pointing at a real folder/list id you control (replace the ClickUp ids):

```bash
docker exec cp-test-pg psql -U postgres -d clientportal -c "
  INSERT INTO portals (slug, name, clickup_folder_id, siteping_enabled, site_domains)
  VALUES ('siteping-test', 'SitePing Test', '<real-clickup-folder-id>', true, 'http://localhost:5500')
  RETURNING id;
"
```

then, using the returned `id` (replace `<portal-id>` and `<real-clickup-list-id>`):

```bash
docker exec cp-test-pg psql -U postgres -d clientportal -c "
  INSERT INTO portal_lists (portal_id, clickup_list_id, display_name, is_default)
  VALUES ('<portal-id>', '<real-clickup-list-id>', 'Test', true);
"
```

- [ ] **Step 2: Create the manual test page**

Create `scripts/siteping-manual-test.html`:

```html
<!DOCTYPE html>
<html lang="pl">
<head>
  <meta charset="UTF-8" />
  <title>SitePing manual test</title>
</head>
<body>
  <h1>Strona testowa</h1>
  <p>To jest testowy przycisk poniżej — kliknij go, potem otwórz widget (prawy dolny róg) i zgłoś anotację.</p>
  <button style="padding: 12px 24px; font-size: 16px;">Zamów teraz</button>

  <script src="/node_modules/@siteping/widget/dist/index.global.js"></script>
  <script>
    window.Siteping.initSiteping({
      endpoint: 'http://localhost:3000/api/siteping/siteping-test',
      projectName: 'siteping-test',
      enableScreenshot: true,
      identity: { name: 'Test Klient', email: 'test@example.com' },
    })
  </script>
</body>
</html>
```

Replace `siteping-test` in the `endpoint` URL with whatever portal slug you used in Step 1.

**Verify the global export name before running:** `grep -o "window\.[A-Za-z]*\s*=" node_modules/@siteping/widget/dist/index.global.js | head -3` — the snippet above assumes `window.Siteping.initSiteping(...)`; adjust the script if the actual IIFE attaches under a different global name.

- [ ] **Step 3: Serve the test page on a different origin than the app**

Run (from the repo root, in a separate terminal from `npm run dev`): `npx --yes serve -l 5500 .`

Serve the whole repo root, not just `scripts/` — `serve` blocks `../` path traversal out of its root, so the page needs `node_modules` reachable under the same served root. This puts the test page at `http://localhost:5500/scripts/siteping-manual-test.html` — a different origin (different port) than `http://localhost:3000`, which is the actual scenario we're testing (client site vs. portal.important.is), not an artifact of local dev.

- [ ] **Step 4: Run the app and exercise the flow**

Run (separate terminal): `npm run dev`

Open `http://localhost:5500/scripts/siteping-manual-test.html` in a browser. Click the widget's floating button, annotate the "Zamów teraz" button, write a message, submit.

Expected:
- No CORS error in the browser console (if there is one, `site_domains` doesn't match the page's origin exactly — check for a trailing slash mismatch).
- A new task appears in the real ClickUp list you configured, tagged `siteping`, with a description containing `**Selektor CSS:**` and the button's actual selector, plus a `---` reporter footer ending in `**Kanał:** zgłoszenie z widgetu na stronie`.
- The task has two attachments: a screenshot and `siteping-data.json`.
- Reopening the widget's panel on the same page shows the feedback you just submitted (exercises `getFeedbacks`/`findByClientId` reading it back from ClickUp).

- [ ] **Step 5: Verify the safety rails**

Run this from a terminal to confirm the Origin allowlist actually rejects an unlisted origin:

```bash
curl -s -X POST http://localhost:3000/api/siteping/siteping-test \
  -H "Origin: http://evil.example.com" \
  -H "Content-Type: application/json" \
  -d '{"projectName":"siteping-test","type":"bug","message":"test","url":"https://x.com","viewport":"1x1","userAgent":"x","authorName":"x","authorEmail":"x@x.com","annotations":[],"clientId":"abc123"}'
```

Expected: the response has no `Access-Control-Allow-Origin` header for `evil.example.com` (inspect with `curl -sD -`), and depending on the package's exact enforcement point, either a rejection status or a response the browser would have blocked client-side — confirm by checking response headers, not just status code, since server-side origin checks in this package are primarily a CORS-header decision, not a hard 403 (re-verify against Step 4's browser test being the real gate).

Also confirm the 404 path — disable the flag and confirm the endpoint disappears:

```bash
docker exec cp-test-pg psql -U postgres -d clientportal -c \
  "UPDATE portals SET siteping_enabled = false WHERE slug = 'siteping-test';"
curl -s -o /dev/null -w "%{http_code}\n" http://localhost:3000/api/siteping/siteping-test
# Expected: 404
```

Re-enable it afterward if you want to keep testing:

```bash
docker exec cp-test-pg psql -U postgres -d clientportal -c \
  "UPDATE portals SET siteping_enabled = true WHERE slug = 'siteping-test';"
```

- [ ] **Step 6: Clean up the real ClickUp test data**

Delete the test task(s) you created in Step 4 directly in ClickUp (or via `curl -X DELETE` against `/api/siteping/<slug>` with the `Authorization: Bearer <SITEPING_API_KEY>` header, which now actually works since you're sending the key). If you created a throwaway portal/list row in Step 1, drop it:

```bash
docker exec cp-test-pg psql -U postgres -d clientportal -c \
  "DELETE FROM portals WHERE slug = 'siteping-test';"
```

- [ ] **Step 7: Commit**

```bash
git add scripts/siteping-manual-test.html
git commit -m "test(siteping): manual end-to-end test page for the widget-to-ClickUp flow"
```

---

## What's deliberately not in this plan

Per the spec's stated scope: no WordPress theme embedding, no "Nowy zadanie na stronie" button in the portal UI, no chat integration, no self-hosting of `/siteping.js` for real client sites. Those are separate future sub-projects once this backend is verified end-to-end.
