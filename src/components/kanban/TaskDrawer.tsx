'use client'
import { useState, useEffect } from 'react'
import type { ClickUpTask, ClickUpComment, ClickUpAttachment } from '@/lib/types'
import { formatDate, formatDuration, getPriorityColor, getPriorityLabel, getStatusColor } from '@/lib/utils'
import { X, Calendar, MessageSquare, Send, Loader2, CheckSquare, Clock, Timer, ChevronLeft, ChevronRight, Paperclip, FileText, User } from 'lucide-react'
import { toast } from 'sonner'
import { Sheet, SheetContent, SheetTitle } from '@/components/ui/sheet'

// Turn plain URLs into clickable links inside a text run.
function linkify(text: string, kp: string): React.ReactNode[] {
  const urlRe = /(https?:\/\/[^\s]+)/g
  const out: React.ReactNode[] = []
  let last = 0
  let m: RegExpExecArray | null
  let i = 0
  while ((m = urlRe.exec(text)) !== null) {
    if (m.index > last) out.push(text.slice(last, m.index))
    out.push(
      <a key={`${kp}-a${i++}`} href={m[0]} target="_blank" rel="noopener noreferrer" className="text-primary underline break-all">
        {m[0]}
      </a>
    )
    last = m.index + m[0].length
  }
  if (last < text.length) out.push(text.slice(last))
  return out
}

// Inline: **bold** + links.
function renderInline(text: string, kp: string): React.ReactNode[] {
  return text.split('**').flatMap((part, i): React.ReactNode[] =>
    i % 2 === 1
      ? [<strong key={`${kp}-b${i}`}>{linkify(part, `${kp}-b${i}`)}</strong>]
      : linkify(part, `${kp}-t${i}`)
  )
}

