'use client'
import { useEffect, useState } from 'react'
import { AlertTriangle, Bot, ChevronDown, ChevronRight, ExternalLink, Plus } from '@/lib/icons'

/**
 * Zapisy rozmów z asystentem, do weryfikacji przez człowieka.
 *
 * PO CO (30.08): zgłoszenie zrobione przez asystenta nie pojawiło się na
 * tablicy. Dochodzenie mogło powiedzieć tylko tyle, że rozmowa była, a zadania
 * nie ma — treści rozmowy nikt nigdzie nie zapisywał. Ta zakładka odpowiada na
 * pytanie „co się właściwie stało": widać wypowiedzi klienta, odpowiedzi
 * modelu i to, czy w ogóle sięgnął po narzędzie zakładające zadanie.
 *
 * Kolumna „wynik" jest po to, żeby dało się przejrzeć listę wzrokiem:
 * „zadanie" znaczy, że zadanie powstało, „błąd" że narzędzie się wywróciło,
 * a „rozmowa" że próby zakładania NIE BYŁO. To ostatnie jest normalne, gdy
 * klient tylko dopytał — i podejrzane, gdy model odpisał, że zadanie dodał.
 *
 * Ładowane leniwie, po wejściu w zakładkę: każdy wiersz niesie cały transkrypt.
 */
type TranscriptTurn = {
  role: 'user' | 'assistant' | 'tool'
  text?: string
  tool?: { name: string; input: unknown; output?: unknown; error?: string }
}

type AiChat = {
  id: string
  userEmail: string | null
  provider: string
  model: string
  outcome: 'zadanie' | 'rozmowa' | 'blad' | string
  taskId: string | null
  taskName: string | null
  finishReason: string | null
  transcript: TranscriptTurn[]
  createdAt: string
}

const WYNIK: Record<string, { label: string; className: string; Icon: React.ComponentType<{ className?: string }> }> = {
  zadanie: { label: 'zadanie', className: 'text-foreground', Icon: Plus },
  rozmowa: { label: 'rozmowa', className: 'text-muted-foreground', Icon: Bot },
  blad: { label: 'błąd', className: 'text-destructive', Icon: AlertTriangle },
}

function fmtDate(iso: string): string {
  const d = new Date(iso)
  return Number.isNaN(d.getTime())
    ? '—'
    : d.toLocaleString('pl-PL', { day: '2-digit', month: '2-digit', year: 'numeric', hour: '2-digit', minute: '2-digit' })
}

/** Pierwsza wypowiedź klienta. To ona mówi, o co w rozmowie chodziło. */
function pierwszePytanie(turns: TranscriptTurn[]): string {
  return turns.find(t => t.role === 'user' && t.text)?.text ?? '—'
}

function Tura({ turn }: { turn: TranscriptTurn }) {
  if (turn.role === 'tool') {
    const tool = turn.tool
    return (
      <div className="rounded-md border border-border bg-muted/40 px-3 py-2">
        <p className="text-[10px] uppercase tracking-wide text-muted-foreground">
          narzędzie · {tool?.name ?? '—'}
        </p>
        <pre className="mt-1 overflow-x-auto whitespace-pre-wrap break-words text-[11px] text-foreground">
          {JSON.stringify(tool?.input ?? null, null, 1)}
        </pre>
        {tool?.error ? (
          <p className="mt-1 text-[11px] text-destructive">błąd: {tool.error}</p>
        ) : (
          <pre className="mt-1 overflow-x-auto whitespace-pre-wrap break-words text-[11px] text-muted-foreground">
            {JSON.stringify(tool?.output ?? null, null, 1)}
          </pre>
        )}
      </div>
    )
  }

  const klient = turn.role === 'user'
  return (
    <div className={`rounded-md px-3 py-2 ${klient ? 'bg-accent' : 'border border-border bg-card'}`}>
      <p className="text-[10px] uppercase tracking-wide text-muted-foreground">{klient ? 'klient' : 'asystent'}</p>
      <p className="mt-0.5 whitespace-pre-wrap text-xs text-foreground">{turn.text}</p>
    </div>
  )
}

