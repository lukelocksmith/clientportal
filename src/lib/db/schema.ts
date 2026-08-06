import { pgTable, text, boolean, timestamp, integer, uuid, bigint, uniqueIndex, index, doublePrecision, jsonb } from 'drizzle-orm/pg-core'

export const portals = pgTable('portals', {
  id: uuid('id').primaryKey().defaultRandom(),
  slug: text('slug').notNull().unique(),
  name: text('name').notNull(),
  clickupFolderId: text('clickup_folder_id').notNull(),
  clickupSpaceId: text('clickup_space_id').notNull().default('90100136256'),
  /**
   * Logo projektu: adres https albo wbudowany obrazek `data:image/...`.
   * Wstawiane w /admin. Walidacja schematu jest w lib/branding.ts i działa
   * przy ZAPISIE oraz przy odczycie, bo wiersz w bazie mógł powstać wcześniej.
   */
  logoUrl: text('logo_url'),
  /**
   * Kolor marki klienta w postaci `#rrggbb`. Null oznacza kolor domyślny
   * portalu. Kolor tekstu na tym tle liczymy z kontrastu WCAG, a nie wpisujemy
   * ręcznie, bo jasny brand (żółty, limonka) z białym tekstem jest nieczytelny.
   */
  brandColor: text('brand_color'),
  /**
   * Kontakt pokazywany na zakładce Dashboard. Per projekt, bo każdy ma innego
   * opiekuna. Null oznacza zapas na poziomie agencji (zmienne PORTAL_CONTACT_*
   * albo wartości domyślne w lib/portalContact.ts), więc nowy projekt działa
   * bez konfigurowania czegokolwiek.
   */
  /**
   * Kto z zespołu jest kontaktem dla tego projektu. Lista identyfikatorów
   * z lib/team.ts, rozdzielona przecinkami (np. "filip,paulina").
   * Null oznacza domyślny skład, czyli cały zespół.
   */
  contactMemberIds: text('contact_member_ids'),
  /**
   * Dodatkowy kontakt spoza zespołu, opcjonalny. Przydaje się, gdy klient ma
   * dedykowaną osobę, której nie ma w TEAM_MEMBERS. Puste pola oznaczają brak.
   */
  contactName: text('contact_name'),
  contactEmail: text('contact_email'),
  contactPhone: text('contact_phone'),
  isActive: boolean('is_active').notNull().default(true),
  /**
   * Flagi zakładek, per projekt. Włączane w /admin albo przez
   * PATCH /api/admin/portals. Zasada: nowa funkcja jedzie na produkcję
   * domyślnie WYŁĄCZONA, a jej pokazanie klientowi to osobna decyzja.
   *
   * Brama jest po stronie serwera (przekierowanie w page.tsx), nie tylko
   * ukrycie zakładki w headerze. Ukrycie to kosmetyka, adres musi być
   * zamknięty także dla kogoś, kto wpisze go z ręki.
   *
   * Kanban jest domyślnie WŁĄCZONY, bo to dotychczasowa strona główna
   * portalu. Przy wyłączonym kanbanie `/[slug]` przekierowuje na pierwszą
   * włączoną zakładkę.
   */
  kanbanEnabled: boolean('kanban_enabled').notNull().default(true),
  reportsEnabled: boolean('reports_enabled').notNull().default(false),
  historyEnabled: boolean('history_enabled').notNull().default(false),
  dashboardEnabled: boolean('dashboard_enabled').notNull().default(false),
  createdAt: timestamp('created_at').notNull().defaultNow(),
})

export const portalLists = pgTable('portal_lists', {
  id: uuid('id').primaryKey().defaultRandom(),
  portalId: uuid('portal_id').notNull().references(() => portals.id, { onDelete: 'cascade' }),
  clickupListId: text('clickup_list_id').notNull(),
  displayName: text('display_name').notNull(),
  isDefault: boolean('is_default').notNull().default(false),
  sortOrder: integer('sort_order').notNull().default(0),
})

