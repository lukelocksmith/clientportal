'use client'
import { useState, useRef, useEffect } from 'react'
import { useChat } from '@ai-sdk/react'
import { DefaultChatTransport, type UIMessage } from 'ai'
import { Send, Loader2, Bot, X, Plus, Paperclip } from 'lucide-react'
import { Sheet, SheetContent, SheetTitle } from '@/components/ui/sheet'

interface ChatWindowProps {
  slug: string
  portalName: string
  userEmail: string
  mode?: 'new-task' | 'general'
  onClose: () => void
}

export function ChatWindow({ slug, portalName, userEmail, mode = 'general', onClose }: ChatWindowProps) {
  const [input, setInput] = useState('')
  const bottomRef = useRef<HTMLDivElement>(null)

  const welcomeText = mode === 'new-task'
    ? `Cześć! Pomogę Ci zgłosić nowe zadanie do agencji.\n\nOpisz krótko co chcesz zlecić — możesz pisać luźno, dopytam o szczegóły które są potrzebne do realizacji.`
    : `Cześć! Jestem asystentem portalu **${portalName}**.\n\nMogę odpowiedzieć na pytania o projekty lub pomóc Ci zgłosić nowe zadanie. O co chodzi?`

  const initialMessages: UIMessage[] = [
    {
      id: 'welcome',
      role: 'assistant',
      parts: [{ type: 'text', text: welcomeText }],
    },
  ]

  // Fallback: on primary (Gemini) failure, retry the same turn once through OpenAI.
  const fallbackRef = useRef(false)
  const retriedRef = useRef(false)
  const [needFallback, setNeedFallback] = useState(false)

  const { messages, sendMessage, regenerate, status, error, clearError } = useChat({
    transport: new DefaultChatTransport({
      api: '/api/ai/chat',
      prepareSendMessagesRequest: ({ id, messages, trigger, messageId }) => ({
        body: { id, messages, trigger, messageId, slug, mode, fallback: fallbackRef.current },
      }),
    }),
    messages: initialMessages,
    onError: () => { if (!retriedRef.current) setNeedFallback(true) },
  })

  const isLoading = status === 'streaming' || status === 'submitted'

  // When Gemini fails, flip to the fallback provider and regenerate the last turn.
  useEffect(() => {
    if (!needFallback) return
    setNeedFallback(false)
    retriedRef.current = true
    fallbackRef.current = true
    clearError()
    regenerate()
  }, [needFallback, regenerate, clearError])

  // Pending screenshots to attach to the ClickUp task once it's created.
  const [pending, setPending] = useState<Array<{ file: File; url: string }>>([])
  const [attachNote, setAttachNote] = useState('')
  const fileInputRef = useRef<HTMLInputElement>(null)
  const attachedRef = useRef<Set<string>>(new Set())

  function addFiles(list: FileList | File[] | null) {
    if (!list) return
    const imgs = Array.from(list).filter(f => f.type.startsWith('image/'))
    if (!imgs.length) return
    setPending(prev => [...prev, ...imgs.map(f => ({ file: f, url: URL.createObjectURL(f) }))].slice(0, 5))
  }

  function removeFile(idx: number) {
    setPending(prev => {
      const next = [...prev]
      const [gone] = next.splice(idx, 1)
      if (gone) URL.revokeObjectURL(gone.url)
      return next
    })
  }

  function handlePaste(e: React.ClipboardEvent) {
    const imgs = Array.from(e.clipboardData?.items ?? [])
      .filter(i => i.type.startsWith('image/'))
      .map(i => i.getAsFile())
      .filter((f): f is File => !!f)
    if (imgs.length) { e.preventDefault(); addFiles(imgs) }
  }

  async function uploadAttachments(taskId: string, files: File[]) {
    const fd = new FormData()
    files.forEach(f => fd.append('files', f))
    try {
      const res = await fetch(`/api/clickup/tasks/${taskId}/attachments?slug=${slug}`, { method: 'POST', body: fd })
      const data = res.ok ? await res.json().catch(() => null) : null
      const okCount = data?.attachments?.filter((a: { ok?: boolean }) => a.ok).length ?? 0
      if (okCount > 0) {
        setAttachNote(`📎 Dołączono ${okCount} ${okCount === 1 ? 'zrzut' : 'zrzuty'} do zadania`)
        setPending([])
      } else {
        setAttachNote('Nie udało się dołączyć zrzutów — spróbuj ponownie w zadaniu')
      }
    } catch {
      setAttachNote('Nie udało się dołączyć zrzutów — spróbuj ponownie w zadaniu')
    }
  }

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: 'smooth' })
  }, [messages])

  // When the assistant's createTask tool returns a taskId, attach any pending screenshots.
  useEffect(() => {
    let createdTaskId: string | null = null
    for (const m of messages) {
      if (m.role !== 'assistant') continue
      for (const p of m.parts as Array<{ type?: string; output?: { taskId?: string } }>) {
        if (typeof p.type === 'string' && p.type.startsWith('tool-') && p.output?.taskId) {
          createdTaskId = p.output.taskId
        }
      }
    }
    if (createdTaskId && pending.length && !attachedRef.current.has(createdTaskId)) {
      attachedRef.current.add(createdTaskId)
      uploadAttachments(createdTaskId, pending.map(p => p.file))
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [messages])

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault()
    if (!input.trim() || isLoading) return
    // New turn: try the primary provider first; fallback re-arms per message.
    retriedRef.current = false
    fallbackRef.current = false
    // Let the model know a screenshot is attached so it doesn't ask for an image link.
    const note = pending.length > 0
      ? `\n\n(Dołączam ${pending.length === 1 ? 'zrzut ekranu' : `${pending.length} zrzuty ekranu`} do tego zgłoszenia — zostanie automatycznie dodany do zadania.)`
      : ''
    const text = input
    setInput('')
    await sendMessage({ text: text + note })
  }

  const headerTitle = mode === 'new-task' ? 'Nowe zadanie' : 'AI Asystent'
  const inputPlaceholder = mode === 'new-task'
    ? 'Opisz co chcesz zlecić...'
    : 'Napisz wiadomość...'

  return (
    // Jak TaskDrawer: Sheet zamiast recznego panelu, dla Escape, pulapki
    // fokusa i aria-modal. Szerokosc zostaje przy sm:max-w-sm, czyli
    // domyslnej dla Sheet, bo czat byl wezszy od szuflady zadania.
    <Sheet open onOpenChange={next => { if (!next) onClose() }}>
      <SheetContent
        side="right"
        showCloseButton={false}
        className="w-full gap-0 border-border bg-card p-0"
      >
        <SheetTitle className="sr-only">{headerTitle}</SheetTitle>
        {/* Header */}
        <div className="flex items-center gap-3 px-4 py-3 border-b border-border flex-shrink-0">
          <div className="h-8 w-8 rounded-lg bg-primary flex items-center justify-center text-primary-foreground flex-shrink-0">
            {mode === 'new-task' ? <Plus className="h-4 w-4" /> : <Bot className="h-4 w-4" />}
          </div>
          <div className="flex-1 min-w-0">
            <h2 className="font-semibold text-sm text-foreground">{headerTitle}</h2>
            <p className="text-xs text-muted-foreground truncate">{portalName}</p>
          </div>
          <button
            onClick={onClose}
            className="p-1.5 rounded-md hover:bg-muted text-muted-foreground hover:text-foreground transition-colors flex-shrink-0"
          >
            <X className="h-4 w-4" />
          </button>
        </div>

        {/* Messages */}
        <div className="flex-1 overflow-y-auto px-4 py-4 space-y-4">
          {messages.map(message => {
            const textParts = message.parts.filter(p => p.type === 'text') as Array<{ type: 'text'; text: string }>
            const fullText = textParts.map(p => p.text).join('')

            // Don't render an empty assistant bubble while the model is still
            // "thinking" (reasoning models emit reasoning parts before any text).
            // The loading indicator below covers that state.
            if (message.role === 'assistant' && !fullText.trim()) return null

            return (
              <div
                key={message.id}
                className={`flex gap-2.5 ${message.role === 'user' ? 'flex-row-reverse' : 'flex-row'}`}
              >
                <div
                  className={`h-6 w-6 rounded-full flex items-center justify-center flex-shrink-0 text-[10px] font-bold ${
                    message.role === 'user'
                      ? 'bg-primary text-primary-foreground'
                      : 'bg-muted text-muted-foreground'
                  }`}
                >
                  {message.role === 'user'
                    ? (userEmail[0]?.toUpperCase() ?? 'U')
                    : <Bot className="h-3 w-3" />
                  }
                </div>

                <div
                  className={`max-w-[85%] rounded-2xl px-3.5 py-2 text-sm leading-relaxed ${
                    message.role === 'user'
                      ? 'bg-primary text-primary-foreground rounded-tr-sm'
                      : 'bg-muted text-foreground rounded-tl-sm'
                  }`}
                >
                  {fullText.includes('✅') && message.role === 'assistant' && (
                    <div className="text-xs font-medium text-green-700 dark:text-green-400 mb-1.5">
                      ✅ Zadanie zostało dodane
                    </div>
                  )}
                  <div className="whitespace-pre-wrap">
                    {fullText.split('**').map((part, i) =>
                      i % 2 === 1 ? <strong key={i}>{part}</strong> : part
                    )}
                  </div>
                </div>
              </div>
            )
          })}

          {isLoading && (
            <div className="flex gap-2.5">
              <div className="h-6 w-6 rounded-full bg-muted flex items-center justify-center flex-shrink-0">
                <Bot className="h-3 w-3 text-muted-foreground" />
              </div>
              <div className="bg-muted rounded-2xl rounded-tl-sm px-3.5 py-2.5">
                <Loader2 className="h-3.5 w-3.5 animate-spin text-muted-foreground" />
              </div>
            </div>
          )}

          {error && (
            <div className="text-center text-xs text-destructive bg-destructive/10 rounded-lg p-2.5">
              Wystąpił błąd. Spróbuj ponownie.
            </div>
          )}

          <div ref={bottomRef} />
        </div>

        {/* Input */}
        <div className="p-3 border-t border-border flex-shrink-0">
          {/* Pending screenshots */}
          {pending.length > 0 && (
            <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', marginBottom: 8 }}>
              {pending.map((p, i) => (
                <div
                  key={p.url}
                  style={{ position: 'relative', height: 56, width: 56, borderRadius: 8, overflow: 'hidden' }}
                  className="border border-border"
                >
                  {/* eslint-disable-next-line @next/next/no-img-element */}
                  <img src={p.url} alt={p.file.name} style={{ height: 56, width: 56, objectFit: 'cover', display: 'block' }} />
                  <button
                    type="button"
                    onClick={() => removeFile(i)}
                    aria-label="Usuń zrzut"
                    style={{ position: 'absolute', top: 2, right: 2, height: 16, width: 16, borderRadius: 9999, background: 'rgba(0,0,0,0.6)', color: '#fff', display: 'flex', alignItems: 'center', justifyContent: 'center', cursor: 'pointer' }}
                  >
                    <X style={{ height: 10, width: 10 }} />
                  </button>
                </div>
              ))}
            </div>
          )}

          <form onSubmit={handleSubmit} className="flex gap-2">
            <input
              ref={fileInputRef}
              type="file"
              accept="image/*"
              multiple
              style={{ display: 'none' }}
              onChange={e => { addFiles(e.target.files); e.target.value = '' }}
            />
            <button
              type="button"
              onClick={() => fileInputRef.current?.click()}
              disabled={isLoading || pending.length >= 5}
              title="Dołącz zrzut ekranu"
              className="inline-flex items-center justify-center rounded-xl border border-input bg-background text-muted-foreground hover:text-foreground hover:bg-muted disabled:opacity-50 h-9 w-9 flex-shrink-0 transition-colors"
            >
              <Paperclip className="h-3.5 w-3.5" />
            </button>
            <input
              value={input}
              onChange={e => setInput(e.target.value)}
              onPaste={handlePaste}
              placeholder={inputPlaceholder}
              disabled={isLoading}
              autoFocus
              className="flex-1 h-9 rounded-xl border border-input bg-background px-3 py-2 text-sm placeholder:text-muted-foreground focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring disabled:opacity-50"
            />
            <button
              type="submit"
              disabled={isLoading || !input.trim()}
              className="inline-flex items-center justify-center rounded-xl bg-primary text-primary-foreground shadow hover:bg-primary/90 disabled:opacity-50 disabled:pointer-events-none h-9 w-9 flex-shrink-0 transition-colors"
            >
              {isLoading ? (
                <Loader2 className="h-3.5 w-3.5 animate-spin" />
              ) : (
                <Send className="h-3.5 w-3.5" />
              )}
            </button>
          </form>
          {attachNote ? (
            <p className="text-center text-[10px] text-primary mt-1.5">{attachNote}</p>
          ) : mode === 'new-task' && (
            <p className="text-center text-[10px] text-muted-foreground mt-1.5">
              Możesz dołączyć zrzut ekranu 📎 — zadanie pojawi się na tablicy po odświeżeniu.
            </p>
          )}
        </div>
      </SheetContent>
    </Sheet>
  )
}
