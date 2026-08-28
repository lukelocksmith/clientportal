import type { BlockNode } from './commentBlocks'
// ClickUp types matching real API response
export type ClickUpPriority = {
  id: string
  priority: 'urgent' | 'high' | 'normal' | 'low'
  color: string
  orderindex: string
}

export type ClickUpStatus = {
  status: string
  color: string
  type: 'open' | 'custom' | 'done' | 'closed'
  orderindex: number
}

export type ClickUpAssignee = {
  id: number
  username: string
  color: string
  profilePicture: string | null
  initials: string
}

export type ClickUpAttachment = {
  id: string
  url: string
  title: string
  date: string
  type: number
  source: number
  user_id: string
  thumbnail_small?: string
  thumbnail_large?: string
}

export type ClickUpComment = {
  id: string
  /**
   * Surowy zapis z ClickUpa. Istnieje TYLKO po stronie serwera: `blocks` niżej
   * są z niego zrobione, a do przeglądarki klienta to pole NIE jedzie, bo
   * zawiera znacznik `[P]` i wzmianki o osobach, czyli dokładnie to, co z
   * widoku usuwamy (patrz filterPublicComments).
   */
  comment?: Array<{ text: string }>
  comment_text: string
  /**
   * Autor po stronie ClickUpa: imię, nazwisko, PRYWATNY adres e-mail i zdjęcie
   * członka zespołu. Pole serwerowe. Do klienta jedzie tylko `sender`, czyli
   * „important.is" albo imię klienta (patrz filterPublicComments).
   */
  user?: ClickUpAssignee | null
  resolved?: boolean
  date: string
  replies?: ClickUpComment[]
  sender?: string  // z prefiksu [PUBLIC]: imię klienta albo AGENCY_SENDER (publicComments.ts)
  /** Czy TEN zalogowany dodal ten komentarz z portalu — steruje przyciskami edycji/usuwania. */
  isOwn?: boolean
  /**
   * Konto portalu, którego zdjęcie ma stanąć przy komentarzu, albo brak.
   * Rozstrzyga serwer, po nazwie autora (patrz lib/commentAvatars.ts): sam
   * komentarz z ClickUpa nie wie, kto z portalu go napisał. Nie jest to adres
   * obrazka, tylko identyfikator dla trasy `/api/avatar`, bo data URI
   * w payloadzie wątku to dziesiątki kilobajtów na komentarz.
   */
  avatarUserId?: string | null
  /**
   * Treść jako drzewo bloków, gotowa do wyświetlenia: formatowanie z ClickUpa,
   * zdjęty znacznik `[P]`, wzmianki o zadaniach rozwiązane po stronie serwera
   * (nazwa tylko dla zadań z tego portalu). Dokłada `filterPublicComments`.
   */
  blocks?: BlockNode[]
}

export type ClickUpSubtask = {
  id: string
  name: string
  status: ClickUpStatus
  priority: ClickUpPriority | null
  date_due: string | null
}

export type ClickUpTask = {
  id: string
  name: string
  description: string | null
  status: ClickUpStatus
  priority: ClickUpPriority | null
  assignees: ClickUpAssignee[]
  date_created: string
  date_updated: string
  date_due: string | null
  date_start: string | null
  list: { id: string; name: string }
  folder: { id: string; name: string }
  parent: string | null
  /** Opis bez znaczników markdown. Zwracany przez endpointy listowe obok `description`. */
  text_content?: string | null
  /** Milisekundy jako string, jak wszystkie daty ClickUpa. Null dla zadań otwartych. */
  date_closed?: string | null
  date_done?: string | null
  archived?: boolean
  // Time fields from ClickUp, both in milliseconds
  time_estimate: number | null
  time_spent: number | null
  subtasks?: ClickUpSubtask[]
  // Nested subtasks built from the flat ClickUp response (parent -> children)
  children?: ClickUpTask[]
  // Weekly-frozen tracked time injected server-side from task_time_snapshots (ms)
  trackedTimeMs?: number | null
  attachments?: ClickUpAttachment[]
  /**
   * Tagi zadania. ClickUp zwraca je w każdej odpowiedzi listowej, portal po
   * prostu ich wcześniej nie modelował. Portal czyta stąd jedną rzecz: tag
   * awarii, który zapala plakietkę Alarm na karcie (patrz `isAwaria`).
   */
  tags?: ClickUpTag[]
  url: string
}

/** Tag ClickUpa. Kolory przychodzą, ale portal ich nie używa. */
export type ClickUpTag = {
  name: string
  tag_fg?: string
  tag_bg?: string
}

// Portal types (our DB models)
export type Portal = {
  id: string
  slug: string
  name: string
  clickupFolderId: string
  clickupSpaceId: string
  logoUrl: string | null
  isActive: boolean
}

export type PortalList = {
  id: string
  portalId: string
  clickupListId: string
  displayName: string
  isDefault: boolean
  sortOrder: number
}

export type PortalUser = {
  id: string
  portalId: string
  email: string
  name: string | null
  isActive: boolean
  createdAt: Date
}

export type Session = {
  userId: string
  portalId: string
  portalSlug: string
  email: string
  name: string | null
  expiresAt: Date
}

// Kanban column definition
export type KanbanColumn = {
  id: string
  title: string
  color: string
  type: ClickUpStatus['type']
  tasks: ClickUpTask[]
  /** Link "Zobacz wiecej" pod lista — dziś tylko kolumna "zamkniete", i tylko gdy Historia jest wlaczona. Null = bez linku. */
  moreHref?: string | null
  /**
   * Po czyjej stronie stoi zadanie w tej kolumnie: „important.is" albo nazwa
   * projektu. Null dla statusów, przy których strona bywa różna (patrz
   * `statusSide` w lib/utils.ts). Nagłówek kolumny dopisuje to pod nazwą.
   */
  side?: string | null
}

// Chat message
export type ChatMessage = {
  id: string
  role: 'user' | 'assistant'
  content: string
  attachments?: Array<{ name: string; url: string; type: string }>
  taskCreated?: { id: string; name: string; url: string }
  createdAt: Date
}

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
