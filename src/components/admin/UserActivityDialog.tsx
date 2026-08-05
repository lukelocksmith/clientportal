'use client'
import { useEffect, useState } from 'react'
import {
  AlertTriangle,
  Ban,
  Clock,
  KeyRound,
  Lightbulb,
  Loader2,
  LogIn,
  Mail,
  MessageSquare,
  Monitor,
  Plus,
} from 'lucide-react'
import { Dialog, DialogContent, DialogHeader, DialogTitle } from '@/components/ui/dialog'
import { deviceLabel } from '@/lib/deviceLabel'

/**
 * Historia jednej osoby: stan konta, co zgłosiła, kiedy wchodziła, jakie maile
 * do niej poszły.
 *
 * Osobny plik, a nie kolejna sekcja w AdminPanel.tsx, bo ten plik ma już ponad
 * 900 linii i każde dopisanie do niego pogarsza czytelność całego panelu.
 *
 * Dane wczytujemy PO otwarciu okna, nie razem z listą użytkowników. Przy
 * kilkudziesięciu kontach pobieranie historii każdego z nich z góry oznaczałoby
 * kilkadziesiąt zapytań na wejściu w zakładkę, a otwiera się zwykle jedno.
 */
type ActivityEvent = {
  id: string
  action: string
  actionLabel: string
  userName: string | null
  resourceId: string | null
  meta: Record<string, unknown> | null
  createdAt: string
}

type MailRow = {
  id: string
  kind: string
  subject: string
  ok: boolean
  detail: string | null
  createdAt: string
}

type SessionRow = {
  id: string
  createdAt: string
  expiresAt: string
  ip: string | null
  userAgent: string | null
}

type Activity = {
  user: {
    email: string
    name: string | null
    isActive: boolean
    failedAttempts: number
    lockedUntil: string | null
    lastLoginAt: string | null
    createdAt: string
    portalName: string | null
  }
  events: ActivityEvent[]
  mail: MailRow[]
  sessions: SessionRow[]
}

const ICONS: Record<string, React.ElementType> = {
  task_created: Plus,
  comment_added: MessageSquare,
  panic_alert: AlertTriangle,
  portal_idea: Lightbulb,
  login: LogIn,
  login_failed: Ban,
  password_set: KeyRound,
}

/** Kolor niesie wagę zdarzenia: alarm i nieudane wejście mają się wyróżniać. */
const COLORS: Record<string, string> = {
  panic_alert: 'text-destructive',
  login_failed: 'text-destructive',
  task_created: 'text-primary',
}

function stamp(iso: string): string {
  // Data i godzina, bo przy pytaniu „kiedy się logował" sama data nie wystarcza.
  return new Date(iso).toLocaleString('pl-PL', {
    day: '2-digit',
    month: '2-digit',
    year: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  })
}

const MAIL_LABELS: Record<string, string> = {
  invite: 'Zaproszenie',
  reset: 'Odzyskiwanie hasła',
  'password-changed': 'Powiadomienie o zmianie hasła',
  panic: 'Alarm',
}

