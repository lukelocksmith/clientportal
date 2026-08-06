import type { SitepingStore } from '@siteping/adapter-prisma'
import { StoreNotFoundError } from '@siteping/adapter-prisma'

// `@siteping/adapter-prisma`'s public entry point re-exports `SitepingStore`
// but NOT the input/output types used by its methods (verified against the
// installed 0.6.4 package: `dist/index.d.ts` only re-exports a hand-picked
// name list from `siteping-core.js`, and `FeedbackCreateInput` etc. aren't in
// it, even though they exist in the underlying `types.d.ts`). Deriving them
// from `SitepingStore`'s own method signatures avoids importing names that
// don't exist at the package's public surface, without reaching into
// internal/unexported module paths.
type FeedbackCreateInput = Parameters<SitepingStore['createFeedback']>[0]
type FeedbackRecord = Awaited<ReturnType<SitepingStore['createFeedback']>>
type FeedbackUpdateInput = Parameters<SitepingStore['updateFeedback']>[1]
type FeedbackQuery = Parameters<SitepingStore['getFeedbacks']>[0]
type FeedbackPage = Awaited<ReturnType<SitepingStore['getFeedbacks']>>
type AnnotationRecord = FeedbackRecord['annotations'][number]
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
  extractClientIdFromDescription,
  extractUrlFromDescription,
  buildFeedbackDescription,
  buildFeedbackTitle,
  withSitepingMarkers,
} from '@/lib/siteping/annotationMarker'
import { withReporterFooter, ADMIN_ACTOR_EMAIL } from '@/lib/reporter'
import { logEvent, EVENT_TASK_CREATED } from '@/lib/portalEvents'
import { invalidateFolderTasks, getCachedTasksForScope } from '@/lib/clickupCache'
import type { PortalScope } from '@/lib/portalScope'

const SITEPING_TAG = 'siteping'
const DATA_ATTACHMENT_NAME = 'siteping-data.json'

/**
 * Pusty zakres znaczy „caly folder" (patrz portalScope.ts) — SitePing czyta
 * zgloszenia z calego folderu klienta, bez zawezania do list portalu, bo
 * zadanie moze zostac przeniesione miedzy listami po zgloszeniu.
 */
const WHOLE_FOLDER_SCOPE: PortalScope = []

/**
 * Ile zadan maksymalnie dociagamy per jedno GET.
 *
 * `query.limit` przychodzi OD KLIENTA i schemat pakietu (`getQuerySchema`)
 * dopuszcza do 100. Kazde zadanie w wycinku strony to osobny `getTask` PLUS
 * pobranie zalacznika JSON, czyli 200 wywolan sieciowych z jednego, darmowego,
 * anonimowego GET-a. Lista zadan folderu idzie juz przez cache, ale ten
 * rozstrzal NIE — wiec obcinamy go po naszej stronie, niezaleznie od tego, co
 * przyslal klient. Panel widgetu jest per-URL, wiec 20 pozycji na strone to i
 * tak wiecej, niz realnie widac.
 */
const MAX_TASKS_PER_PAGE = 20

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
  /**
   * Origin strony klienta (`https://wodadlafirmy.pl`), z ktorego przyszlo
   * zgloszenie. Potrzebny, bo widget przysyla sama sciezke, a link w zadaniu
   * ma byc klikalny. Null, gdy zadanie nie mialo naglowka Origin — wtedy opis
   * pokazuje sama sciezke zamiast polamanego adresu.
   */
  siteOrigin?: string | null
}

function isSitepingTask(task: ClickUpTask): boolean {
  return (task.tags ?? []).some(t => t.name === SITEPING_TAG)
}

/**
 * Zadanie z markerem clientId, bez dociagania zalacznika.
 *
 * Rozdzielone od `reconstructFeedbackRecord` naumyslnie: to jest jedyny
 * pewny test "czy zadanie dla tego clientId juz istnieje", uzywany do
 * dedupu w `createFeedback`. Sprawdzanie istnienia PRZEZ udana rekonstrukcje
 * (ktora wymaga zalacznika JSON) tworzylo okno na duplikat — proces mogl
 * umrzec miedzy "zadanie powstalo" a "zalacznik JSON wgrany", i kazda
 * kolejna proba nie znajdywala niczego, tworzac drugie zadanie od zera.
 */
