'use client'
import { useEffect, useState } from 'react'
import { CheckCircle2, XCircle, AlertTriangle, RefreshCw } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table'

/**
 * Log diagnostyczny SitePinga w karcie projektu.
 *
 * Odpowiada na jedno pytanie, ktore dzis nie ma odpowiedzi poza wejsciem na
 * serwer: „czemu klientowi nie dochodza zgloszenia". Dlatego DOMYSLNIE
 * pokazuje odmowy, a nie wszystko: udane odczyty panelu widgetu (GET) sa
 * najczestszym zdarzeniem i przy pelnym widoku zaslonilyby jedyne wiersze,
 * dla ktorych ktokolwiek tu zaglada.
 *
 * Kod HTTP jest w wierszu, ale nie jest odpowiedzia. „403" nie mowi, co
 * zrobic; „zgloszenie z niedozwolonej domeny" prowadzi wprost do pola z
 * domenami o dwie sekcje wyzej.
 */
type Entry = {
  id: string
  createdAt: string
  method: string
  status: number
  outcome: string
  origin: string | null
  ipPrefix: string | null
  durationMs: number | null
  clickupTaskId: string | null
  detail: string | null
}

type Summary = {
  days: number
  byOutcome: Array<{ outcome: string; ile: number; ostatni: string | null }>
  lastFeedbackAt: string | null
}

/** Nazwa wyniku po polsku plus zdanie mowiace, gdzie szukac przyczyny. */
const WYNIKI: Record<string, { label: string; hint: string; zly: boolean }> = {
  ok: { label: 'Przyjęte', hint: 'żądanie przeszło', zly: false },
  origin_not_allowed: {
    label: 'Zgłoszenie z niedozwolonej domeny',
    hint: 'domeny tej strony nie ma na liście w konfiguracji',
    zly: true,
  },
  rate_limited: {
    label: 'Odbite limitem',
    hint: 'z tego adresu przyszło za dużo żądań w minutę',
    zly: true,
  },
  invalid_payload: {
    label: 'Odrzucony ładunek',
    hint: 'widget przysłał dane, których nie przyjmuje walidacja',
    zly: true,
  },
  misconfigured: {
    label: 'Niepełna konfiguracja',
    hint: 'przełącznik, domeny albo lista ClickUp',
    zly: true,
  },
  error: { label: 'Błąd', hint: 'najczęściej odpowiedź ClickUpa', zly: true },
}

function opis(outcome: string) {
  return WYNIKI[outcome] ?? { label: outcome, hint: '', zly: true }
}

function fmt(iso: string | null): string {
  if (!iso) return '—'
  const d = new Date(iso)
  return Number.isNaN(d.getTime())
    ? '—'
    : d.toLocaleString('pl-PL', {
        day: '2-digit',
        month: '2-digit',
        hour: '2-digit',
        minute: '2-digit',
      })
}

