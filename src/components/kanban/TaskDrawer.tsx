'use client'
import { useState, useEffect, useRef } from 'react'
import type { ClickUpTask, ClickUpComment, ClickUpAttachment } from '@/lib/types'
import { formatDate, formatDuration, getPriorityColor, getPriorityLabel, getStatusColor, isAwaria, STATUS_COLUMNS } from '@/lib/utils'
import { X, Calendar, MessageSquare, Send, Loader2, CheckSquare, Clock, Timer, ChevronLeft, ChevronRight, ChevronDown, Paperclip, FileText, User, AlertTriangle, Pencil, Trash2 } from 'lucide-react'
import { toast } from 'sonner'
import { Sheet, SheetContent, SheetTitle } from '@/components/ui/sheet'
import { Textarea } from '@/components/ui/textarea'
import {
  DropdownMenu,
  DropdownMenuTrigger,
  DropdownMenuContent,
  DropdownMenuItem,
} from '@/components/ui/dropdown-menu'
import { MarkdownLite } from './MarkdownLite'
import { useImageAttachments } from '@/components/shared/useImageAttachments'

interface TaskDrawerProps {
  task: ClickUpTask
  slug: string
  onClose: () => void
  onNavigate?: (taskId: string) => void
  /** Za flaga portalu `statusControlsEnabled`. Bez niej: plakietka statusu jak dotychczas, bez interakcji. */
  statusControlsEnabled?: boolean
  /** Wywolywane PO potwierdzonej przez serwer zmianie statusu — task niesie SWIEZY stan z ClickUpa. */
  onTaskUpdated?: (task: ClickUpTask) => void
}

