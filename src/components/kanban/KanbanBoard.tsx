'use client'
import { useState, useEffect } from 'react'
import {
  DndContext,
  DragEndEvent,
  DragOverlay,
  DragStartEvent,
  KeyboardSensor,
  PointerSensor,
  TouchSensor,
  useSensor,
  useSensors,
  closestCorners,
} from '@dnd-kit/core'
import { useSearchParams } from 'next/navigation'
import type { ClickUpTask, KanbanColumn } from '@/lib/types'
import { getStatusColor, STATUS_COLUMNS, TASK_STATUS_CLOSED } from '@/lib/utils'
import { KanbanColumn as KanbanColumnComponent } from './KanbanColumn'
import { TaskCard } from './TaskCard'
import { TaskDrawer } from './TaskDrawer'
import { NewTaskButton } from './NewTaskButton'
import { RefreshCw } from '@/lib/icons'
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
  statusControlsEnabled: boolean
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

const CLOSED_STATUS = TASK_STATUS_CLOSED
const CLOSED_COLUMN_LIMIT = 5

export function buildColumns(
  tasks: ClickUpTask[],
  closedMoreHref: string | null,
  applyClosedLimit: boolean
): KanbanColumn[] {
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
    // Limit i wlasne sortowanie kolumny "zamkniete" dzialaja WYLACZNIE gdy
    // funkcja jest wlaczona (statusControlsEnabled). Fetch po stronie
    // serwera jest juz za ta brama — bez niej trafiaja tu tylko zadania
    // przeciagniete w tej samej sesji (drag&drop), ktore musza zachowac
    // sprzed-planowe zachowanie: sortByPriority, bez limitu, bez linku.
    const isClosedColumn = status === CLOSED_STATUS && applyClosedLimit
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

export function KanbanBoard({ initialTasks, slug, portalName, userEmail, flags, branding, siteUrl, statusControlsEnabled }: KanbanBoardProps) {
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

  // Link tylko gdy funkcja jest wlaczona ORAZ klient ma dostep do Historii —
  // inaczej prowadziłby na strone, ktora go odesle z powrotem (brama
  // serwerowa w historia/page.tsx), albo pokazywalby link do widoku, ktorego
  // dane nigdy nie zostaly pobrane (fetch jest za ta sama flaga).
  const closedMoreHref = statusControlsEnabled && flags.historyEnabled
    ? `/${slug}/historia?status=${encodeURIComponent(CLOSED_STATUS)}`
    : null

  const columns = buildColumns(tasks, closedMoreHref, statusControlsEnabled)

  const sensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 8 } }),
    useSensor(TouchSensor, { activationConstraint: { delay: 250, tolerance: 5 } }),
    // Przeciąganie z klawiatury (Enter/Spacja łapie kartę, strzałki przenoszą).
    // dnd-kit daje to za darmo, ale sensor trzeba jawnie podłączyć; bez niego
    // karta ma role="button" i tabIndex, a Enter nic nie robił.
    useSensor(KeyboardSensor)
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

    // Optimistic update. Przy przeciagnieciu do "zamknietych" stempluj
    // `date_closed` na TERAZ — sortowanie i limit tej kolumny licza po
    // `date_closed ?? date_updated` (patrz `closedTimestamp`), a
    // `date_updated` zadania bywa stary. Bez tego swiezo zamkniete zadanie
    // moze wypadac pod limit i znikac z widoku do najblizszego odswiezenia.
    setTasks(prev =>
      prev.map(t =>
        t.id === taskId
          ? {
              ...t,
              status: { ...t.status, status: targetColumn, color: getStatusColor(targetColumn) },
              ...(targetColumn === CLOSED_STATUS ? { date_closed: String(Date.now()) } : {}),
            }
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
    try {
      const res = await fetch(`/api/clickup/tasks?slug=${slug}`)
      if (!res.ok) throw new Error(`refresh failed: ${res.status}`)
      const data = await res.json()
      setTasks(data.tasks)
    } catch {
      // Klient kliknął „Odśwież" i kręciło się bez efektu; bez tej informacji
      // porażka wyglądała jak brak nowych zadań.
      toast.error('Nie udało się odświeżyć. Spróbuj ponownie.')
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

  /**
   * Podlaczone do dropdownu statusu w TaskDrawer (Task 7). Aktualizuje DWIE
   * rzeczy, nie jedna: `tasks` (żeby karta wskoczyła do nowej kolumny po
   * zamknieciu szuflady) i `selectedTask` (żeby OTWARTA szuflada natychmiast
   * pokazala nowy status, bez zamykania i otwierania zadania na nowo).
   *
   * `updatedTask` to SUROWE zadanie z ClickUpa, jak je oddaje PATCH. Nie ma
   * `trackedTimeMs` (dopisywane po stronie serwera z osobnej tabeli) ani
   * `children` (budowane po stronie klienta z plaskiej listy) — te pola
   * istnieja WYLACZNIE na zadaniach juz trzymanych w stanie. Podstawienie
   * calego obiektu zgubiloby oba, wiec zamiast zamieniac zadanie, laczymy
   * TYLKO pola zwiazane ze statusem na istniejacej kopii. Funkcja rekurencyjnie
   * schodzi w `children`, bo zadanie moze byc podzadaniem zagniezdzonym w
   * rodzicu (drawer otwiera podzadania tez), a `.map` po samym `tasks` by tego
   * nie znalazl.
   */
  function handleTaskUpdated(updatedTask: ClickUpTask) {
    function patch(t: ClickUpTask): ClickUpTask {
      if (t.id === updatedTask.id) {
        return {
          ...t,
          status: updatedTask.status,
          date_closed: updatedTask.date_closed,
          date_updated: updatedTask.date_updated,
        }
      }
      return t.children ? { ...t, children: t.children.map(patch) } : t
    }
    setTasks(prev => prev.map(patch))
    setSelectedTask(prev => (prev ? patch(prev) : prev))
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
        {/* `items-start`, NIE domyślne rozciąganie: kolumna ma być wysoka na
            tyle, ile ma zadań. Bez tego wszystkie dostają wysokość najwyższej
            i obrys kolumny z czterema kartami ciągnie się w pustkę.
            Bez `h-full` z tego samego powodu — narzucona wysokość nie pozwalała
            kontenerowi urosnąć do treści, więc karty wylewały się POZA obrys
            (zmierzone: 426 px poniżej krawędzi). */}
        <div className="flex items-start gap-4 p-6 min-w-max">
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
                /* Kolumna przylega do zawartości w spoczynku, a rozciąga się
                   dopiero przy przeciąganiu — patrz komentarz w KanbanColumn. */
                dragging={activeTask !== null}
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
          statusControlsEnabled={statusControlsEnabled}
          onTaskUpdated={handleTaskUpdated}
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
