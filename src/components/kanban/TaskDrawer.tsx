'use client'
import { useState, useEffect } from 'react'
import type { ClickUpTask, ClickUpComment } from '@/lib/types'
import { formatDate, getPriorityColor, getPriorityLabel, getStatusColor } from '@/lib/utils'
import { X, Calendar, MessageSquare, Send, Loader2, CheckSquare } from 'lucide-react'
import { toast } from 'sonner'

interface TaskDrawerProps {
  task: ClickUpTask
  slug: string
  userEmail: string
  onClose: () => void
  onTaskUpdated: (task: ClickUpTask) => void
}

export function TaskDrawer({ task, slug, userEmail, onClose, onTaskUpdated }: TaskDrawerProps) {
  const [tab] = useState<'details'>('details')
  const [comments, setComments] = useState<ClickUpComment[]>([])
  const [newComment, setNewComment] = useState('')
  const [loadingComments, setLoadingComments] = useState(true)
  const [sendingComment, setSendingComment] = useState(false)

  useEffect(() => {
    async function loadComments() {
      setLoadingComments(true)
      const res = await fetch(`/api/clickup/tasks/${task.id}/comments`)
      if (res.ok) {
        const data = await res.json()
        setComments(data.comments ?? [])
      }
      setLoadingComments(false)
    }
    loadComments()
  }, [task.id])

  async function handleSendComment(e: React.FormEvent) {
    e.preventDefault()
    if (!newComment.trim()) return

    setSendingComment(true)
    const res = await fetch(`/api/clickup/tasks/${task.id}/comments`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ text: newComment }),
    })

    if (res.ok) {
      const data = await res.json()
      if (data.comment) setComments(prev => [...prev, data.comment])
      setNewComment('')
    } else {
      toast.error('Nie udało się wysłać komentarza')
    }
    setSendingComment(false)
  }

  const priorityColor = getPriorityColor(task.priority?.priority)
  const statusColor = getStatusColor(task.status.status)

  return (
    <>
      {/* Backdrop */}
      <div
        className="fixed inset-0 bg-black/30 backdrop-blur-sm z-40"
        onClick={onClose}
      />

      {/* Drawer */}
      <div className="fixed right-0 top-0 h-full w-full max-w-lg bg-card border-l border-border shadow-2xl z-50 flex flex-col">
        {/* Header */}
        <div className="flex items-start justify-between p-5 border-b border-border gap-3">
          <div className="flex-1 min-w-0">
            <div className="flex items-center gap-2 mb-2 flex-wrap">
              {/* Status badge */}
              <span
                className="inline-flex items-center rounded-full px-2 py-0.5 text-xs font-medium text-white"
                style={{ backgroundColor: statusColor }}
              >
                {task.status.status}
              </span>

              {/* Priority badge */}
              {task.priority && (
                <span
                  className="inline-flex items-center rounded-full px-2 py-0.5 text-xs font-medium"
                  style={{ backgroundColor: priorityColor + '20', color: priorityColor }}
                >
                  {getPriorityLabel(task.priority.priority)}
                </span>
              )}

              {/* List tag */}
              <span className="text-xs text-muted-foreground bg-muted px-2 py-0.5 rounded-full">
                {task.list.name}
              </span>
            </div>

            <h2 className="font-semibold text-foreground text-base leading-tight">
              {task.name}
            </h2>
          </div>

          <div className="flex items-center gap-1 flex-shrink-0">
            <button
              onClick={onClose}
              className="p-1.5 rounded-md hover:bg-muted text-muted-foreground hover:text-foreground transition-colors"
            >
              <X className="h-4 w-4" />
            </button>
          </div>
        </div>

        {/* Details */}
        {tab === 'details' && <div className="flex-1 overflow-y-auto">
          {/* Meta info */}
          <div className="px-5 py-4 border-b border-border space-y-3">
            {(task.date_due || task.date_start) && (
              <div className="flex items-center gap-4 text-sm">
                {task.date_start && (
                  <div className="flex items-center gap-1.5 text-muted-foreground">
                    <Calendar className="h-3.5 w-3.5" />
                    <span>Start: {formatDate(task.date_start)}</span>
                  </div>
                )}
                {task.date_due && (
                  <div className="flex items-center gap-1.5 text-muted-foreground">
                    <Calendar className="h-3.5 w-3.5" />
                    <span>Termin: {formatDate(task.date_due)}</span>
                  </div>
                )}
              </div>
            )}

            {task.assignees?.length > 0 && (
              <div className="flex items-center gap-2">
                <span className="text-xs text-muted-foreground">Przypisano:</span>
                <div className="flex items-center gap-1.5">
                  {task.assignees.map(a => (
                    <div key={a.id} className="flex items-center gap-1">
                      <div
                        className="h-5 w-5 rounded-full flex items-center justify-center text-white text-[9px] font-bold"
                        style={{ backgroundColor: a.color ?? '#888' }}
                      >
                        {a.initials?.slice(0, 2) ?? a.username?.slice(0, 2).toUpperCase()}
                      </div>
                      <span className="text-xs text-muted-foreground">{a.username}</span>
                    </div>
                  ))}
                </div>
              </div>
            )}
          </div>

          {/* Description */}
          {task.description && (
            <div className="px-5 py-4 border-b border-border">
              <h3 className="text-xs font-semibold text-muted-foreground uppercase tracking-wide mb-2">
                Opis
              </h3>
              <p className="text-sm text-foreground whitespace-pre-wrap leading-relaxed">
                {task.description}
              </p>
            </div>
          )}

          {/* Subtasks */}
          {task.subtasks && task.subtasks.length > 0 && (
            <div className="px-5 py-4 border-b border-border">
              <h3 className="text-xs font-semibold text-muted-foreground uppercase tracking-wide mb-3 flex items-center gap-1.5">
                <CheckSquare className="h-3.5 w-3.5" />
                Podzadania ({task.subtasks.length})
              </h3>
              <div className="space-y-1.5">
                {task.subtasks.map(sub => (
                  <div key={sub.id} className="flex items-center gap-2 text-sm">
                    <div
                      className="h-2 w-2 rounded-full flex-shrink-0"
                      style={{ backgroundColor: getStatusColor(sub.status.status) }}
                    />
                    <span className={`flex-1 ${sub.status.type === 'closed' ? 'line-through text-muted-foreground' : 'text-foreground'}`}>
                      {sub.name}
                    </span>
                    {sub.date_due && (
                      <span className="text-xs text-muted-foreground">{formatDate(sub.date_due)}</span>
                    )}
                  </div>
                ))}
              </div>
            </div>
          )}

          {/* Comments */}
          <div className="px-5 py-4">
            <h3 className="text-xs font-semibold text-muted-foreground uppercase tracking-wide mb-3 flex items-center gap-1.5">
              <MessageSquare className="h-3.5 w-3.5" />
              Komentarze {comments.length > 0 && `(${comments.length})`}
            </h3>

            {loadingComments ? (
              <div className="flex items-center gap-2 text-sm text-muted-foreground py-4">
                <Loader2 className="h-4 w-4 animate-spin" />
                Ładowanie...
              </div>
            ) : comments.length === 0 ? (
              <p className="text-sm text-muted-foreground py-2">Brak komentarzy</p>
            ) : (
              <div className="space-y-4">
                {comments.map(comment => {
                  const isAgency = comment.sender === 'Important.is'
                  const initials = isAgency ? 'IM' : (comment.sender?.slice(0, 2).toUpperCase() ?? '?')
                  const bgColor = isAgency ? '#3b6fe8' : '#6b7280'
                  return (
                    <div key={comment.id} className="flex gap-3">
                      <div
                        className="h-7 w-7 rounded-full flex items-center justify-center text-white text-xs font-bold flex-shrink-0"
                        style={{ backgroundColor: bgColor }}
                      >
                        {initials}
                      </div>
                      <div className="flex-1">
                        <div className="flex items-baseline gap-2 mb-1">
                          <span className="text-xs font-medium text-foreground">
                            {comment.sender ?? 'Nieznany'}
                          </span>
                          <span className="text-xs text-muted-foreground">
                            {formatDate(comment.date)}
                          </span>
                        </div>
                        <p className="text-sm text-foreground whitespace-pre-wrap">
                          {comment.comment_text}
                        </p>
                      </div>
                    </div>
                  )
                })}
              </div>
            )}
          </div>
        </div>}

        {/* Comment input — only on details tab */}
        {tab === 'details' && <div className="p-4 border-t border-border bg-card">
          <form onSubmit={handleSendComment} className="flex gap-2">
            <input
              type="text"
              value={newComment}
              onChange={e => setNewComment(e.target.value)}
              placeholder="Dodaj komentarz..."
              className="flex-1 h-9 rounded-md border border-input bg-background px-3 py-1 text-sm placeholder:text-muted-foreground focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring"
            />
            <button
              type="submit"
              disabled={sendingComment || !newComment.trim()}
              className="inline-flex items-center justify-center rounded-md bg-primary px-3 py-1.5 text-sm font-medium text-primary-foreground shadow hover:bg-primary/90 disabled:opacity-50 disabled:pointer-events-none h-9 w-9"
            >
              {sendingComment ? (
                <Loader2 className="h-4 w-4 animate-spin" />
              ) : (
                <Send className="h-4 w-4" />
              )}
            </button>
          </form>
        </div>}
      </div>
    </>
  )
}
