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
  comment: Array<{ text: string }>
  comment_text: string
  user: ClickUpAssignee | null
  resolved: boolean
  date: string
  replies?: ClickUpComment[]
  sender?: string  // parsed from [PUBLIC] prefix: client name or 'important.is'
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
  subtasks?: ClickUpSubtask[]
  attachments?: ClickUpAttachment[]
  url: string
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