async function findTaskByClientId(folderId: string, clientId: string): Promise<ClickUpTask | null> {
  // Przez cache, NIE przez `getAllTasksForFolder` wprost: widget odpytuje
  // endpoint przy kazdym wejsciu na strone klienta i przy kazdej nawigacji SPA
  // (`watchNavigation` domyslnie true), a jedno przejscie po folderze to
  // 5-12 wywolan ClickUpa na wspolnym `CLICKUP_API_TOKEN` — tym samym, z
  // ktorego korzysta kanban, czat i cron wszystkich pozostalych klientow.
  // Ruch na jednej stronie klienta nie moze wyczerpac limitu calej reszcie.
  // Poprawnosc cache'u trzyma `invalidateFolderTasks` wolane po kazdym zapisie.
  const tasks = await getCachedTasksForScope(folderId, WHOLE_FOLDER_SCOPE)
  const match = tasks.find(
    t => isSitepingTask(t) && extractClientIdFromDescription(t.description) === clientId
  )
  return match ?? null
}

/** Wgrywa zrzut ekranu (jesli jest) i zalacznik z danymi zgloszenia. */
async function uploadFeedbackData(taskId: string, data: FeedbackCreateInput): Promise<void> {
  if (data.screenshotDataUrl) {
    const [, base64] = data.screenshotDataUrl.split(',')
    const bytes = Buffer.from(base64, 'base64')
    await addTaskAttachment(
      taskId,
      new Blob([bytes], { type: 'image/jpeg' }),
      'siteping-screenshot.jpg'
    )
  }

  const payload: StoredPayload = { data, taskId }
  await addTaskAttachment(
    taskId,
    new Blob([JSON.stringify(payload)], { type: 'application/json' }),
    DATA_ATTACHMENT_NAME
  )
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

  // Blad sieciowy (DNS, timeout, TLS) wywala fetch wyjatkiem, nie tylko
  // niepomyslnym statusem — caly blok w try/catch, zeby ta funkcja NIGDY nie
  // rzucala i wolajacy (findByClientId, getFeedbacks, updateFeedback, i teraz
  // dedup w createFeedback) zawsze dostawal null zamiast nieobslugiwanego 500.
  try {
    const res = await fetch(attachment.url)
    if (!res.ok) return null
    const payload = (await res.json()) as StoredPayload

    const createdAt = new Date(task.date_created ? Number(task.date_created) : Date.now())
    const record = recordFromCreateInput(payload.data, task.id, createdAt)
    record.status = STATUS_FROM_CLICKUP[task.status.status] ?? 'open'
    record.resolvedAt = task.date_closed ? new Date(Number(task.date_closed)) : null
    record.updatedAt = new Date(Number(task.date_updated))
    return record
  } catch {
    return null
  }
}

/**
 * Zgloszenie z widgetu NIE MA zweryfikowanego autora.
 *
 * `audit_log.user_email` / `user_name` sa czytane w innych miejscach portalu
 * (`getTaskReporter`, `portalEventActors`) tak, jakby wskazywaly realnego
 * czlonka portalu — tam kolumna jest tozsamoscia, nie notatka. Widget stoi na
 * stronie klienta i przyjmuje dowolne imie i adres od kogokolwiek, wiec te
 * dane nie moga trafic do tych kolumn. Ida do `meta`, gdzie sa widoczne przy
 * diagnozie, ale zaden konsument `audit_log` nie potraktuje ich jak tozsamosci.
 */
const ANONYMOUS_ACTOR = { userId: null, email: null, name: null } as const

function sitepingEventMeta(data: FeedbackCreateInput, taskName: string): Record<string, unknown> {
  return {
    source: 'siteping',
    taskName,
    url: data.url,
    submittedName: data.authorName,
    submittedEmail: data.authorEmail,
  }
}

