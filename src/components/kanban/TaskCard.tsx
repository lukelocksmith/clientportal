'use client'
import { useState } from 'react'
import { useSortable } from '@dnd-kit/sortable'
import { CSS } from '@dnd-kit/utilities'
import type { ClickUpTask } from '@/lib/types'
import { formatDate, formatDuration, getPriorityColor, getPriorityCode, getStatusColor, isAwaria } from '@/lib/utils'
import { Calendar, Clock, Timer, ChevronRight, ListTree, AlertTriangle } from 'lucide-react'

interface TaskCardProps {
  task: ClickUpTask
  onClick: (task: ClickUpTask) => void
}

export function TaskCard({ task, onClick }: TaskCardProps) {
  const { attributes, listeners, setNodeRef, transform, transition, isDragging } = useSortable({
    id: task.id,
  })

  const [expanded, setExpanded] = useState(true) // subtasks expanded by default (like ClickUp)

  const style = {
    transform: CSS.Transform.toString(transform),
    transition,
    opacity: isDragging ? 0.5 : 1,
  }

  const priorityColor = getPriorityColor(task.priority?.priority)
  const awaria = isAwaria(task.tags)
  const children = task.children ?? []
  const estimate = formatDuration(task.time_estimate)
  const tracked = formatDuration(task.trackedTimeMs)

  return (
    <div
      ref={setNodeRef}
      style={style}
      {...attributes}
      {...listeners}
      onClick={() => onClick(task)}
      /* Karta PŁASKA, bez cienia. Przy dwudziestu kartach na ekranie cień z
         każdej z nich sumuje się w szary szum i zabiera wrażenie porządku;
         sam obrys wystarcza, żeby oddzielić kartę od tła kolumny. Podniesienie
         zostawiamy na przeciąganie, gdzie faktycznie znaczy „ta karta jest w
         powietrzu". */
      className="bg-card rounded-lg border border-border px-3 py-2.5 cursor-pointer hover:border-foreground/20 hover:bg-accent/40 transition-colors group select-none"
    >
      {/* Task name */}
      <p className="text-sm font-medium leading-snug text-card-foreground line-clamp-2">
        {task.name}
      </p>

      {/* Priorytet rysujemy ZAWSZE, także „Normalny".
          Wcześniej `normal` był pomijany jako „domyślny", ale odkąd poziom jest
          uzgadniany z klientem w czacie i wiąże czas reakcji, brak plakietki
          czytał się jako zadanie bez nadanego poziomu.

          Awaria stoi OBOK priorytetu, nie zamiast niego: nie jest wartością
          pola priority, tylko tagiem, więc zgłoszenie awaryjne ma jedno i
          drugie. */}
      {(task.priority?.priority || awaria || task.date_due) && (
        <div className="mt-1.5 flex flex-wrap items-center gap-1.5">
          {/* ALARM zostaje wypełniony kolorem. To jedyna plakietka, która ma
              krzyczeć: awaria jest wyjątkiem, a nie jednym z czterech
              poziomów, które klient widzi na każdej karcie. */}
          {awaria && (
            <span className="inline-flex items-center gap-1 rounded bg-destructive/15 px-1.5 py-0.5 text-[10px] font-semibold text-destructive">
              <AlertTriangle className="h-3 w-3" aria-hidden />
              Alarm
            </span>
          )}
          {/* PRIORYTET jako kropka i tekst, bez wypełnionego tła.
              Plakietka z kolorowym tłem na KAŻDEJ karcie (priorytet rysujemy
              zawsze, patrz komentarz wyżej) dawała ścianę kolorowych prostokątów,
              w której czerwony „Pilny" przestawał się wyróżniać — czyli kolor
              tracił dokładnie tę funkcję, dla której go użyto. Kropka niesie ten
              sam sygnał przy kilkunastu razy mniejszej powierzchni koloru. */}
          {task.priority?.priority && (
            <span className="inline-flex items-center gap-1.5 rounded-md border border-border px-1.5 py-0.5 text-[11px] font-medium text-muted-foreground">
              <span
                className="h-1.5 w-1.5 rounded-full"
                style={{ backgroundColor: priorityColor }}
                aria-hidden
              />
              {getPriorityCode(task.priority.priority)}
            </span>
          )}

          {/* TERMIN tylko wtedy, gdy jest — zadania bez daty to u nas
              większość, więc pusta ikona kalendarza na każdej karcie byłaby
              szumem. Stoi w tym samym wierszu co priorytet, bo oba są
              plakietkami tej samej rangi (uwaga Łukasza 25.08). */}
          {task.date_due && (
            <span className="inline-flex items-center gap-1 rounded-md border border-border px-1.5 py-0.5 text-[11px] font-medium text-muted-foreground">
              <Calendar className="h-3 w-3" aria-hidden />
              {formatDate(task.date_due)}
            </span>
          )}
        </div>
      )}

      {/* Footer */}
      <div className="flex items-center justify-between gap-2 mt-2">
        <div className="flex items-center gap-2 flex-wrap">
          {/* Termin przeniesiony WYŻEJ, do wiersza plakietek — tutaj byłby drugi
              raz. */}

          {/* Estimated time */}
          {estimate && (
            <span className="flex items-center gap-1 text-xs text-muted-foreground" title="Szacowany czas">
              <Clock className="h-3 w-3" />
              {estimate}
            </span>
          )}

          {/* Weekly tracked time (Track Time) */}
          {tracked && (
            <span className="flex items-center gap-1 text-xs text-primary/80" title="Track Time (tygodniowy)">
              <Timer className="h-3 w-3" />
              {tracked}
            </span>
          )}
        </div>

        {/* Subtasks toggle */}
        {children.length > 0 && (
          <button
            type="button"
            onClick={(e) => {
              e.stopPropagation()
              setExpanded(v => !v)
            }}
            className="flex items-center gap-0.5 text-xs text-muted-foreground hover:text-foreground transition-colors"
            aria-expanded={expanded}
            aria-label={expanded ? 'Zwiń podzadania' : 'Rozwiń podzadania'}
          >
            <ChevronRight className={`h-3.5 w-3.5 transition-transform ${expanded ? 'rotate-90' : ''}`} />
            <ListTree className="h-3 w-3" />
            {children.length}
          </button>
        )}
      </div>

      {/* Nested subtasks (expandable, ClickUp-style) */}
      {expanded && children.length > 0 && (
        <div
          className="mt-2 pt-2 border-t border-border/60 space-y-1"
          onClick={(e) => e.stopPropagation()}
        >
          {children.map(sub => {
            const subEstimate = formatDuration(sub.time_estimate)
            return (
              <button
                key={sub.id}
                type="button"
                onClick={(e) => {
                  e.stopPropagation()
                  onClick(sub)
                }}
                className="w-full flex items-center gap-2 text-left rounded px-1.5 py-1 hover:bg-muted transition-colors"
              >
                <span
                  className="h-2 w-2 rounded-full flex-shrink-0"
                  style={{ backgroundColor: getStatusColor(sub.status.status) }}
                />
                <span
                  className={`flex-1 text-xs truncate ${sub.status.type === 'closed' ? 'line-through text-muted-foreground' : 'text-foreground'}`}
                >
                  {sub.name}
                </span>
                {subEstimate && (
                  <span className="text-[10px] text-muted-foreground flex-shrink-0">{subEstimate}</span>
                )}
              </button>
            )
          })}
        </div>
      )}
    </div>
  )
}