// Minimal Markdown renderer for task descriptions: ## / ### headings, - / * bullets,
// **bold**, links, paragraphs. Avoids pulling in a full markdown dependency.
function MarkdownLite({ text }: { text: string }) {
  const lines = text.split('\n')
  const blocks: React.ReactNode[] = []
  let bullets: string[] = []
  const flush = (key: string) => {
    if (bullets.length) {
      const items = bullets
      blocks.push(
        <ul key={key} className="list-disc pl-5 space-y-0.5 my-1.5 text-sm text-foreground">
          {items.map((li, i) => <li key={i}>{renderInline(li, `${key}-${i}`)}</li>)}
        </ul>
      )
      bullets = []
    }
  }
  lines.forEach((line, idx) => {
    const key = `l${idx}`
    if (/^###\s+/.test(line)) {
      flush(`${key}f`)
      blocks.push(<h5 key={key} className="text-xs font-semibold text-foreground mt-2 mb-0.5">{renderInline(line.replace(/^###\s+/, ''), key)}</h5>)
    } else if (/^##\s+/.test(line)) {
      flush(`${key}f`)
      blocks.push(<h4 key={key} className="text-sm font-semibold text-foreground mt-3 mb-1 first:mt-0">{renderInline(line.replace(/^##\s+/, ''), key)}</h4>)
    } else if (/^[-*]\s+/.test(line)) {
      bullets.push(line.replace(/^[-*]\s+/, ''))
    } else if (line.trim() === '') {
      flush(`${key}f`)
    } else {
      flush(`${key}f`)
      blocks.push(<p key={key} className="text-sm text-foreground leading-relaxed my-1">{renderInline(line, key)}</p>)
    }
  })
  flush('end')
  return <div>{blocks}</div>
}

interface TaskDrawerProps {
  task: ClickUpTask
  slug: string
  userEmail: string
  onClose: () => void
  onTaskUpdated: (task: ClickUpTask) => void
  onNavigate?: (taskId: string) => void
}

export function TaskDrawer({ task, slug, userEmail, onClose, onTaskUpdated, onNavigate }: TaskDrawerProps) {
  const [tab] = useState<'details'>('details')
  const [comments, setComments] = useState<ClickUpComment[]>([])
  const [newComment, setNewComment] = useState('')
  const [loadingComments, setLoadingComments] = useState(true)
  const [sendingComment, setSendingComment] = useState(false)
  const [attachments, setAttachments] = useState<ClickUpAttachment[]>([])
  /** Null oznacza „nie wiemy", czyli zadanie założone przez nas. Patrz niżej. */
  const [reporter, setReporter] = useState<{
    name: string | null
    email: string | null
    isAgency: boolean
  } | null>(null)

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
    async function loadAttachments() {
      setAttachments([])
      setReporter(null)
      const res = await fetch(`/api/clickup/tasks/${task.id}?slug=${slug}`)
      if (res.ok) {
        const data = await res.json()
        setAttachments(data.attachments ?? [])
        // Ta sama odpowiedź, bez drugiego zapytania: autor i załączniki
        // pochodzą z jednego zadania.
        setReporter(data.reporter ?? null)
      }
    }
    loadComments()
    loadAttachments()
  }, [task.id, slug])

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
    // Sheet to ten sam Radix Dialog co modale, tylko z animacja wysuwania z
    // boku. Reczna wersja nie obslugiwala Escape, nie lapala fokusa i nie
    // miala aria-modal, a to panel, ktory klient otwiera przy kazdym zadaniu.
    //
    // Cztery nadpisania wzgledem SheetContent, kazde celowe:
    //   bg-card       zamiast bg-background, zeby panel odcinal sie od tla
    //   sm:max-w-lg   zamiast sm:max-w-sm, bo tresc zadania potrzebuje szerokosci
    //   gap-0         bo sekcje maja wlasne odstepy (p-5 + border-b)
    //   showCloseButton={false}  bo naglowek ma juz swoj krzyzyk
    <Sheet open onOpenChange={next => { if (!next) onClose() }}>
      <SheetContent
        side="right"
        showCloseButton={false}
        className="w-full gap-0 border-border bg-card p-0 sm:max-w-lg"
      >
        {/* Radix wymaga tytulu do etykiety okna. Wizualny naglowek nizej ma
            wlasny uklad, wiec tytul dla czytnikow ekranu jest ukryty. */}
        <SheetTitle className="sr-only">{task.name}</SheetTitle>
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
          {/* Back to parent (when viewing a subtask) */}
          {task.parent && onNavigate && (
            <button
              onClick={() => onNavigate(task.parent!)}
              className="flex items-center gap-1 px-5 py-2.5 text-xs text-muted-foreground hover:text-foreground border-b border-border w-full transition-colors"
            >
              <ChevronLeft className="h-3.5 w-3.5" />
              Wróć do zadania nadrzędnego
            </button>
          )}

          {/* Meta info */}
          <div className="px-5 py-4 border-b border-border space-y-3">
            {/* Kiedy i przez kogo zgłoszone. Ten wiersz jest BEZWARUNKOWY i to
                jest jego drugie zadanie: cały blok ma stałe `py-4` i `border-b`,
                więc zadanie bez terminu i bez czasu renderowało tu sam pusty
                pasek między dwiema kreskami. Data utworzenia przychodzi z
                ClickUpa zawsze, więc pusty pasek przestaje być osiągalny.

                Zgłaszający pochodzi z naszej historii, nie z ClickUpa: tam
                autorem każdego zadania jest nasze konto serwisowe. Brak wpisu
                oznacza zadanie założone przez nas, i wtedy podpisujemy się
                jako Important.is. */}
            <div className="flex flex-wrap items-center gap-x-4 gap-y-1 text-sm">
              <div className="flex items-center gap-1.5 text-muted-foreground">
                <Calendar className="h-3.5 w-3.5" />
                <span>Zgłoszone: {formatDate(task.date_created)}</span>
              </div>
              <div className="flex items-center gap-1.5 text-muted-foreground">
                <User className="h-3.5 w-3.5" />
                <span>
                  {reporter && !reporter.isAgency
                    ? (reporter.name ?? reporter.email)
                    : 'Important.is'}
                </span>
              </div>
            </div>

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

            {(task.time_estimate || task.trackedTimeMs) && (
              <div className="flex items-center gap-4 text-sm">
                {task.time_estimate ? (
                  <div className="flex items-center gap-1.5 text-muted-foreground">
                    <Clock className="h-3.5 w-3.5" />
                    <span>Szacowany: {formatDuration(task.time_estimate)}</span>
                  </div>
                ) : null}
                {task.trackedTimeMs ? (
                  <div className="flex items-center gap-1.5 text-primary/80" title="Zamrożone w piątek rano">
                    <Timer className="h-3.5 w-3.5" />
                    <span>Track Time: {formatDuration(task.trackedTimeMs)}</span>
                  </div>
                ) : null}
              </div>
            )}

          </div>

          {/* Description */}
          {task.description && (
            <div className="px-5 py-4 border-b border-border">
              <h3 className="text-xs font-semibold text-muted-foreground uppercase tracking-wide mb-2">
                Opis
              </h3>
              <MarkdownLite text={task.description} />
            </div>
          )}

          {/* Subtasks */}
          {task.children && task.children.length > 0 && (
            <div className="px-5 py-4 border-b border-border">
              <h3 className="text-xs font-semibold text-muted-foreground uppercase tracking-wide mb-3 flex items-center gap-1.5">
                <CheckSquare className="h-3.5 w-3.5" />
                Podzadania ({task.children.length})
              </h3>
              <div className="space-y-1">
                {task.children.map(sub => {
                  const subEstimate = formatDuration(sub.time_estimate)
                  const subTracked = formatDuration(sub.trackedTimeMs)
                  return (
                    <button
                      key={sub.id}
                      type="button"
                      onClick={() => onNavigate?.(sub.id)}
                      disabled={!onNavigate}
                      className="w-full flex items-center gap-2 text-sm text-left rounded-md px-2 py-1.5 -mx-2 hover:bg-muted transition-colors disabled:cursor-default disabled:hover:bg-transparent group/sub"
                    >
                      <div
                        className="h-2 w-2 rounded-full flex-shrink-0"
                        style={{ backgroundColor: getStatusColor(sub.status.status) }}
                      />
                      <span className={`flex-1 min-w-0 truncate ${sub.status.type === 'closed' ? 'line-through text-muted-foreground' : 'text-foreground'}`}>
                        {sub.name}
                      </span>
                      {subEstimate && (
                        <span className="text-xs text-muted-foreground flex items-center gap-0.5 flex-shrink-0">
                          <Clock className="h-3 w-3" />{subEstimate}
                        </span>
                      )}
                      {subTracked && (
                        <span className="text-xs text-primary/80 flex items-center gap-0.5 flex-shrink-0">
                          <Timer className="h-3 w-3" />{subTracked}
                        </span>
                      )}
                      {sub.date_due && (
                        <span className="text-xs text-muted-foreground flex-shrink-0">{formatDate(sub.date_due)}</span>
                      )}
                      {onNavigate && <ChevronRight className="h-3.5 w-3.5 text-muted-foreground flex-shrink-0" />}
                    </button>
                  )
                })}
              </div>
            </div>
          )}

          {/* Attachments */}
          {attachments.length > 0 && (
            <div className="px-5 py-4 border-b border-border">
              <h3 className="text-xs font-semibold text-muted-foreground uppercase tracking-wide mb-3 flex items-center gap-1.5">
                <Paperclip className="h-3.5 w-3.5" />
                Załączniki ({attachments.length})
              </h3>
              <div className="flex flex-wrap gap-2">
                {attachments.map(a => {
                  const thumb = a.thumbnail_large || a.thumbnail_small
                  return thumb ? (
                    <a
                      key={a.id}
                      href={a.url}
                      target="_blank"
                      rel="noopener noreferrer"
                      title={a.title}
                      className="block overflow-hidden border border-border hover:opacity-90 transition-opacity"
                      style={{ height: 80, width: 80, borderRadius: 8 }}
                    >
                      {/* eslint-disable-next-line @next/next/no-img-element */}
                      <img src={thumb} alt={a.title} style={{ height: 80, width: 80, objectFit: 'cover', display: 'block' }} />
                    </a>
                  ) : (
                    <a
                      key={a.id}
                      href={a.url}
                      target="_blank"
                      rel="noopener noreferrer"
                      title={a.title}
                      className="flex items-center gap-1.5 text-xs text-primary underline px-2 py-1.5 rounded-md border border-border hover:bg-muted"
                    >
                      <FileText className="h-3.5 w-3.5 flex-shrink-0" />
                      <span className="truncate max-w-[140px]">{a.title}</span>
                    </a>
                  )
                })}
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
      </SheetContent>
    </Sheet>
  )
}