export const portalUsers = pgTable('portal_users', {
  id: uuid('id').primaryKey().defaultRandom(),
  portalId: uuid('portal_id').notNull().references(() => portals.id, { onDelete: 'cascade' }),
  email: text('email').notNull(),
  passwordHash: text('password_hash').notNull(),
  name: text('name'),
  isActive: boolean('is_active').notNull().default(true),
  failedAttempts: integer('failed_attempts').notNull().default(0),
  lockedUntil: timestamp('locked_until'),
  lastLoginAt: timestamp('last_login_at'),
  createdAt: timestamp('created_at').notNull().defaultNow(),
  /**
   * Zdjęcie profilowe jako data URI (256×256 WebP, skalowane w przeglądarce).
   * NIE wolno go wstawiać w payloady list: jest do tego trasa /api/avatar,
   * z cache po stronie przeglądarki. Inaczej lista komentarzy ciągnęłaby
   * dziesiątki kilobajtów przy każdym otwarciu szuflady.
   */
  avatarUrl: text('avatar_url'),
  /** Komentarze [P] i potwierdzone alarmy. `instant` | `daily` | `never`. */
  notifyImportant: text('notify_important').notNull().default('instant'),
  /** Zmiany statusów i zamknięcia. `instant` | `daily` | `never`. */
  notifyBoard: text('notify_board').notNull().default('daily'),
})

/**
 * Powiadomienia dla klienta o tym, co dzieje się w jego zadaniach.
 *
 * Jeden wiersz to jedno powiadomienie dla JEDNEJ osoby, nie zdarzenie
 * współdzielone. Dzięki temu stan przeczytania i stan wysyłki maila są
 * per człowiek, bez tabeli łączącej.
 *
 * Kolejka zbiorczych maili nie jest osobnym bytem: to `email_sent_at IS NULL`.
 */
export const notifications = pgTable('notifications', {
  id: uuid('id').primaryKey().defaultRandom(),
  portalId: uuid('portal_id').notNull().references(() => portals.id, { onDelete: 'cascade' }),
  userId: uuid('user_id').notNull().references(() => portalUsers.id, { onDelete: 'cascade' }),
  /** `comment` | `status` | `closed` | `panic_ack` */
  kind: text('kind').notNull(),
  clickupTaskId: text('clickup_task_id'),
  /** Zdenormalizowana, żeby powiadomienie przeżyło zniknięcie zadania. */
  taskName: text('task_name').notNull(),
  payload: jsonb('payload').notNull().default({}),
  createdAt: timestamp('created_at').notNull().defaultNow(),
  /** Null = nieprzeczytane. */
  readAt: timestamp('read_at'),
  /** Null = czeka na zbiorczy mail. Stempluje i wysyłka natychmiastowa, i digest. */
  emailSentAt: timestamp('email_sent_at'),
}, (t) => ({
  unreadIdx: index('notifications_user_unread_idx').on(t.userId, t.readAt, t.createdAt),
  pendingMailIdx: index('notifications_user_pending_mail_idx').on(t.userId, t.emailSentAt),
}))

/**
 * Linki projektu pokazywane na Dashboardzie: strona produkcyjna, staging,
 * panel WP, GA4, Search Console. Osobna tabela, nie kolumna JSON, bo panel
 * admina edytuje je wierszami, a nie jako tekst.
 *
 * Kolejnosc trzymamy jawnie (`sortOrder`), zeby nie zalezala od kolejnosci
 * wstawiania. Klient widzi zawsze ten sam uklad.
 */
export const portalLinks = pgTable('portal_links', {
  id: uuid('id').primaryKey().defaultRandom(),
  portalId: uuid('portal_id').notNull().references(() => portals.id, { onDelete: 'cascade' }),
  label: text('label').notNull(),
  /** Tylko http/https. Walidacja w lib/projectLinks.ts, przy zapisie i odczycie. */
  url: text('url').notNull(),
  sortOrder: integer('sort_order').notNull().default(0),
}, (t) => ({
  portalIdx: index('portal_links_portal_idx').on(t.portalId, t.sortOrder),
}))

export const sessions = pgTable('sessions', {
  id: uuid('id').primaryKey().defaultRandom(),
  userId: uuid('user_id').notNull().references(() => portalUsers.id, { onDelete: 'cascade' }),
  tokenHash: text('token_hash').notNull().unique(),
  expiresAt: timestamp('expires_at').notNull(),
  createdAt: timestamp('created_at').notNull().defaultNow(),
  ip: text('ip'),
  userAgent: text('user_agent'),
})

