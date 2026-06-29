import type { ClickUpTask, ClickUpComment, ClickUpStatus, PortalList } from './types'

const CLICKUP_API = 'https://api.clickup.com/api/v2'
const TOKEN = process.env.CLICKUP_API_TOKEN!

async function clickupFetch<T>(path: string, options?: RequestInit): Promise<T> {
  const res = await fetch(`${CLICKUP_API}${path}`, {
    ...options,
    headers: {
      Authorization: TOKEN,
      'Content-Type': 'application/json',
      ...options?.headers,
    },
  })

  if (!res.ok) {
    const error = await res.text()
    throw new Error(`ClickUp API error ${res.status}: ${error}`)
  }

  return res.json()
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
      if (page > 10) break
    }
  }

  return allTasks
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
export async function verifyTaskBelongsToFolder(
  taskId: string,
  folderId: string
): Promise<boolean> {
  try {
    const task = await getTask(taskId)
    return task.folder.id === folderId
  } catch {
    return false
  }
}
