'use client'
import { useCallback, useEffect, useState } from 'react'
import { toast } from 'sonner'
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger } from '@/components/ui/dropdown-menu'
import { Mail, Plus, X, Loader2 } from '@/lib/icons'

/**
 * Obserwatorzy zadania w szufladzie.
 *
 * Osobny komponent, a nie kolejny fragment `TaskDrawer`: ma własne pobieranie,
 * własny stan i własny błąd, więc doklejony do szuflady mieszałby się z
 * wątkiem komentarzy, który ma dokładnie te same trzy rzeczy.
 *
 * Co to znaczy dla klienta: dopisana osoba dostaje MAILA o komentarzach
 * i zmianach statusu tej sprawy, tak jak dostaje je zgłaszający.
 *
 * Nagłówek to jedno słowo: „Odbiorcy". Koperta obok mówi, czego dotyczy, więc
 * dłuższe „powiadamiamy" albo „do wiadomości" tylko dokładało słów: pierwsze
 * opisuje nasz mechanizm, drugie brzmi jak pismo urzędowe.
 */

type Watcher = { userId: string; name: string | null; email: string }

const podpis = (w: Watcher) => w.name?.trim() || w.email

export function TaskWatchers({ slug, taskId }: { slug: string; taskId: string }) {
  const [watchers, setWatchers] = useState<Watcher[]>([])
  const [candidates, setCandidates] = useState<Watcher[]>([])
  const [loading, setLoading] = useState(true)
  const [busy, setBusy] = useState(false)
  const [blad, setBlad] = useState(false)

  const adres = useCallback(
    (extra = '') => `/api/clickup/tasks/${encodeURIComponent(taskId)}/watchers?slug=${encodeURIComponent(slug)}${extra}`,
    [taskId, slug],
  )

  /**
   * Pobranie listy. BEZ ustawiania stanu w ciele efektu (stan startowy już
   * mówi „wczytuję"), bo synchroniczny `setState` w efekcie kaskaduje
   * renderowanie i React na to krzyczy. Przy przejściu na inne zadanie
   * komponent jest montowany od nowa (`key` przy użyciu w szufladzie), więc
   * nie ma czego resetować ręcznie.
   */
  useEffect(() => {
    let anulowane = false
    fetch(adres())
      .then(res => (res.ok ? res.json() : Promise.reject(new Error(String(res.status)))))
      .then((data: { watchers?: Watcher[]; candidates?: Watcher[] }) => {
        if (anulowane) return
        setWatchers(data.watchers ?? [])
        setCandidates(data.candidates ?? [])
      })
      .catch(() => {
        // Cicha porazka zostawilaby pusta liste, czyli komunikat „nikt nie
        // obserwuje" tam, gdzie prawda brzmi „nie wiemy".
        if (!anulowane) setBlad(true)
      })
      .finally(() => {
        if (!anulowane) setLoading(false)
      })
    return () => { anulowane = true }
  }, [adres])

  async function dodaj(userId: string) {
    setBusy(true)
    try {
      const res = await fetch(adres(), {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ userId }),
      })
      if (!res.ok) throw new Error(String(res.status))
      const data = await res.json()
      setWatchers(data.watchers ?? [])
    } catch {
      toast.error('Nie udało się dopisać osoby')
    } finally {
      setBusy(false)
    }
  }

  async function zdejmij(userId: string) {
    setBusy(true)
    try {
      const res = await fetch(adres(`&userId=${encodeURIComponent(userId)}`), { method: 'DELETE' })
      if (!res.ok) throw new Error(String(res.status))
      const data = await res.json()
      setWatchers(data.watchers ?? [])
    } catch {
      toast.error('Nie udało się usunąć osoby')
    } finally {
      setBusy(false)
    }
  }

  const doDodania = candidates.filter(c => !watchers.some(w => w.userId === c.userId))

  return (
    <div className="flex flex-wrap items-center gap-1.5 text-sm">
      <span className="inline-flex items-center gap-1.5 text-muted-foreground">
        <Mail className="h-3.5 w-3.5 shrink-0" aria-hidden />
        Odbiorcy:
      </span>

      {loading ? (
        <Loader2 className="h-3.5 w-3.5 animate-spin text-muted-foreground" aria-label="Wczytywanie" />
      ) : blad ? (
        <span className="text-xs text-destructive">nie udało się wczytać listy</span>
      ) : (
        <>
          {watchers.length === 0 && (
            <span className="text-xs text-muted-foreground">tylko zgłaszający</span>
          )}
          {watchers.map(w => (
            <span
              key={w.userId}
              className="inline-flex h-6 items-center gap-1 rounded-md border border-border px-1.5 text-[11px] font-medium leading-none text-muted-foreground"
              title={w.email}
            >
              {podpis(w)}
              <button
                type="button"
                onClick={() => zdejmij(w.userId)}
                disabled={busy}
                aria-label={`Usuń z listy: ${podpis(w)}`}
                className="text-muted-foreground transition-colors hover:text-destructive disabled:opacity-50"
              >
                <X className="h-3 w-3" aria-hidden />
              </button>
            </span>
          ))}

          {doDodania.length > 0 && (
            <DropdownMenu>
              <DropdownMenuTrigger asChild>
                <button
                  type="button"
                  disabled={busy}
                  className="inline-flex h-6 items-center gap-1 rounded-md border border-dashed border-border px-1.5 text-[11px] font-medium leading-none text-muted-foreground transition-colors hover:text-foreground disabled:opacity-50"
                >
                  <Plus className="h-3 w-3" aria-hidden />
                  Dodaj osobę
                </button>
              </DropdownMenuTrigger>
              <DropdownMenuContent align="start">
                {doDodania.map(c => (
                  <DropdownMenuItem key={c.userId} onSelect={() => dodaj(c.userId)}>
                    {podpis(c)}
                  </DropdownMenuItem>
                ))}
              </DropdownMenuContent>
            </DropdownMenu>
          )}
        </>
      )}
    </div>
  )
}
