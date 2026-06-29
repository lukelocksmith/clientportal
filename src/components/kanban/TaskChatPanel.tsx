'use client'
import { useState, useRef, useEffect } from 'react'
import { useChat } from '@ai-sdk/react'
import { DefaultChatTransport, type UIMessage } from 'ai'
import { Send, Loader2, Bot } from 'lucide-react'
import type { ClickUpTask } from '@/lib/types'

interface TaskChatPanelProps {
  task: ClickUpTask
  slug: string
  userEmail: string
}

export function TaskChatPanel({ task, slug, userEmail }: TaskChatPanelProps) {
  const [input, setInput] = useState('')
  const bottomRef = useRef<HTMLDivElement>(null)

  const initialMessages: UIMessage[] = [
    {
      id: 'welcome',
      role: 'assistant',
      parts: [
        {
          type: 'text',
          text: `Cześć! Mogę odpowiedzieć na pytania dotyczące zadania **„${task.name}"** — aktualny status, postęp, komentarze, podzadania. O co chodzi?`,
        },
      ],
    },
  ]

  const { messages, sendMessage, status, error } = useChat({
    transport: new DefaultChatTransport({
      api: '/api/ai/chat',
      body: { slug, contextTaskId: task.id, mode: 'task' },
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
    <div className="flex flex-col h-full">
      {/* Messages */}
      <div className="flex-1 overflow-y-auto px-5 py-4 space-y-3">
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
      <div className="px-5 py-3 border-t border-border flex-shrink-0">
        <form onSubmit={handleSubmit} className="flex gap-2">
          <input
            value={input}
            onChange={e => setInput(e.target.value)}
            placeholder="Zapytaj o to zadanie..."
            disabled={isLoading}
            className="flex-1 h-9 rounded-xl border border-input bg-background px-3 py-2 text-sm placeholder:text-muted-foreground focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring disabled:opacity-50"
          />
          <button
            type="submit"
            disabled={isLoading || !input.trim()}
            className="inline-flex items-center justify-center rounded-xl bg-primary text-primary-foreground hover:bg-primary/90 disabled:opacity-50 disabled:pointer-events-none h-9 w-9 flex-shrink-0 transition-colors"
          >
            {isLoading
              ? <Loader2 className="h-3.5 w-3.5 animate-spin" />
              : <Send className="h-3.5 w-3.5" />
            }
          </button>
        </form>
      </div>
    </div>
  )
}