export const panicAlerts = pgTable('panic_alerts', {
  id: uuid('id').primaryKey().defaultRandom(),
  portalId: uuid('portal_id').notNull().references(() => portals.id, { onDelete: 'cascade' }),
  /**
   * Kto wcisnął alarm. Wcześniej alarm zapisywał tylko projekt, więc
   * powiadomienie brzmiało „ALARM od klienta Onyx" i przy kilku osobach u
   * jednego klienta nie było do kogo oddzwonić.
   *
   * `userId` jest NULL dla sesji admina (nie jest wierszem w portal_users) i po
   * usunięciu konta. Adres i imię są zdenormalizowane, więc alarm zostaje
   * czytelny nawet wtedy, gdy konto autora już nie istnieje.
   */
  userId: uuid('user_id').references(() => portalUsers.id, { onDelete: 'set null' }),
  userEmail: text('user_email'),
  userName: text('user_name'),
  message: text('message').notNull(),
  ackToken: text('ack_token').notNull().unique(),
  acknowledgedAt: timestamp('acknowledged_at'),
  acknowledgedBy: text('acknowledged_by'),
  createdAt: timestamp('created_at').notNull().defaultNow(),
})

// Weekly-frozen tracked-time snapshots. A Friday-morning cron overwrites each
// task's row with its current ClickUp time_spent (ms); the portal reads this
// frozen value so clients see a stable weekly number, not a live-ticking one.
export const taskTimeSnapshots = pgTable('task_time_snapshots', {
  id: uuid('id').primaryKey().defaultRandom(),
  portalId: uuid('portal_id').notNull().references(() => portals.id, { onDelete: 'cascade' }),
  clickupTaskId: text('clickup_task_id').notNull(),
  timeSpentMs: bigint('time_spent_ms', { mode: 'number' }).notNull().default(0),
  snapshotAt: timestamp('snapshot_at').notNull().defaultNow(),
}, (t) => ({
  portalTaskUnique: uniqueIndex('task_time_snapshots_portal_task_idx').on(t.portalId, t.clickupTaskId),
}))

// Per-request AI token usage + cost, for the admin stats view (by project/user/model).
// userEmail is denormalized so stats survive user deletion.
export const aiUsage = pgTable('ai_usage', {
  id: uuid('id').primaryKey().defaultRandom(),
  portalId: uuid('portal_id').notNull().references(() => portals.id, { onDelete: 'cascade' }),
  userId: uuid('user_id').references(() => portalUsers.id, { onDelete: 'set null' }),
  userEmail: text('user_email'),
  provider: text('provider').notNull(),
  model: text('model').notNull(),
  inputTokens: bigint('input_tokens', { mode: 'number' }).notNull().default(0),
  outputTokens: bigint('output_tokens', { mode: 'number' }).notNull().default(0),
  totalTokens: bigint('total_tokens', { mode: 'number' }).notNull().default(0),
  costUsd: doublePrecision('cost_usd').notNull().default(0),
  createdAt: timestamp('created_at').notNull().defaultNow(),
})

/**
 * Lustro zadań folderu klienta, pod zakładkę Historia i wyszukiwarkę.
 *
 * Po co lustro, a nie odpytywanie ClickUpa na żywo: ClickUp nie zwraca
 * komentarzy ani załączników razem z listą zadań, tylko osobnym zapytaniem
 * per zadanie. Szukanie po komentarzach na żywo to setki wywołań na jedno
 * wciśnięcie klawisza, czyli niewykonalne. Poza tym Historia obejmuje zadania
 * zamknięte, których kanban nie pobiera (`include_closed: false`).
 *
 * `search_text` to jedyne miejsce, gdzie żyje wyszukiwanie, i jedyne, gdzie
 * żyje granica [PUBLIC]. Komentarz bez prefiksu nie jest odfiltrowywany przy
 * wyświetlaniu, on NIGDY nie wchodzi do tej kolumny (lib/publicComments.ts).
 */
