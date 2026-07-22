'use client'
import { useState } from 'react'
import { useSortable } from '@dnd-kit/sortable'
import { CSS } from '@dnd-kit/utilities'
import type { ClickUpTask } from '@/lib/types'
import { formatDate, formatDuration, getPriorityColor, getPriorityLabel, getStatusColor } from '@/lib/utils'
import { Calendar, Clock, Timer, ChevronRight, ListTree } from 'lucide-react'

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
      className="bg-card rounded-lg border border-border p-3 shadow-sm cursor-pointer hover:shadow-md hover:border-primary/30 transition-all group select-none"
    >
      {/* Task name */}
      <p className="text-sm font-medium text-card-foreground line-clamp-2 mb-2">
        {task.name}
      </p>

      {/* Priority tag */}
      {task.priority?.priority && task.priority.priority !== 'normal' && (
        <div className="mb-2">
          <span
            className="inline-flex items-center gap-1 text-[10px] font-semibold px-1.5 py-0.5 rounded"
            style={{ color: priorityColor, backgroundColor: `${priorityColor}18` }}
          >
            {getPriorityLabel(task.priority.priority)}
          </span>
        </div>
      )}

      {/* Footer */}
      <div className="flex items-center justify-between gap-2 mt-2">
        <div className="flex items-center gap-2 flex-wrap">
          {/* Due date */}
          {task.date_due && (
            <span className="flex items-center gap-1 text-xs text-muted-foreground">
              <Calendar className="h-3 w-3" />
              {formatDate(task.date_due)}
            </span>
          )}

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