export function TaskDrawer({ task, slug, onClose, onNavigate, statusControlsEnabled = false, onTaskUpdated }: TaskDrawerProps) {
  const [tab] = useState<'details'>('details')
  const [comments, setComments] = useState<ClickUpComment[]>([])
  /** Kotwica na końcu listy komentarzy, do przewinięcia po wysłaniu. */
  const commentsEndRef = useRef<HTMLDivElement>(null)
  const [newComment, setNewComment] = useState('')
  const [loadingComments, setLoadingComments] = useState(true)
  const [sendingComment, setSendingComment] = useState(false)
  const [editingCommentId, setEditingCommentId] = useState<string | null>(null)
  const [editText, setEditText] = useState('')
  const [savingEdit, setSavingEdit] = useState(false)
  /** Obrazy wybrane/wklejone, jeszcze nie wyslane razem z komentarzem. */
  const { pending: pendingFiles, addFiles, removeFile, clearFiles, fileInputRef, handlePaste: handleImagePaste } = useImageAttachments()
  const [attachments, setAttachments] = useState<ClickUpAttachment[]>([])
  /** Null oznacza „nie wiemy", czyli zadanie założone przez nas. Patrz niżej. */
  const [reporter, setReporter] = useState<{
    name: string | null
    email: string | null
    isAgency: boolean
  } | null>(null)
  const [changingStatus, setChangingStatus] = useState(false)
  /** Rozróżnia „brak komentarzy" od „nie udało się pobrać": pierwsze to stan świata, drugie to awaria. */
  const [commentsError, setCommentsError] = useState(false)
  /** Zmiana wartości wymusza ponowne pobranie (przycisk retry przy błędzie). */
  const [refreshKey, setRefreshKey] = useState(0)

  useEffect(() => {
    async function loadComments() {
      setLoadingComments(true)
      setCommentsError(false)
      try {
        const res = await fetch(
          `/api/clickup/tasks/${task.id}/comments?slug=${encodeURIComponent(slug)}`
        )
        if (!res.ok) throw new Error(`comments fetch failed: ${res.status}`)
        const data = await res.json()
        setComments(data.comments ?? [])
      } catch {
        setComments([])
        setCommentsError(true)
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
  }, [task.id, slug, refreshKey])

  async function handleSendComment(e: React.FormEvent) {
    e.preventDefault()
    const hasText = newComment.trim().length > 0
    const hasFiles = pendingFiles.length > 0
    if (!hasText && !hasFiles) return

    setSendingComment(true)

    // Obrazy leca NAJPIERW jako zalaczniki zadania (ten sam mechanizm co
    // zrzuty w AI Czacie), a ich adresy dopisujemy do tresci komentarza —
    // ClickUp nie ma osobnego "zalacznika do komentarza", wiec link jest
    // jedynym sposobem, zeby zdjecie bylo widoczne PRZY konkretnej wiadomosci,
    // a nie tylko w ogolnej liscie Zalacznikow zadania.
    let attachmentUrls: string[] = []
    if (hasFiles) {
      const form = new FormData()
      pendingFiles.forEach(p => form.append('files', p.file))
      const upRes = await fetch(
        `/api/clickup/tasks/${task.id}/attachments?slug=${encodeURIComponent(slug)}`,
        { method: 'POST', body: form }
      )
      if (upRes.ok) {
        const data = await upRes.json()
        const results = (data.attachments ?? []) as Array<{ ok: boolean; url?: string }>
        attachmentUrls = results.filter((r): r is { ok: true; url: string } => r.ok && !!r.url).map(r => r.url)
        const failedCount = results.length - attachmentUrls.length
        if (failedCount > 0) {
          toast.error(`Nie udało się dołączyć ${failedCount} ${failedCount === 1 ? 'obrazu' : 'obrazów'}`)
        }
      } else {
        toast.error('Nie udało się dołączyć obrazów')
      }
    }

    const text = [newComment.trim(), ...attachmentUrls].filter(Boolean).join('\n')
    if (!text) {
      // Wszystkie zalaczniki padly, a tresci nie bylo — nie ma czego wysylac.
      setSendingComment(false)
      return
    }

    // `slug` obowiązkowo, tak samo jak przy odczycie: bez niego trasa nie zna
    // projektu, a obejście admina w `getSession` działa tylko dla nazwanego
    // portalu. Brak sluga oznaczał pusty wątek komentarzy w podglądzie admina.
    const res = await fetch(`/api/clickup/tasks/${task.id}/comments?slug=${encodeURIComponent(slug)}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ text }),
    })

    if (res.ok) {
      const data = await res.json()
      // Dopisujemy na KONIEC, bo lista idzie od najstarszego (sortOldestFirst
      // po stronie trasy). Wcześniej trasa oddawała kolejność ClickUpa, czyli
      // od najnowszego, i ten sam `[...prev, x]` wrzucał świeży komentarz pod
      // najstarszy. Te dwie rzeczy muszą się zgadzać, inaczej wątek kłamie.
      if (data.comment) setComments(prev => [...prev, data.comment])
      setNewComment('')
      clearFiles()
      // Nowy komentarz jest teraz na dole, więc przy dłuższym wątku powstaje
      // poza ekranem. Bez tego wysłanie wygląda, jakby nic się nie stało.
      requestAnimationFrame(() => {
        commentsEndRef.current?.scrollIntoView({ behavior: 'smooth', block: 'end' })
      })
    } else {
      toast.error('Nie udało się wysłać komentarza')
    }
    setSendingComment(false)
  }

  // Enter wysyła komentarz, Shift+Enter dodaje nową linię — standard znany
  // z komunikatorów (stąd zgłoszenie klienta, który próbował Shift+Enter
  // i dostał wysłaną, urwaną wiadomość zamiast akapitu).
  function handleCommentKeyDown(e: React.KeyboardEvent<HTMLTextAreaElement>) {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault()
      e.currentTarget.form?.requestSubmit()
    }
  }

  function startEdit(comment: ClickUpComment) {
    setEditingCommentId(comment.id)
    setEditText(comment.comment_text)
  }

  function cancelEdit() {
    setEditingCommentId(null)
    setEditText('')
  }

  async function handleSaveEdit(commentId: string) {
    if (!editText.trim()) return
    setSavingEdit(true)
    const res = await fetch(
      `/api/clickup/tasks/${task.id}/comments/${commentId}?slug=${encodeURIComponent(slug)}`,
      {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ text: editText }),
      }
    )
    if (res.ok) {
      const savedText = editText
      setComments(prev => prev.map(c => (c.id === commentId ? { ...c, comment_text: savedText } : c)))
      cancelEdit()
    } else {
      toast.error('Nie udało się zapisać komentarza')
    }
    setSavingEdit(false)
  }

  function handleEditKeyDown(e: React.KeyboardEvent<HTMLTextAreaElement>, commentId: string) {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault()
      handleSaveEdit(commentId)
    } else if (e.key === 'Escape') {
      cancelEdit()
    }
  }

  async function handleDeleteComment(commentId: string) {
    if (!confirm('Na pewno usunąć ten komentarz?')) return
    const res = await fetch(
      `/api/clickup/tasks/${task.id}/comments/${commentId}?slug=${encodeURIComponent(slug)}`,
      { method: 'DELETE' }
    )
    if (res.ok) {
      setComments(prev => prev.filter(c => c.id !== commentId))
    } else {
      toast.error('Nie udało się usunąć komentarza')
    }
  }

  /**
   * Ten sam PATCH, ktorego dzis wola przeciagniecie karty (KanbanBoard.tsx).
   * SWIADOMIE bez optymistycznej zmiany widoku: plakietka pokazuje nowy
   * status wylacznie PO potwierdzeniu przez serwer, wiec nigdy nie pokazuje
   * stanu, ktory sie nie zapisal.
   */
  async function handleStatusChange(newStatus: string) {
    if (newStatus === task.status.status || changingStatus) return

    setChangingStatus(true)
    try {
      const res = await fetch(`/api/clickup/tasks/${task.id}?slug=${encodeURIComponent(slug)}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ status: newStatus }),
      })
      if (!res.ok) throw new Error('Update failed')
      const data = await res.json()
      onTaskUpdated?.(data.task)
    } catch {
      toast.error('Nie udało się zmienić statusu')
    } finally {
      setChangingStatus(false)
    }
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
              {/* Status: dropdown za flaga, inaczej plakietka jak dotychczas. */}
              {statusControlsEnabled ? (
                <DropdownMenu>
                  <DropdownMenuTrigger asChild>
                    <button
                      type="button"
                      disabled={changingStatus}
                      className="inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-xs font-medium text-white disabled:opacity-60"
                      style={{ backgroundColor: statusColor }}
                    >
                      {task.status.status}
                      <ChevronDown className="h-3 w-3 opacity-80" aria-hidden />
                    </button>
                  </DropdownMenuTrigger>
                  <DropdownMenuContent align="start">
                    {STATUS_COLUMNS.map(status => (
                      <DropdownMenuItem
                        key={status}
                        disabled={status === task.status.status}
                        onSelect={() => handleStatusChange(status)}
                      >
                        <span
                          className="h-2 w-2 rounded-full flex-shrink-0"
                          style={{ backgroundColor: getStatusColor(status) }}
                          aria-hidden
                        />
                        {status}
                      </DropdownMenuItem>
                    ))}
                  </DropdownMenuContent>
                </DropdownMenu>
              ) : (
                <span
                  className="inline-flex items-center rounded-full px-2 py-0.5 text-xs font-medium text-white"
                  style={{ backgroundColor: statusColor }}
                >
                  {task.status.status}
                </span>
              )}

              {/* Awaria: tag, nie priorytet, więc stoi obok plakietki
                  priorytetu, a nie zamiast niej. */}
              {isAwaria(task.tags) && (
                <span className="inline-flex items-center gap-1 rounded-full bg-destructive/15 px-2 py-0.5 text-xs font-medium text-destructive">
                  <AlertTriangle className="h-3.5 w-3.5" aria-hidden />
                  Alarm
                </span>
              )}

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
            {/* Przycisk jest samą ikoną, więc bez `aria-label` czytnik ekranu
                czyta go jako „przycisk", nieodróżnialnie od przycisku wysyłki
                komentarza niżej. Wyszło przy pisaniu testu, który nie potrafił
                wskazać żadnego z nich po nazwie. */}
            <button
              onClick={onClose}
              aria-label="Zamknij szczegóły zadania"
              className="p-1.5 rounded-md hover:bg-muted text-muted-foreground hover:text-foreground transition-colors"
            >
              <X className="h-4 w-4" aria-hidden />
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
                jako important.is. */}
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
                    : 'important.is'}
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
            ) : commentsError ? (
              <div className="py-2">
                <p className="text-sm text-destructive">Nie udało się pobrać komentarzy.</p>
                <button
                  type="button"
                  onClick={() => setRefreshKey(k => k + 1)}
                  className="text-xs font-medium text-primary hover:underline mt-1"
                >
                  Spróbuj ponownie
                </button>
              </div>
            ) : comments.length === 0 ? (
              <p className="text-sm text-muted-foreground py-2">Brak komentarzy</p>
            ) : (
              <div className="space-y-4">
                {comments.map(comment => {
                  const isAgency = comment.sender === 'important.is'
                  const initials = isAgency ? 'IM' : (comment.sender?.slice(0, 2).toUpperCase() ?? '?')
                  const bgColor = isAgency ? '#3b6fe8' : '#6b7280'
                  const isEditing = editingCommentId === comment.id
                  return (
                    <div key={comment.id} className="flex gap-3">
                      <div
                        className="h-7 w-7 rounded-full flex items-center justify-center text-white text-xs font-bold flex-shrink-0"
                        style={{ backgroundColor: bgColor }}
                      >
                        {initials}
                      </div>
                      <div className="flex-1 min-w-0">
                        <div className="flex items-baseline gap-2 mb-1">
                          <span className="text-xs font-medium text-foreground">
                            {comment.sender ?? 'Nieznany'}
                          </span>
                          <span className="text-xs text-muted-foreground">
                            {formatDate(comment.date)}
                          </span>
                          {comment.isOwn && !isEditing && (
                            <span className="ml-auto flex gap-2">
                              <button
                                type="button"
                                onClick={() => startEdit(comment)}
                                aria-label="Edytuj komentarz"
                                className="text-muted-foreground hover:text-foreground"
                              >
                                <Pencil className="h-3.5 w-3.5" aria-hidden />
                              </button>
                              <button
                                type="button"
                                onClick={() => handleDeleteComment(comment.id)}
                                aria-label="Usuń komentarz"
                                className="text-muted-foreground hover:text-destructive"
                              >
                                <Trash2 className="h-3.5 w-3.5" aria-hidden />
                              </button>
                            </span>
                          )}
                        </div>
                        {isEditing ? (
                          <div className="flex flex-col gap-2">
                            <Textarea
                              value={editText}
                              onChange={e => setEditText(e.target.value)}
                              onKeyDown={e => handleEditKeyDown(e, comment.id)}
                              rows={2}
                              autoFocus
                              className="text-sm"
                            />
                            <div className="flex gap-3">
                              <button
                                type="button"
                                onClick={() => handleSaveEdit(comment.id)}
                                disabled={savingEdit || !editText.trim()}
                                className="text-xs font-medium text-primary hover:underline disabled:opacity-50 disabled:pointer-events-none"
                              >
                                Zapisz
                              </button>
                              <button
                                type="button"
                                onClick={cancelEdit}
                                className="text-xs font-medium text-muted-foreground hover:underline"
                              >
                                Anuluj
                              </button>
                            </div>
                          </div>
                        ) : (
                          <MarkdownLite text={comment.comment_text} />
                        )}
                      </div>
                    </div>
                  )
                })}
                {/* Kotwica dla przewinięcia po wysłaniu. Wewnątrz listy, żeby
                    istniała tylko wtedy, gdy jest do czego przewijać. */}
                <div ref={commentsEndRef} />
              </div>
            )}
          </div>
        </div>}

        {/* Comment input — only on details tab */}
        {tab === 'details' && <div className="p-4 border-t border-border bg-card">
          {pendingFiles.length > 0 && (
            <div className="flex flex-wrap gap-2 mb-2">
              {pendingFiles.map((p, i) => (
                <div key={p.url} className="relative h-14 w-14 rounded-md overflow-hidden border border-border">
                  {/* eslint-disable-next-line @next/next/no-img-element */}
                  <img src={p.url} alt={p.file.name} className="h-full w-full object-cover block" />
                  <button
                    type="button"
                    onClick={() => removeFile(i)}
                    aria-label="Usuń obraz"
                    className="absolute top-0.5 right-0.5 h-4 w-4 rounded-full bg-black/60 text-white flex items-center justify-center"
                  >
                    <X className="h-2.5 w-2.5" aria-hidden />
                  </button>
                </div>
              ))}
            </div>
          )}
          <form onSubmit={handleSendComment} className="flex gap-2 items-end">
            <input
              ref={fileInputRef}
              type="file"
              accept="image/*"
              multiple
              className="hidden"
              onChange={e => { addFiles(e.target.files); e.target.value = '' }}
            />
            <button
              type="button"
              onClick={() => fileInputRef.current?.click()}
              disabled={sendingComment || pendingFiles.length >= 5}
              aria-label="Dołącz obraz"
              title="Dołącz obraz"
              className="inline-flex items-center justify-center rounded-md border border-input bg-background text-muted-foreground hover:text-foreground hover:bg-muted disabled:opacity-50 disabled:pointer-events-none h-9 w-9 flex-shrink-0"
            >
              <Paperclip className="h-4 w-4" aria-hidden />
            </button>
            <Textarea
              value={newComment}
              onChange={e => setNewComment(e.target.value)}
              onKeyDown={handleCommentKeyDown}
              onPaste={handleImagePaste}
              placeholder="Dodaj komentarz..."
              rows={1}
              className="flex-1 py-2"
            />
            <button
              type="submit"
              disabled={sendingComment || (!newComment.trim() && pendingFiles.length === 0)}
              aria-label={sendingComment ? 'Wysyłanie komentarza' : 'Wyślij komentarz'}
              className="inline-flex items-center justify-center rounded-md bg-primary px-3 py-1.5 text-sm font-medium text-primary-foreground shadow hover:bg-primary/90 disabled:opacity-50 disabled:pointer-events-none h-9 w-9 flex-shrink-0"
            >
              {sendingComment ? (
                <Loader2 className="h-4 w-4 animate-spin" aria-hidden />
              ) : (
                <Send className="h-4 w-4" aria-hidden />
              )}
            </button>
          </form>
        </div>}
      </SheetContent>
    </Sheet>
  )
}