export const taskIndex = pgTable('task_index', {
  id: uuid('id').primaryKey().defaultRandom(),
  portalId: uuid('portal_id').notNull().references(() => portals.id, { onDelete: 'cascade' }),
  clickupTaskId: text('clickup_task_id').notNull(),
  name: text('name').notNull(),
  /** `text_content` z ClickUpa, czyli opis bez znaczników markdown. */
  description: text('description'),
  status: text('status').notNull(),
  /** 'open' | 'custom' | 'done' | 'closed' — pozwala odsiać zamknięte bez porównywania polskich nazw. */
  statusType: text('status_type').notNull(),
  priority: text('priority'),
  listName: text('list_name'),
  /** null oznacza zadanie nadrzędne. Subtaski indeksujemy, ale nie renderujemy jako wiersze. */
  parentId: text('parent_id'),
  url: text('url'),
  dateCreated: bigint('date_created', { mode: 'number' }).notNull(),
  dateUpdated: bigint('date_updated', { mode: 'number' }).notNull(),
  dateClosed: bigint('date_closed', { mode: 'number' }),
  attachmentCount: integer('attachment_count').notNull().default(0),
  publicCommentCount: integer('public_comment_count').notNull().default(0),
  subtaskCount: integer('subtask_count').notNull().default(0),
  searchText: text('search_text').notNull().default(''),
  /**
   * Kiedy ostatnio dociągnęliśmy dla tego zadania komentarze i załączniki.
   * Osobno od `indexedAt`, bo pola podstawowe odświeżamy przy każdym
   * przebiegu (są darmowe, przychodzą z listą), a treść tylko gdy
   * `date_updated` zadania jest świeższy niż ta data. To ta różnica sprawia,
   * że codzienny przebieg kosztuje kilkanaście wywołań, nie kilkaset.
   */
  contentSyncedAt: timestamp('content_synced_at'),
  indexedAt: timestamp('indexed_at').notNull().defaultNow(),
}, (t) => ({
  portalTaskUnique: uniqueIndex('task_index_portal_task_idx').on(t.portalId, t.clickupTaskId),
  portalCreatedIdx: index('task_index_portal_created_idx').on(t.portalId, t.dateCreated),
}))

/**
 * Rejestr przebiegów cronów. Powstał, bo dotychczasowy cron Track Time
 * zwracał wynik w treści odpowiedzi HTTP, a wpis w crontabie kierował ją do
 * /dev/null. Awaria była więc niewidoczna: jedynym sposobem sprawdzenia, czy
 * cokolwiek się policzyło, było wejście po SSH do bazy.
 *
 * Historia jest na to wrażliwsza niż zamrożone godziny: klient, który widzi
 * listę urwaną trzy tygodnie wcześniej, traci zaufanie do portalu, nie do
 * ClickUpa. Dlatego portal pokazuje datę ostatniej udanej synchronizacji.
 */
export const cronRuns = pgTable('cron_runs', {
  id: uuid('id').primaryKey().defaultRandom(),
  /** 'task-index' | 'time-snapshot' */
  job: text('job').notNull(),
  /** null dla przebiegu obejmującego wszystkie portale. */
  portalId: uuid('portal_id').references(() => portals.id, { onDelete: 'set null' }),
  ok: boolean('ok').notNull(),
  itemsProcessed: integer('items_processed').notNull().default(0),
  /** Podsumowanie albo treść błędu. */
  detail: text('detail'),
  startedAt: timestamp('started_at').notNull(),
  finishedAt: timestamp('finished_at').notNull().defaultNow(),
}, (t) => ({
  jobFinishedIdx: index('cron_runs_job_finished_idx').on(t.job, t.finishedAt),
}))

/**
 * Zaproszenia do portalu. Nowy użytkownik NIE dostaje hasła od nas: dostaje
 * mailem jednorazowy link, pod którym ustawia własne.
 *
 * Po co osobna tabela, a nie kolumny w portal_users: zaproszenie da się
 * wysłać ponownie (stare traci moc, nowe powstaje), a historia zostaje do
 * wglądu. Trzymamy HASH tokenu, nie token, tak samo jak w tabeli sesji:
 * wyciek bazy nie może dać nikomu możliwości ustawienia hasła klientowi.
 */
export const userInvites = pgTable('user_invites', {
  id: uuid('id').primaryKey().defaultRandom(),
  /**
   * 'invite' to pierwsze zaproszenie, 'reset' to odzyskiwanie hasła.
   * Ten sam mechanizm tokenu, ale różna treść maila, różny czas ważności
   * (reset krócej) i różne napisy na stronie.
   */
  kind: text('kind').notNull().default('invite'),
  userId: uuid('user_id').notNull().references(() => portalUsers.id, { onDelete: 'cascade' }),
  portalId: uuid('portal_id').notNull().references(() => portals.id, { onDelete: 'cascade' }),
  tokenHash: text('token_hash').notNull().unique(),
  expiresAt: timestamp('expires_at').notNull(),
  /** Null dopóki nikt nie ustawił hasła tym linkiem. Jednorazowość. */
  usedAt: timestamp('used_at'),
  createdAt: timestamp('created_at').notNull().defaultNow(),
}, (t) => ({
  userIdx: index('user_invites_user_idx').on(t.userId),
}))

