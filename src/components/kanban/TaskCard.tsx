'use client'
import { useSortable } from '@dnd-kit/sortable'
import { CSS } from '@dnd-kit/utilities'
import type { ClickUpTask } from '@/lib/types'
import { formatDate, getPriorityColor, getPriorityLabel } from '@/lib/utils'
import { Calendar, MessageSquare } from 'lucide-react'

interface TaskCardProps {
  task: ClickUpTask
  onClick: (task: ClickUpTask) => void
}

export function TaskCard({ task, onClick }: TaskCardProps) {
  const { attributes, listeners, setNodeRef, transform, transition, isDragging } = useSortable({
    id: task.id,
  })

  const style = {
    transform: CSS.Transform.toString(transform),
    transition,
    opacity: isDragging ? 0.5 : 1,
  }

  const priorityColor = getPriorityColor(task.priority?.priority)

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
        <div className="flex items-center gap-2">
          {/* Due date */}
          {task.date_due && (
            <span className="flex items-center gap-1 text-xs text-muted-foreground">
              <Calendar className="h-3 w-3" />
              {formatDate(task.date_due)}
            </span>
          )}
        </div>

        {task.subtasks && task.subtasks.length > 0 && (
          <span className="flex items-center gap-0.5 text-xs text-muted-foreground">
            <MessageSquare className="h-3 w-3" />
            {task.subtasks.length}
          </span>
        )}
      </div>
    </div>
  )
}
