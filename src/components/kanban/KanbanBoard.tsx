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
import { NewTaskButton } from './NewTaskButton'
import { RefreshCw } from 'lucide-react'
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
  /** Strona klienta z konfiguracji projektu; null = brak, wtedy bez menu. */
  siteUrl: string | null
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

export function KanbanBoard({ initialTasks, slug, portalName, userEmail, flags, branding, siteUrl }: KanbanBoardProps) {
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
  const [selectedTask, setSelectedTask] = useState<ClickUpTask | null>(null)
  const [showChat, setShowChat] = useState(false)
  const [chatMode, setChatMode] = useState<'new-task' | 'general'>('general')
  const [refreshing, setRefreshing] = useState(false)

  /**
   * Szuflada otwarta na zadanie wskazane adresem: `/[slug]?task=<id>`.
   *
   * BŁĄD, KTÓRY TU BYŁ, i powód, dla którego to jest efekt, a nie
   * inicjalizator `useState`: inicjalizator wykonuje się WYŁĄCZNIE przy
   * montowaniu komponentu. Klient stojący już na tablicy, który klikał
   * powiadomienie z dzwonka, dostawał nawigację po stronie przeglądarki —
   * adres się zmieniał, komponent NIE montował się ponownie, więc szuflada nie
   * otwierała się wcale. Działało tylko wejście z innej zakładki albo
   * z odświeżenia, czyli akurat nie ta droga, którą chodzi się najczęściej.
   *
   * Reguła `set-state-in-effect` jest tu wyciszona świadomie: to jest
   * synchronizacja stanu ze ŹRÓDŁEM ZEWNĘTRZNYM (adresem), a nie kaskada
   * renderów. Poprzednie podejście unikało ostrzeżenia lintera kosztem
   * działania funkcji.
   */
  useEffect(() => {
    if (!taskFromUrl) return

    const wskazane = findTaskInTree(tasks, taskFromUrl)
    // eslint-disable-next-line react-hooks/set-state-in-effect
    if (wskazane) setSelectedTask(wskazane)

    // Zadanie bywa poza tablicą: zamknięte dawno temu, przeniesione na inną
    // listę albo usunięte. Cisza wyglądałaby jak zepsuty odnośnik, więc
    // mówimy wprost, gdzie go szukać.
    if (!wskazane) {
      toast('Tego zadania nie ma na tablicy. Poszukaj go w Historii.')
    }

    const clean = new URL(window.location.href)
    clean.searchParams.delete('task')
    window.history.replaceState(null, '', clean.toString())
    // `tasks` celowo poza zależnościami: reagujemy na ZMIANĘ ADRESU, a nie na
    // każde odświeżenie tablicy — inaczej szuflada otwierałaby się sama po
    // każdym pobraniu zadań.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [taskFromUrl])

  const columns = buildColumns(tasks, null)

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

        <NewTaskButton siteUrl={siteUrl} onOpenAssistant={() => openChat('new-task')} />
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
