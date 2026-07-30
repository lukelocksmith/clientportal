'use client'
import { useEffect, useState } from 'react'
import { AlertTriangle, ExternalLink, Lightbulb, MessageSquare, Plus } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table'

/**
 * Historia zgłoszeń projektu, z przypisaniem do osoby.
 *
 * Odpowiada na pytanie, na które ClickUp nie odpowiada: KTO u klienta to
 * zgłosił. Wszystkie zadania z portalu tworzy jedno konto serwisowe agencji,
 * więc w ClickUpie autorem każdego jesteśmy my.
 *
 * Ładowane leniwie, po wejściu w zakładkę, a nie razem z listą portali.
 * Zdarzeń jest z natury dużo więcej niż konfiguracji, a zaglądamy tu rzadko.
 */
type PortalEvent = {
  id: string
  action: string
  actionLabel: string
  userEmail: string | null
  userName: string | null
  resourceId: string | null
  meta: Record<string, unknown> | null
  createdAt: string
}

type Actor = { email: string; name: string | null; count: number; lastAt: string }

const ICONS: Record<string, React.ComponentType<{ className?: string }>> = {
  task_created: Plus,
  panic_alert: AlertTriangle,
  comment_added: MessageSquare,
  portal_idea: Lightbulb,
}

const ACTION_TONE: Record<string, string> = {
  panic_alert: 'text-destructive',
}

function fmtDate(iso: string): string {
  const d = new Date(iso)
  return Number.isNaN(d.getTime())
    ? '—'
    : d.toLocaleString('pl-PL', {
        day: '2-digit',
        month: '2-digit',
        year: 'numeric',
        hour: '2-digit',
        minute: '2-digit',
      })
}

/** Krótki opis zdarzenia z metadanych. Każdy rodzaj trzyma je pod inną nazwą. */
function describe(event: PortalEvent): string {
  const meta = event.meta ?? {}
  const first = ['taskName', 'message', 'excerpt', 'text'].find(k => typeof meta[k] === 'string')
  if (first) return String(meta[first])
  return event.resourceId ?? '—'
}

function metaUrl(event: PortalEvent): string | null {
  const url = event.meta?.url
  return typeof url === 'string' && url.startsWith('https://') ? url : null
}

export function ProjectEvents({ slug }: { slug: string }) {
  const [events, setEvents] = useState<PortalEvent[]>([])
  const [actors, setActors] = useState<Actor[]>([])
  const [email, setEmail] = useState<string | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    let cancelled = false
    // Bez `setLoading(true)` w ciele efektu: to wywoluje kaskade renderow
    // (regula react-hooks/set-state-in-effect) i nie jest tu do niczego
    // potrzebne. Wskaznik ladowania nalezy do PIERWSZEGO wejscia w zakladke.
    // Zmiana filtra tylko podmienia wiersze, bo to jedno zapytanie o najwyzej
    // 200 wierszy z naszej bazy, nie z ClickUpa.
    const params = new URLSearchParams({ slug })
    if (email) params.set('email', email)

    fetch(`/api/admin/portal-events?${params}`)
      .then(r => (r.ok ? r.json() : Promise.reject(new Error(String(r.status)))))
      .then((d: { events: PortalEvent[]; actors: Actor[] }) => {
        if (cancelled) return
        setEvents(d.events ?? [])
        // Lista osób nie zależy od filtra, więc zawężenie do jednej osoby nie
        // może usunąć pozostałych z przycisków. Inaczej po kliknięciu w kogoś
        // nie byłoby jak wrócić do pozostałych.
        if (!email) setActors(d.actors ?? [])
        setError(null)
        setLoading(false)
      })
      .catch(() => {
        if (cancelled) return
        setError('Nie udało się pobrać historii.')
        setLoading(false)
      })

    return () => {
      cancelled = true
    }
  }, [slug, email])

  if (loading && events.length === 0 && !error) {
    return <p className="px-4 py-6 text-xs text-muted-foreground">Ładowanie historii...</p>
  }

  if (error) {
    return <p className="px-4 py-6 text-xs text-destructive">{error}</p>
  }

  return (
    <div className="space-y-3">
      {actors.length > 0 && (
        <div className="flex flex-wrap items-center gap-1.5">
          <span className="mr-1 text-[10px] uppercase tracking-wide text-muted-foreground">Osoba</span>
          <Button
            variant={email === null ? 'secondary' : 'ghost'}
            size="xs"
            onClick={() => setEmail(null)}
          >
            Wszyscy
          </Button>
          {actors.map(a => (
            <Button
              key={a.email}
              variant={email === a.email ? 'secondary' : 'ghost'}
              size="xs"
              onClick={() => setEmail(a.email)}
              title={a.email}
            >
              {a.name ?? a.email}
              <span className="ml-1 text-muted-foreground">{a.count}</span>
            </Button>
          ))}
        </div>
      )}

      {events.length === 0 ? (
        <p className="rounded-lg border border-border bg-card px-4 py-6 text-center text-xs text-muted-foreground">
          {email
            ? 'Ta osoba nie ma jeszcze żadnych zgłoszeń.'
            : 'Brak zgłoszeń z portalu. Historia zapełnia się od pierwszego zadania, alarmu lub komentarza.'}
        </p>
      ) : (
        <div className="overflow-hidden rounded-lg border border-border bg-card">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead className="w-36">Kiedy</TableHead>
                <TableHead className="w-40">Kto</TableHead>
                <TableHead className="w-32">Co</TableHead>
                <TableHead>Szczegóły</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {events.map(event => {
                const Icon = ICONS[event.action]
                const url = metaUrl(event)
                return (
                  <TableRow key={event.id}>
                    <TableCell className="whitespace-nowrap text-xs text-muted-foreground">
                      {fmtDate(event.createdAt)}
                    </TableCell>
                    <TableCell className="text-xs">
                      {/* Imię, gdy jest, adres pod spodem: imiona się powtarzają,
                          a adres jest jedyną rzeczą naprawdę rozróżniającą. */}
                      {event.userName ? (
                        <>
                          <span className="text-foreground">{event.userName}</span>
                          <span className="block text-[10px] text-muted-foreground">{event.userEmail}</span>
                        </>
                      ) : (
                        <span className="text-muted-foreground">{event.userEmail ?? '—'}</span>
                      )}
                    </TableCell>
                    <TableCell className={`whitespace-nowrap text-xs ${ACTION_TONE[event.action] ?? 'text-foreground'}`}>
                      <span className="inline-flex items-center gap-1.5">
                        {Icon && <Icon className="h-3.5 w-3.5" />}
                        {event.actionLabel}
                      </span>
                    </TableCell>
                    <TableCell className="text-xs text-muted-foreground">
                      <span className="line-clamp-2">{describe(event)}</span>
                      {url && (
                        <a
                          href={url}
                          target="_blank"
                          rel="noreferrer"
                          className="mt-0.5 inline-flex items-center gap-1 text-[10px] text-primary hover:underline"
                        >
                          ClickUp <ExternalLink className="h-2.5 w-2.5" />
                        </a>
                      )}
                    </TableCell>
                  </TableRow>
                )
              })}
            </TableBody>
          </Table>
        </div>
      )}
    </div>
  )
}
