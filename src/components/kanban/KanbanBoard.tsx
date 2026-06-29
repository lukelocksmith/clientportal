'use client'
import { useState, useCallback, useOptimistic } from 'react'
import {
  DndContext,
  DragEndEvent,
  DragOverlay,
  DragStartEvent,
  PointerSensor,
  TouchSensor,
  useSensor,
  useSensors,
  closestCorners,
} from '@dnd-kit/core'
import type { ClickUpTask, KanbanColumn } from '@/lib/types'
import { getStatusColor } from '@/lib/utils'
import { KanbanColumn as KanbanColumnComponent } from './KanbanColumn'
import { TaskCard } from './TaskCard'
import { TaskDrawer } from './TaskDrawer'
import { Plus, RefreshCw, MessageSquare } from 'lucide-react'
import { toast } from 'sonner'
import { ChatWindow } from '@/components/chat/ChatWindow'

// Space-level statuses — consistent across all client lists
const COLUMN_ORDER = ['backlog', 'do zrobienia', 'w trakcie', 'zablokowane', 'zrobione', 'zamknięte']

interface KanbanBoardProps {
  initialTasks: ClickUpTask[]
  slug: string
  portalName: string
  userEmail: string
}

const PRIORITY_ORDER: Record<string, number> = { urgent: 1, high: 2, normal: 3, low: 4 }

function sortByPriority(tasks: ClickUpTask[]): ClickUpTask[] {
  return [...tasks].sort((a, b) => {
    const pa = a.priority ? (PRIORITY_ORDER[a.priority.priority] ?? 5) : 5
    const pb = b.priority ? (PRIORITY_ORDER[b.priority.priority] ?? 5) : 5
    return pa - pb
  })
}

function buildColumns(tasks: ClickUpTask[]): KanbanColumn[] {
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

  return COLUMN_ORDER.map(status => ({
    id: status,
    title: status,
    color: getStatusColor(status),
    type: tasks.find(t => t.status.status === status)?.status.type ?? 'open',
    tasks: sortByPriority(tasksByStatus[status] ?? []),
  }))
}

