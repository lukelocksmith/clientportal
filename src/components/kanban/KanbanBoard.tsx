'use client'
import { useState, useEffect, useCallback, useOptimistic } from 'react'
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
import { useSearchParams } from 'next/navigation'
import type { ClickUpTask, KanbanColumn } from '@/lib/types'
import { getStatusColor, STATUS_COLUMNS } from '@/lib/utils'
import { KanbanColumn as KanbanColumnComponent } from './KanbanColumn'
import { TaskCard } from './TaskCard'
import { TaskDrawer } from './TaskDrawer'
import { Plus, RefreshCw } from 'lucide-react'
import { toast } from 'sonner'
import { ChatWindow } from '@/components/chat/ChatWindow'
import { PanicButton } from '@/components/PanicButton'
import { PortalHeader } from '@/components/PortalHeader'
import type { PortalFlags } from '@/lib/portalTabs'
import type { PortalBranding } from '@/lib/branding'

// Space-level statuses — consistent across all client lists.
// Definicja siedzi w lib/utils.ts, razem z kolorami statusów, żeby te dwie
// rzeczy nie mogły się rozjechać. Nie duplikuj tej listy tutaj.
const COLUMN_ORDER: readonly string[] = STATUS_COLUMNS

interface KanbanBoardProps {
  initialTasks: ClickUpTask[]
  slug: string
  portalName: string
  userEmail: string
  flags: PortalFlags
  branding: PortalBranding
}

const PRIORITY_ORDER: Record<string, number> = { urgent: 1, high: 2, normal: 3, low: 4 }

function sortByPriority(tasks: ClickUpTask[]): ClickUpTask[] {
  return [...tasks].sort((a, b) => {
    const pa = a.priority ? (PRIORITY_ORDER[a.priority.priority] ?? 5) : 5
    const pb = b.priority ? (PRIORITY_ORDER[b.priority.priority] ?? 5) : 5
    return pa - pb
  })
}

// Depth-first lookup so the drawer can drill into a subtask (or back to its parent) by id.
function findTaskInTree(tasks: ClickUpTask[], id: string): ClickUpTask | null {
  for (const t of tasks) {
    if (t.id === id) return t
    if (t.children) {
      const found = findTaskInTree(t.children, id)
      if (found) return found
    }
  }
  return null
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

export function KanbanBoard({ initialTasks, slug, portalName, userEmail, flags, branding }: KanbanBoardProps) {
  /**
   * Zadanie wskazane adresem: `/[slug]?task=<id>`.
   *
   * Tego brakowało, przez co powiadomienie z dzwonka prowadziło na tablicę i
   * zostawiało klienta z pytaniem „to które to zadanie". Ten sam adres nadaje
   * się do wysłania komuś linkiem.
   */
  const searchParams = useSearchParams()
  const taskFromUrl = searchParams.get('task')

  const [tasks, setTasks] = useState<ClickUpTask[]>(initialTasks)
  const [activeTask, setActiveTask] = useState<ClickUpTask | null>(null)
  /**
   * Szuflada otwarta od razu, gdy adres wskazuje zadanie.
   *
   * Wyliczone w inicjalizatorze `useState`, a NIE w efekcie: ustawienie stanu
   * w efekcie wywołuje dodatkowy render i jest wyłapywane przez lintera jako
   * kaskada. Tutaj i tak chcemy zareagować dokładnie raz, przy montowaniu,
   * więc inicjalizator jest właściwym miejscem, nie obejściem.
   */
  const [selectedTask, setSelectedTask] = useState<ClickUpTask | null>(() =>
    taskFromUrl ? findTaskInTree(initialTasks, taskFromUrl) : null
  )
  const [showChat, setShowChat] = useState(false)
  const [chatMode, setChatMode] = useState<'new-task' | 'general'>('general')
  const [refreshing, setRefreshing] = useState(false)

  /**
   * Sprzątanie po adresie z `?task=`. Bez ustawiania stanu: szuflada została
   * już otwarta w inicjalizatorze wyżej.
   *
   * Parametr zdejmujemy z adresu (`replaceState`, bez wpisu w historii), żeby
   * zamknięcie szuflady i przycisk wstecz nie otwierały jej w kółko.
   */
  useEffect(() => {
    if (!taskFromUrl) return

    // Zadanie bywa poza tablicą: zamknięte dawno temu, przeniesione na inną
    // listę albo usunięte. Cisza wyglądałaby jak zepsuty odnośnik, więc
    // mówimy wprost, gdzie go szukać.
    if (!findTaskInTree(initialTasks, taskFromUrl)) {
      toast('Tego zadania nie ma na tablicy. Poszukaj go w Historii.')
    }

    const clean = new URL(window.location.href)
    clean.searchParams.delete('task')
    window.history.replaceState(null, '', clean.toString())
    // `initialTasks` celowo poza zależnościami: reagujemy RAZ, na adres.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [taskFromUrl])

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
      const res = await fetch(`/api/clickup/tasks/${taskId}?slug=${slug}`, {
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
      <PortalHeader
        slug={slug}
        portalName={portalName}
        userEmail={userEmail}
        flags={flags}
        branding={branding}
      >
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
          onClose={() => setSelectedTask(null)}
          onNavigate={(id) => {
            const t = findTaskInTree(tasks, id)
            if (t) setSelectedTask(t)
          }}
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