export function ProjectAiChats({ slug }: { slug: string }) {
  const [chats, setChats] = useState<AiChat[]>([])
  const [openId, setOpenId] = useState<string | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    let cancelled = false
    fetch(`/api/admin/ai-chats?slug=${encodeURIComponent(slug)}`)
      .then(r => (r.ok ? r.json() : Promise.reject(new Error(String(r.status)))))
      .then((d: { chats: AiChat[] }) => {
        if (cancelled) return
        setChats(d.chats ?? [])
        setError(null)
        setLoading(false)
      })
      .catch(() => {
        if (cancelled) return
        setError('Nie udało się pobrać rozmów.')
        setLoading(false)
      })
    return () => {
      cancelled = true
    }
  }, [slug])

  if (loading) return <p className="px-4 py-6 text-xs text-muted-foreground">Ładowanie rozmów...</p>
  if (error) return <p className="px-4 py-6 text-xs text-destructive">{error}</p>

  if (chats.length === 0) {
    return (
      <p className="rounded-lg border border-border bg-card px-4 py-6 text-center text-xs text-muted-foreground">
        Brak zapisanych rozmów. Zapis działa od 30.08.2026 — wcześniejsze rozmowy zostawiały po sobie tylko zużycie tokenów.
      </p>
    )
  }

  return (
    <div className="space-y-2">
      {chats.map(chat => {
        const wynik = WYNIK[chat.outcome] ?? { label: chat.outcome, className: 'text-muted-foreground', Icon: Bot }
        const otwarty = openId === chat.id
        return (
          <div key={chat.id} className="overflow-hidden rounded-lg border border-border bg-card">
            <button
              type="button"
              onClick={() => setOpenId(otwarty ? null : chat.id)}
              className="flex w-full items-start gap-3 px-3 py-2 text-left hover:bg-accent/50"
            >
              {otwarty ? (
                <ChevronDown className="mt-0.5 h-3.5 w-3.5 shrink-0 text-muted-foreground" />
              ) : (
                <ChevronRight className="mt-0.5 h-3.5 w-3.5 shrink-0 text-muted-foreground" />
              )}
              <span className="w-32 shrink-0 text-xs text-muted-foreground">{fmtDate(chat.createdAt)}</span>
              <span className="w-44 shrink-0 truncate text-xs text-foreground">{chat.userEmail ?? '—'}</span>
              <span className={`inline-flex w-24 shrink-0 items-center gap-1 text-xs ${wynik.className}`}>
                <wynik.Icon className="h-3.5 w-3.5" />
                {wynik.label}
              </span>
              <span className="min-w-0 flex-1 truncate text-xs text-muted-foreground">
                {chat.taskName ?? pierwszePytanie(chat.transcript)}
              </span>
            </button>

            {otwarty && (
              <div className="space-y-2 border-t border-border px-3 py-3">
                <p className="text-[10px] text-muted-foreground">
                  {chat.provider} · {chat.model}
                  {chat.finishReason ? ` · zakończone: ${chat.finishReason}` : ''}
                  {chat.taskId && (
                    <>
                      {' · '}
                      <a
                        href={`https://app.clickup.com/t/${chat.taskId}`}
                        target="_blank"
                        rel="noreferrer"
                        className="inline-flex items-center gap-1 text-primary hover:underline"
                      >
                        ClickUp <ExternalLink className="h-2.5 w-2.5" />
                      </a>
                    </>
                  )}
                </p>
                {chat.transcript.map((turn, i) => (
                  <Tura key={i} turn={turn} />
                ))}
                {chat.outcome === 'rozmowa' && (
                  <p className="text-[11px] text-muted-foreground">
                    W tej rozmowie model NIE sięgnął po narzędzie zakładające zadanie. Jeśli mimo to napisał,
                    że zadanie dodał, to jest właśnie ten przypadek do zgłoszenia.
                  </p>
                )}
              </div>
            )}
          </div>
        )
      })}
      <p className="px-1 text-[10px] text-muted-foreground">
        Ostatnie {chats.length} rozmów tego projektu.
      </p>
    </div>
  )
}