/**
 * Historia zdarzeń portalu, przypisana do osoby: kto zgłosił zadanie, kto
 * wcisnął alarm, kto napisał komentarz, kto wysłał pomysł.
 *
 * Jedna tabela na wszystkie zdarzenia, z kolumną `action` jako rozróżnieniem
 * (lib/portalEvents.ts). Osobne tabele per rodzaj wymagałyby sumowania kilku
 * zapytań tylko po to, żeby pokazać jedną listę „co ta osoba u nas zrobiła",
 * a to jest dokładnie to pytanie, na które ta tabela odpowiada.
 *
 * `userEmail` i `userName` są ZDENORMALIZOWANE celowo, tak samo jak w
 * `ai_usage`. Historia musi przeżyć usunięcie konta, bo inaczej po odejściu
 * osoby z firmy klienta zostają zdarzenia bez autora, czyli tabela przestaje
 * odpowiadać na jedyne pytanie, po które się do niej sięga.
 */
/**
 * Rejestr wysłanych maili.
 *
 * Powstał po konkretnym zdarzeniu: dodano konto klientowi, osoba powiedziała,
 * że nie dostała zaproszenia, a ustalenie prawdy wymagało wejścia po SSH do
 * logów postfixa i odpytania API przekaźnika. Panel nie wiedział o tym mailu
 * NIC, bo wynik wysyłki wracał w odpowiedzi HTTP i tam ginął.
 *
 * `detail` trzyma odpowiedź serwera SMTP, nie tylko sukces. To ona odróżnia
 * „przyjęte do wysyłki" od „dostarczone" i bez niej nie da się powiedzieć,
 * czyj jest problem: nasz, przekaźnika czy odbiorcy.
 */
export const mailLog = pgTable('mail_log', {
  id: uuid('id').primaryKey().defaultRandom(),
  portalId: uuid('portal_id').references(() => portals.id, { onDelete: 'set null' }),
  /** Adres odbiorcy. Zostaje po usunięciu konta, bo pytanie „czy dostał" nie znika. */
  recipient: text('recipient').notNull(),
  /** 'invite' | 'reset' | 'password-changed' | 'panic' */
  kind: text('kind').notNull(),
  subject: text('subject').notNull(),
  ok: boolean('ok').notNull(),
  detail: text('detail'),
  /** Identyfikator wiadomości. Po nim szuka się jej w logach przekaźnika. */
  messageId: text('message_id'),
  createdAt: timestamp('created_at').notNull().defaultNow(),
}, (t) => ({
  portalCreatedIdx: index('mail_log_portal_created_idx').on(t.portalId, t.createdAt),
  recipientIdx: index('mail_log_recipient_idx').on(t.recipient, t.createdAt),
}))

export const auditLog = pgTable('audit_log', {
  id: uuid('id').primaryKey().defaultRandom(),
  /** NULL dla sesji admina (nie jest wierszem w portal_users) i po usunięciu konta. */
  userId: uuid('user_id').references(() => portalUsers.id, { onDelete: 'set null' }),
  userEmail: text('user_email'),
  userName: text('user_name'),
  portalId: uuid('portal_id').references(() => portals.id, { onDelete: 'cascade' }),
  action: text('action').notNull(),
  /** Identyfikator rzeczy, której zdarzenie dotyczy: zadanie w ClickUpie, alarm. */
  resourceId: text('resource_id'),
  /** JSON w tekście: nazwa zadania, adres, priorytet. Czytany przez lib/portalEvents.ts. */
  meta: text('meta'),
  createdAt: timestamp('created_at').notNull().defaultNow(),
}, (t) => ({
  portalCreatedIdx: index('audit_log_portal_created_idx').on(t.portalId, t.createdAt),
  userActionIdx: index('audit_log_user_action_idx').on(t.userId, t.action, t.createdAt),
}))