export function SitepingLog({ slug }: { slug: string }) {
  const [entries, setEntries] = useState<Entry[]>([])
  const [summary, setSummary] = useState<Summary | null>(null)
  const [tylkoProblemy, setTylkoProblemy] = useState(true)
  const [odswiezenie, setOdswiezenie] = useState(0)
  const [loading, setLoading] = useState(true)
  const [blad, setBlad] = useState<string | null>(null)

  // Pobranie SIEDZI W EFEKCIE, a nie w funkcji wolanej z efektu: ustawienie
  // stanu synchronicznie w efekcie wywoluje kaskade renderow (i jest bledem
  // lintera). Ponowne pobranie wywoluje sie zmiana `odswiezenie`, a wskaznik
  // ladowania zapala obsluga klikniecia, czyli miejsce, w ktorym wolno.
  useEffect(() => {
    let porzucone = false
    const only = tylkoProblemy ? '&only=problems' : ''

    fetch(`/api/admin/siteping/log?slug=${encodeURIComponent(slug)}${only}`)
      .then(r => (r.ok ? r.json() : Promise.reject(new Error(String(r.status)))))
      .then((dane: { entries: Entry[]; summary: Summary }) => {
        if (porzucone) return
        setEntries(dane.entries ?? [])
        setSummary(dane.summary ?? null)
        setBlad(null)
        setLoading(false)
      })
      .catch(() => {
        if (porzucone) return
        setBlad('Nie udało się pobrać logu diagnostycznego.')
        setLoading(false)
      })

    return () => {
      porzucone = true
    }
  }, [slug, tylkoProblemy, odswiezenie])

  const problemow = (summary?.byOutcome ?? [])
    .filter(w => w.outcome !== 'ok')
    .reduce((suma, w) => suma + Number(w.ile), 0)

  return (
    <div className="space-y-2 border-t border-border px-4 py-3">
      <div className="flex flex-wrap items-center gap-2">
        <span className="text-[10px] uppercase tracking-wide text-muted-foreground">
          Log diagnostyczny
        </span>
        <Button
          variant="outline"
          size="xs"
          className="ml-auto"
          onClick={() => {
            setLoading(true)
            setTylkoProblemy(t => !t)
          }}
        >
          {tylkoProblemy ? 'Pokaż wszystkie żądania' : 'Pokaż tylko problemy'}
        </Button>
        <Button
          variant="ghost"
          size="xs"
          disabled={loading}
          onClick={() => {
            setLoading(true)
            setOdswiezenie(n => n + 1)
          }}
        >
          <RefreshCw className={`h-3.5 w-3.5 ${loading ? 'animate-spin' : ''}`} aria-hidden />
          Odśwież
        </Button>
      </div>

      <p className="text-[11px] leading-snug text-muted-foreground">
        Każde żądanie z widgetu na stronie klienta, także odrzucone. Wpisy starsze niż{' '}
        {summary?.days ?? 30} dni są kasowane, a adresy IP zapisujemy skrócone do trzech oktetów.
        {summary && (
          <>
            {' '}
            Ostatnie przyjęte zgłoszenie: <span className="text-foreground">{fmt(summary.lastFeedbackAt)}</span>.
            {problemow > 0 && (
              <span className="ml-1 text-destructive">Odrzuconych żądań: {problemow}.</span>
            )}
          </>
        )}
      </p>

      {blad && <p className="text-xs text-destructive">{blad}</p>}

      {!blad && !loading && entries.length === 0 && (
        <p className="rounded-lg border border-border bg-card px-4 py-6 text-center text-xs text-muted-foreground">
          Brak wpisów.{' '}
          {tylkoProblemy
            ? 'Żadne żądanie z widgetu nie zostało odrzucone.'
            : 'Z tej strony nie przyszło jeszcze żadne żądanie — sprawdź, czy widget jest osadzony.'}
        </p>
      )}

      {!blad && entries.length > 0 && (
        <div className="overflow-hidden rounded-lg border border-border bg-card">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead className="w-8" />
                <TableHead className="w-28">Kiedy</TableHead>
                <TableHead className="w-16">Metoda</TableHead>
                <TableHead className="w-64">Wynik</TableHead>
                <TableHead>Skąd</TableHead>
                <TableHead className="w-40">Szczegóły</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {entries.map(w => {
                const { label, hint, zly } = opis(w.outcome)
                return (
                  <TableRow key={w.id}>
                    <TableCell>
                      {!zly ? (
                        <CheckCircle2 className="h-3.5 w-3.5 text-green-500" aria-label="przyjęte" />
                      ) : w.outcome === 'error' ? (
                        <XCircle className="h-3.5 w-3.5 text-destructive" aria-label="błąd" />
                      ) : (
                        <AlertTriangle className="h-3.5 w-3.5 text-amber-500" aria-label="odrzucone" />
                      )}
                    </TableCell>
                    <TableCell className="whitespace-nowrap text-xs text-muted-foreground">
                      {fmt(w.createdAt)}
                    </TableCell>
                    <TableCell className="text-xs text-muted-foreground">{w.method}</TableCell>
                    <TableCell className="text-xs">
                      <span className={zly ? 'text-foreground' : 'text-muted-foreground'}>
                        {label}
                      </span>
                      <span className="ml-1 text-[11px] text-muted-foreground">
                        ({w.status}) {hint}
                      </span>
                    </TableCell>
                    <TableCell className="text-xs text-muted-foreground">
                      <span className="block truncate font-mono text-[11px]">{w.origin ?? '—'}</span>
                      {/* Sufiks `.x` jest czescia komunikatu: mowi, ze to prefiks,
                          a nie adres konkretnej maszyny. */}
                      <span className="text-[10px]">{w.ipPrefix ? `${w.ipPrefix}.x` : '—'}</span>
                    </TableCell>
                    <TableCell className="text-xs text-muted-foreground">
                      {w.clickupTaskId && (
                        <span className="block font-mono text-[11px] text-foreground">
                          {w.clickupTaskId}
                        </span>
                      )}
                      {w.detail && <span className="line-clamp-2 text-[11px]">{w.detail}</span>}
                      {!w.clickupTaskId && !w.detail && '—'}
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