/**
 * Zgloszenie podszywajace sie pod konto obejsciowe agencji.
 *
 * `authorEmail` przychodzi z FORMULARZA WIDGETU na stronie klienta, bez
 * jakiegokolwiek uwierzytelnienia — kazdy moze tam wpisac cokolwiek. Adres
 * `admin@important.is` ma w tym repo znaczenie: `isAdminActor` rozpoznaje go
 * i `reporterFooter` podpisuje wtedy zadanie jako „important.is (tryb
 * administratora, w imieniu klienta)". Anonim z internetu nie moze wystawic
 * zadania z takim podpisem, bo to falszuje historie wspolpracy, na ktora
 * powolujemy sie przy rozliczeniu.
 *
 * Odrzucamy CALE zgloszenie zamiast po cichu podmieniac adres: zadanie
 * podpisane inaczej, niz prosil zglaszajacy, byloby trudniejsze do
 * wytlumaczenia niz brak zadania.
 */
class SitepingImpersonationError extends Error {
  constructor() {
    super('Zgłoszenie odrzucone: adres nadawcy jest zastrzeżony')
    this.name = 'SitepingImpersonationError'
  }
}

function assertNotImpersonatingAdmin(data: FeedbackCreateInput, portalSlug: string): void {
  if (data.authorEmail.trim().toLowerCase() !== ADMIN_ACTOR_EMAIL.toLowerCase()) return

  console.warn(
    `[siteping] odrzucono zgłoszenie podszywające się pod ${ADMIN_ACTOR_EMAIL} (portal ${portalSlug})`
  )
  // `createSitepingHandler` lapie wyjatek ze store'a i zwraca 500 z generycznym
  // „Internal server error" (zweryfikowane w `dist/index.js`:
  // `actionableErrorMessage` nie przepuszcza tresci bledu). Zglaszajacy nie
  // dowiaduje sie wiec, ze ten adres jest szczegolny, a my mamy wpis w logu.
  throw new SitepingImpersonationError()
}

/**
 * Ostrzega, gdy ClickUp zjadl tag `siteping`.
 *
 * ClickUp po cichu POMIJA nazwy tagow, ktore nie istnieja juz w przestrzeni
 * zadania (udokumentowane przy `createTask` w lib/clickup.ts) — zadanie
 * powstaje, ale bez taga. Bez taga przestaje dzialac dedup, `getFeedbacks` i
 * filtrowanie po stronie zespolu, i to wszystko bez jednego bledu gdziekolwiek.
 * Tag trzeba raz zalozyc recznie w przestrzeni klienta przed wlaczeniem flagi.
 */
function warnIfTagMissing(task: ClickUpTask, portalSlug: string): void {
  if (isSitepingTask(task)) return
  console.warn(
    `[siteping] zadanie ${task.id} (portal ${portalSlug}) powstało BEZ tagu "${SITEPING_TAG}" — ` +
      `tag prawdopodobnie nie istnieje w przestrzeni ClickUp tego klienta. Załóż go w ClickUpie, ` +
      `inaczej dedup i odczyt zgłoszeń nie będą działać.`
  )
}