export function UserActivityDialog({
  userId,
  onClose,
}: {
  userId: string | null
  onClose: () => void
}) {
  /**
   * Jeden stan z identyfikatorem osoby, do której należy odpowiedź.
   *
   * Nie ma tu osobnych `loading` ani `error` zerowanych na wejściu w efekt,
   * bo synchroniczne `setState` w efekcie wywołuje kaskadę renderów (i słusznie
   * krzyczy na to linter Reacta). Zamiast czyścić stan przy zmianie osoby,
   * porównujemy `wynik.id` z `userId`: odpowiedź dla poprzedniej osoby po prostu
   * przestaje pasować i nie ma jak pokazać się w oknie nowej.
   */
  const [wynik, setWynik] = useState<{ id: string; data?: Activity; error?: string } | null>(null)

  useEffect(() => {
    if (!userId) return
    let anulowane = false

    fetch(`/api/admin/users/${userId}/activity`)
      .then(async res => {
        const json = await res.json().catch(() => null)
        if (!res.ok) throw new Error(json?.error ?? `Błąd ${res.status}`)
        return json as Activity
      })
      .then(json => { if (!anulowane) setWynik({ id: userId, data: json }) })
      .catch(e => {
        if (!anulowane) {
          setWynik({ id: userId, error: e instanceof Error ? e.message : 'Nie udało się wczytać historii' })
        }
      })

    return () => { anulowane = true }
  }, [userId])

  const biezacy = wynik && wynik.id === userId ? wynik : null
  const data = biezacy?.data ?? null
  const error = biezacy?.error ?? null
  const loading = !!userId && !biezacy
  const u = data?.user

  return (
    <Dialog open={!!userId} onOpenChange={open => !open && onClose()}>
      <DialogContent className="sm:max-w-2xl">
        <DialogHeader>
          <DialogTitle>{u ? (u.name ? `${u.name} · ${u.email}` : u.email) : 'Historia użytkownika'}</DialogTitle>
        </DialogHeader>

        {loading && (
          <p className="flex items-center gap-2 py-6 text-sm text-muted-foreground">
            <Loader2 className="h-4 w-4 animate-spin" /> Wczytuję historię…
          </p>
        )}

        {error && <p className="py-6 text-sm text-destructive">{error}</p>}

        {u && !loading && (
          <div className="max-h-[70vh] space-y-5 overflow-y-auto pr-1">
            {/* Stan konta. Cztery liczby, od których zwykle zaczyna się pytanie
                „czemu on się nie może zalogować". */}
            <div className="grid grid-cols-2 gap-3 rounded-lg border border-border bg-muted/30 p-3 text-xs sm:grid-cols-4">
              <div>
                <p className="text-[10px] uppercase tracking-wide text-muted-foreground">Projekt</p>
                <p className="mt-0.5 font-medium text-foreground">{u.portalName ?? '—'}</p>
              </div>
              <div>
                <p className="text-[10px] uppercase tracking-wide text-muted-foreground">Konto od</p>
                <p className="mt-0.5 font-medium text-foreground">{stamp(u.createdAt)}</p>
              </div>
              <div>
                <p className="text-[10px] uppercase tracking-wide text-muted-foreground">Ostatnie wejście</p>
                <p className="mt-0.5 font-medium text-foreground">
                  {u.lastLoginAt ? stamp(u.lastLoginAt) : 'nigdy'}
                </p>
              </div>
              <div>
                <p className="text-[10px] uppercase tracking-wide text-muted-foreground">Stan</p>
                <p className="mt-0.5 font-medium text-foreground">
                  {!u.isActive
                    ? 'nieaktywne'
                    : u.lockedUntil && new Date(u.lockedUntil) > new Date()
                      ? `zablokowane do ${stamp(u.lockedUntil)}`
                      : u.failedAttempts > 0
                        ? `${u.failedAttempts} nieudanych prób`
                        : 'aktywne'}
                </p>
              </div>
            </div>

            {/* Czynne sesje, czyli ile urządzeń ma teraz dostęp. To NIE jest
                historia wejść: wiersze wygasają i giną przy wylogowaniu. */}
            {data.sessions.length > 0 && (
              <section>
                <h3 className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
                  Czynne sesje ({data.sessions.length})
                </h3>
                <ul className="mt-2 space-y-1.5">
                  {data.sessions.map(s => (
                    <li key={s.id} className="flex items-start gap-2 text-xs">
                      <Monitor className="mt-0.5 h-3.5 w-3.5 shrink-0 text-muted-foreground" />
                      <span className="text-foreground">{deviceLabel(s.userAgent)}</span>
                      <span className="text-muted-foreground">
                        {s.ip ?? 'bez adresu'} · od {stamp(s.createdAt)} · wygasa {stamp(s.expiresAt)}
                      </span>
                    </li>
                  ))}
                </ul>
              </section>
            )}

            <section>
              <h3 className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
                Co robił w portalu ({data.events.length})
              </h3>
              {data.events.length === 0 ? (
                // Rozdzielamy „nic nie zrobił" od „nie było czego zapisać":
                // zdarzenia zbieramy od lipca 2026, wcześniejsze wejścia nie
                // zostawiły śladu i wpisanie tu zera byłoby nieprawdą.
                <p className="mt-2 text-xs text-muted-foreground">
                  Brak zapisanych zdarzeń. Zgłoszenia i wejścia są zapisywane od momentu wdrożenia
                  historii, więc starsze mogą nie mieć śladu.
                </p>
              ) : (
                <ul className="mt-2 space-y-2">
                  {data.events.map(e => {
                    const Icon = ICONS[e.action] ?? Clock
                    const meta = e.meta ?? {}
                    const nazwa = typeof meta.taskName === 'string' ? meta.taskName : null
                    const url = typeof meta.url === 'string' ? meta.url : null
                    const skad = typeof meta.wejscie === 'string' ? meta.wejscie : null
                    const powod = typeof meta.powod === 'string' ? meta.powod : null
                    const ip = typeof meta.ip === 'string' ? meta.ip : null
                    const priorytet = typeof meta.priority === 'number' ? meta.priority : null

                    return (
                      <li key={e.id} className="flex items-start gap-2.5 text-xs">
                        <Icon className={`mt-0.5 h-3.5 w-3.5 shrink-0 ${COLORS[e.action] ?? 'text-muted-foreground'}`} />
                        <div className="min-w-0 flex-1">
                          <p className="text-foreground">
                            <span className="font-medium">{e.actionLabel}</span>
                            {nazwa && (
                              <>
                                {': '}
                                {url ? (
                                  <a
                                    href={url}
                                    target="_blank"
                                    rel="noopener noreferrer"
                                    className="underline hover:text-primary"
                                  >
                                    {nazwa}
                                  </a>
                                ) : (
                                  nazwa
                                )}
                              </>
                            )}
                          </p>
                          <p className="text-muted-foreground">
                            {stamp(e.createdAt)}
                            {priorytet !== null && ` · priorytet ${priorytet}`}
                            {skad && ` · ${skad}`}
                            {powod && ` · ${powod}`}
                            {ip && ` · ${ip}`}
                          </p>
                        </div>
                      </li>
                    )
                  })}
                </ul>
              )}
            </section>

            <section>
              <h3 className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
                Maile na ten adres ({data.mail.length})
              </h3>
              {data.mail.length === 0 ? (
                <p className="mt-2 text-xs text-muted-foreground">Nic nie wysyłaliśmy.</p>
              ) : (
                <ul className="mt-2 space-y-2">
                  {data.mail.map(m => (
                    <li key={m.id} className="flex items-start gap-2.5 text-xs">
                      <Mail
                        className={`mt-0.5 h-3.5 w-3.5 shrink-0 ${m.ok ? 'text-muted-foreground' : 'text-destructive'}`}
                      />
                      <div className="min-w-0 flex-1">
                        <p className="text-foreground">
                          <span className="font-medium">{MAIL_LABELS[m.kind] ?? m.kind}</span>
                          {!m.ok && <span className="ml-2 text-destructive">nie wyszedł</span>}
                        </p>
                        <p className="text-muted-foreground">{stamp(m.createdAt)}</p>
                        {/* Odpowiedź serwera pocztowego. To ona rozstrzyga spór
                            „nie dostałem maila", więc pokazujemy ją dosłownie. */}
                        {m.detail && (
                          <p className="mt-0.5 break-all font-mono text-[10px] text-muted-foreground">
                            {m.detail}
                          </p>
                        )}
                      </div>
                    </li>
                  ))}
                </ul>
              )}
            </section>
          </div>
        )}
      </DialogContent>
    </Dialog>
  )
}
