'use client'
import { useState, useRef, useEffect } from 'react'
import { useChat } from '@ai-sdk/react'
import { DefaultChatTransport, type UIMessage } from 'ai'
import { Send, Loader2, Bot, X } from 'lucide-react'

interface ChatWindowProps {
  slug: string
  portalName: string
  userEmail: string
  onClose: () => void
}

export function ChatWindow({ slug, portalName, userEmail, onClose }: ChatWindowProps) {
  const [input, setInput] = useState('')
  const bottomRef = useRef<HTMLDivElement>(null)

  const initialMessages: UIMessage[] = [
    {
      id: 'welcome',
      role: 'assistant',
      parts: [
        {
          type: 'text',
          text: `Cześć! Jestem asystentem portalu **${portalName}**.\n\nMogę pomóc Ci zgłosić zadanie do agencji. Żeby zadanie trafiło do realizacji od razu, będę potrzebować **kompletnych informacji** — co, gdzie, jak i kiedy.\n\nOpisz co chcesz zlecić, a dopytam o szczegóły jeśli będę ich potrzebować.`,
        },
      ],
    },
  ]

  const { messages, sendMessage, status, error } = useChat({
    transport: new DefaultChatTransport({
      api: '/api/ai/chat',
      body: { slug },
    }),
    messages: initialMessages,
  })

  const isLoading = status === 'streaming' || status === 'submitted'

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: 'smooth' })
  }, [messages])

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault()
    if (!input.trim() || isLoading) return
    const text = input
    setInput('')
    await sendMessage({ text })
  }

  return (
    <>
      {/* Backdrop */}
      <div
        className="fixed inset-0 bg-black/20 backdrop-blur-[2px] z-40"
        onClick={onClose}
      />

      {/* Panel */}
      <div className="fixed right-0 top-0 h-full w-full max-w-sm bg-card border-l border-border shadow-2xl z-50 flex flex-col">
        {/* Header */}
        <div className="flex items-center gap-3 px-4 py-3 border-b border-border flex-shrink-0">
          <div className="h-8 w-8 rounded-lg bg-primary flex items-center justify-center text-primary-foreground flex-shrink-0">
            <Bot className="h-4 w-4" />
          </div>
          <div className="flex-1 min-w-0">
            <h2 className="font-semibold text-sm text-foreground">AI Asystent</h2>
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
          <form onSubmit={handleSubmit} className="flex gap-2">
            <input
              value={input}
              onChange={e => setInput(e.target.value)}
              placeholder="Opisz co chcesz zgłosić..."
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
          <p className="text-center text-[10px] text-muted-foreground mt-1.5">
            AI może popełniać błędy — sprawdź zadania po stworzeniu.
          </p>
        </div>
      </div>
    </>
  )
}