export function createClickUpSitepingStore(portal: PortalContext): SitepingStore {
  return {
    async createFeedback(data: FeedbackCreateInput): Promise<FeedbackRecord> {
      assertNotImpersonatingAdmin(data, portal.slug)

      const match = await findTaskByClientId(portal.clickupFolderId, data.clientId)
      if (match) {
        const full = await getTask(match.id)
        const existing = await reconstructFeedbackRecord(full)
        if (existing) return existing

        // Zadanie z markerem clientId istnieje, ale zalacznik z danymi nigdy
        // sie nie wgral — poprzednie wywolanie umarlo miedzy "zadanie
        // powstalo" a "zalacznik JSON wgrany" (timeout, blip sieciowy).
        // Dokoncz upload na TYM SAMYM zadaniu, nie tworz drugiego: retry ma
        // sie samonaprawic, a nie zduplikowac. Ta sciezka zamyka to samo
        // zgloszenie co createTask nizej, wiec dostaje te same efekty
        // uboczne (cache, log), zeby obie sciezki byly symetryczne.
        await uploadFeedbackData(match.id, data)
        await invalidateFolderTasks(portal.clickupFolderId)
        await logEvent({
          portalId: portal.id,
          actor: ANONYMOUS_ACTOR,
          action: EVENT_TASK_CREATED,
          resourceId: match.id,
          meta: sitepingEventMeta(data, full.name),
        })
        return recordFromCreateInput(data, match.id, new Date(Number(full.date_created)))
      }

      const annotation = data.annotations[0] ?? null
      // Kolejnosc: tresc + „gdzie" → stopka zglaszajacego → markery techniczne.
      // Markery MUSZA byc doklejone po stopce, inaczej ladowaly by w srodku.
      const describe = (feedbackId: string | null) =>
        withSitepingMarkers(
          withReporterFooter(
            buildFeedbackDescription({
              clientId: data.clientId,
              url: data.url,
              message: data.message,
              annotation,
              siteOrigin: portal.siteOrigin,
              feedbackId,
            }),
            {
              name: data.authorName || null,
              email: data.authorEmail,
              portalName: portal.name,
              portalSlug: portal.slug,
              source: 'siteping',
            }
          ),
          data.clientId,
          data.url
        )

      const task = await createTask(portal.defaultListId, {
        name: buildFeedbackTitle(data.message),
        description: describe(null),
        tags: [SITEPING_TAG],
        status: STATUS_TO_CLICKUP.open,
      })

      warnIfTagMissing(task, portal.slug)

      // Link do zaznaczonego miejsca zawiera identyfikator zadania, ktory
      // powstaje dopiero teraz — stad drugi zapis opisu. Nie przewracamy
      // zgloszenia, gdy ta poprawka sie nie uda: zadanie juz istnieje i ma
      // komplet danych, brak samego linku jest niedogodnoscia, a nie utrata.
      if (portal.siteOrigin) {
        try {
          await updateTask(task.id, { description: describe(task.id) })
        } catch (error) {
          console.warn(`[siteping] nie udało się dopisać linku do zadania ${task.id}:`, error)
        }
      }

      await uploadFeedbackData(task.id, data)

      await invalidateFolderTasks(portal.clickupFolderId)
      await logEvent({
        portalId: portal.id,
        actor: ANONYMOUS_ACTOR,
        action: EVENT_TASK_CREATED,
        resourceId: task.id,
        meta: sitepingEventMeta(data, task.name),
      })

      return recordFromCreateInput(data, task.id, new Date(Number(task.date_created)))
    },

    async findByClientId(clientId: string): Promise<FeedbackRecord | null> {
      const match = await findTaskByClientId(portal.clickupFolderId, clientId)
      if (!match) return null

      const full = await getTask(match.id)
      return reconstructFeedbackRecord(full)
    },

    async getFeedbacks(query: FeedbackQuery): Promise<FeedbackPage> {
      // Przez cache, nie wprost do ClickUpa — uzasadnienie przy
      // `findTaskByClientId`. To jest goracsza sciezka z dwoch: panel widgetu
      // odpytuje GET przy kazdym otwarciu i kazdej nawigacji.
      const tasks = await getCachedTasksForScope(portal.clickupFolderId, WHOLE_FOLDER_SCOPE)
      const candidates = tasks.filter(t => {
        if (!isSitepingTask(t)) return false
        if (extractClientIdFromDescription(t.description) === null) return false
        if (query.url && extractUrlFromDescription(t.description) !== query.url) return false
        return true
      })

      const page = query.page ?? 1
      // Limit obcinamy PRZED wyliczeniem wycinka, nie po nim, zeby strona i
      // przesuniecie zgadzaly sie ze soba: `page=2` ma zaczynac sie tam, gdzie
      // skonczyla sie strona 1, a nie tam, gdzie skonczylaby sie, gdyby klient
      // dostal to, o co prosil. `total` zostaje pelne, wiec widget dalej wie,
      // ile zgloszen jest naprawde.
      const limit = Math.min(query.limit ?? 50, MAX_TASKS_PER_PAGE)
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
      // Jedyne miejsce, ktore CELOWO omija cache: kasowanie hurtem jest
      // nieodwracalne i nieosiagalne z publicznego widgetu (PATCH/DELETE bez
      // `SITEPING_API_KEY` to 401), wiec kosztu ruchu tu nie ma, a dzialanie
      // na liscie sprzed 45 sekund moglo by ominac zadanie utworzone chwile
      // wczesniej albo probowac skasowac takie, ktorego juz nie ma.
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