export function KanbanBoard({ initialTasks, slug, portalName, userEmail }: KanbanBoardProps) {
  const [tasks, setTasks] = useState<ClickUpTask[]>(initialTasks)
  const [activeTask, setActiveTask] = useState<ClickUpTask | null>(null)
  const [selectedTask, setSelectedTask] = useState<ClickUpTask | null>(null)
  const [showChat, setShowChat] = useState(false)
  const [chatMode, setChatMode] = useState<'new-task' | 'general'>('general')
  const [refreshing, setRefreshing] = useState(false)

  const columns = buildColumns(tasks)

  const sensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 8 } }),
    useSensor(TouchSensor, { activationConstraint: { delay: 250, tolerance: 5 } })
  )

  function handleDragStart(event: DragStartEvent) {
    const task = tasks.find(t => t.id === event.active.id)
    setActiveTask(task ?? null)
  }

  async function handleDragEnd(event: DragEndEvent) {
    setActiveTask(null)
    const { active, over } = event
    if (!over || active.id === over.id) return

    const taskId = String(active.id)
    const newStatus = String(over.id)

    // over.id might be a task id or a column id
    const targetColumn = COLUMN_ORDER.includes(newStatus)
      ? newStatus
      : tasks.find(t => t.id === newStatus)?.status.status

    if (!targetColumn) return

    const task = tasks.find(t => t.id === taskId)
    if (!task || task.status.status === targetColumn) return

    // Optimistic update
    setTasks(prev =>
      prev.map(t =>
        t.id === taskId
          ? { ...t, status: { ...t.status, status: targetColumn, color: getStatusColor(targetColumn) } }
          : t
      )
    )

    try {
      const res = await fetch(`/api/clickup/tasks/${taskId}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ status: targetColumn }),
      })
      if (!res.ok) throw new Error('Update failed')
    } catch {
      // Rollback
      setTasks(prev =>
        prev.map(t => (t.id === taskId ? task : t))
      )
      toast.error('Nie udało się zmienić statusu')
    }
  }

  async function handleRefresh() {
    setRefreshing(true)
    const res = await fetch(`/api/clickup/tasks?slug=${slug}`)
    if (res.ok) {
      const data = await res.json()
      setTasks(data.tasks)
    }
    setRefreshing(false)
  }

  function openChat(mode: 'new-task' | 'general') {
    setChatMode(mode)
    setShowChat(true)
  }

  async function handleChatClose() {
    setShowChat(false)
    if (chatMode === 'new-task') {
      await handleRefresh()
    }
  }

  function handleTaskUpdated(updatedTask: ClickUpTask) {
    setTasks(prev => prev.map(t => (t.id === updatedTask.id ? updatedTask : t)))
  }

  return (
    <div className="flex flex-col h-screen bg-background">
      {/* Header */}
      <header className="flex items-center justify-between px-6 py-4 border-b border-border bg-card">
        <div className="flex items-center gap-3">
          <div className="h-8 w-8 rounded-lg bg-primary flex items-center justify-center text-primary-foreground text-sm font-bold">
            {portalName[0]?.toUpperCase()}
          </div>
          <div>
            <h1 className="font-semibold text-foreground">{portalName}</h1>
            <p className="text-xs text-muted-foreground">{userEmail}</p>
          </div>
        </div>

        <div className="flex items-center gap-2">
          <button
            onClick={handleRefresh}
            disabled={refreshing}
            className="inline-flex items-center gap-1.5 text-sm text-muted-foreground hover:text-foreground transition-colors px-2 py-1.5 rounded-md hover:bg-muted disabled:opacity-50"
          >
            <RefreshCw className={`h-4 w-4 ${refreshing ? 'animate-spin' : ''}`} />
            Odśwież
          </button>

          <button
            onClick={() => openChat('general')}
            className="inline-flex items-center gap-1.5 text-sm text-muted-foreground hover:text-foreground transition-colors px-2 py-1.5 rounded-md hover:bg-muted"
          >
            <MessageSquare className="h-4 w-4" />
            AI Chat
          </button>

          <button
            onClick={() => openChat('new-task')}
            className="inline-flex items-center gap-1.5 rounded-md bg-primary px-3 py-1.5 text-sm font-medium text-primary-foreground shadow hover:bg-primary/90 transition-colors"
          >
            <Plus className="h-4 w-4" />
            Nowe zadanie
          </button>
        </div>
      </header>

      {/* Board */}
      <div className="flex-1 overflow-x-auto">
        <div className="flex gap-4 p-6 h-full min-w-max">
          <DndContext
            sensors={sensors}
            collisionDetection={closestCorners}
            onDragStart={handleDragStart}
            onDragEnd={handleDragEnd}
          >
            {columns.map(column => (
              <KanbanColumnComponent
                key={column.id}
                column={column}
                onTaskClick={setSelectedTask}
              />
            ))}

            <DragOverlay>
              {activeTask && (
                <div className="rotate-2 scale-105">
                  <TaskCard task={activeTask} onClick={() => {}} />
                </div>
              )}
            </DragOverlay>
          </DndContext>
        </div>
      </div>

      {/* Task detail drawer */}
      {selectedTask && (
        <TaskDrawer
          task={selectedTask}
          slug={slug}
          userEmail={userEmail}
          onClose={() => setSelectedTask(null)}
          onTaskUpdated={handleTaskUpdated}
        />
      )}

      {/* AI Chat / New task panel */}
      {showChat && (
        <ChatWindow
          slug={slug}
          portalName={portalName}
          userEmail={userEmail}
          mode={chatMode}
          onClose={handleChatClose}
        />
      )}
    </div>
  )
}
