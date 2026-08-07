'use client'
import { useEffect, useState } from 'react'
import { CheckCircle2, XCircle, ArrowRight } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table'
import { pluralForm, DAYS } from '@/lib/plural'

/**
 * Logi synchronizacji projektu: Track Time i indeks Historii.
 *
 * Powstało, bo do tej pory odpowiedź na pytanie „czy Track Time tego klienta
 * się w ogóle liczy" wymagała wejścia po SSH i zapytania bazy. Cron zwraca
 * wynik w treści odpowiedzi HTTP, a wpis w crontabie kieruje ją do /dev/null.
 *
 * Data ostatniego UDANEGO przebiegu jest u góry, osobno od listy. Gdy ostatnie
 * przebiegi są nieudane, jest to jedyna informacja, która mówi, jak stare dane
 * widzi klient, a z samej listy nie da się jej odczytać.
 */
type Run = {
  id: string
  job: string
  jobLabel: string
  ok: boolean
  itemsProcessed: number
  detail: string | null
  startedAt: string
  finishedAt: string
  durationMs: number
}

/**
 * Zmiana statusu zadania. Dwa zrodla: `webhook` (zespol zmienil w ClickUpie)
 * i `portal` (klient przeciagnal karte). Rozroznienie jest tu wazne, bo
 * odpowiada na pytanie „kto to ruszyl" inaczej niz sam podpis.
 */
type StatusChange = {
  id: string
  clickupTaskId: string
  taskName: string
  fromStatus: string | null
  toStatus: string
  source: string
  actorLabel: string | null
  changedAt: string
}

type Payload = {
  runs: Run[]
  statusy: StatusChange[]
  labels: Record<string, string>
  lastSuccess: Record<string, string | null>
}

/** Ile dni bez udanej synchronizacji uznajemy za zaległość wartą podświetlenia. */
const STALE_DAYS: Record<string, number> = {
  // Track Time zamraża się raz w tygodniu, w piątek rano.
  'time-snapshot': 8,
  // Indeks Historii chodzi codziennie.
  'task-index': 2,
}

function fmtDateTime(iso: string | null): string {
  if (!iso) return 'nigdy'
  const d = new Date(iso)
  return Number.isNaN(d.getTime())
    ? 'nigdy'
    : d.toLocaleString('pl-PL', {
        day: '2-digit',
        month: '2-digit',
        year: 'numeric',
        hour: '2-digit',
        minute: '2-digit',
      })
}

function fmtDuration(ms: number): string {
  if (ms < 1000) return `${ms} ms`
  const s = ms / 1000
  return s < 60 ? `${s.toFixed(1)} s` : `${Math.floor(s / 60)} min ${Math.round(s % 60)} s`
}

/**
 * „0 dni temu" czyta się jak błąd, a nie jak „dzisiaj". Odmiana idzie przez
 * lib/plural.ts, bo „1 dni" i „2 dzień" wyglądają na zepsuty panel.
 */
function kiedy(dni: number): string {
  if (dni < 1) return 'dzisiaj'
  if (dni < 2) return 'wczoraj'
  const n = Math.floor(dni)
  return `${n} ${pluralForm(n, DAYS)} temu`
}

function daysSince(iso: string | null): number | null {
  if (!iso) return null
  const d = new Date(iso)
  if (Number.isNaN(d.getTime())) return null
  return (Date.now() - d.getTime()) / 86_400_000
}

export function ProjectSyncLog({ slug }: { slug: string }) {
  const [data, setData] = useState<Payload | null>(null)
  const [job, setJob] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    let cancelled = false
    const params = new URLSearchParams({ slug })
    if (job) params.set('job', job)

    fetch(`/api/admin/portal-sync?${params}`)
      .then(r => (r.ok ? r.json() : Promise.reject(new Error(String(r.status)))))
      .then((d: Payload) => {
        if (cancelled) return
        setData(d)
        setError(null)
      })
      .catch(() => {
        if (!cancelled) setError('Nie udało się pobrać logów synchronizacji.')
      })

    return () => {
      cancelled = true
    }
  }, [slug, job])

  if (error) return <p className="px-4 py-6 text-xs text-destructive">{error}</p>
  if (!data) return <p className="px-4 py-6 text-xs text-muted-foreground">Ładowanie logów...</p>

  const jobs = Object.keys(data.labels)

  return (
    <div className="space-y-3">
      {/* Ostatnia udana synchronizacja per zadanie. */}
      <div className="grid gap-2 sm:grid-cols-2">
        {jobs.map(j => {
          const last = data.lastSuccess[j] ?? null
          const dni = daysSince(last)
          const zalega = dni === null || dni > (STALE_DAYS[j] ?? 2)
          return (
            <div
              key={j}
              className={`rounded-lg border px-3 py-2 ${
                zalega ? 'border-destructive/40 bg-destructive/5' : 'border-border bg-card'
              }`}
            >
              <p className="text-[10px] uppercase tracking-wide text-muted-foreground">{data.labels[j]}</p>
              <p className={`mt-0.5 text-sm ${zalega ? 'text-destructive' : 'text-foreground'}`}>
                {fmtDateTime(last)}
              </p>
              <p className="text-[10px] text-muted-foreground">
                {dni === null ? 'brak udanego przebiegu' : `ostatni udany przebieg, ${kiedy(dni)}`}
              </p>
            </div>
          )
        })}
      </div>

      <div className="flex flex-wrap items-center gap-1.5">
        <span className="mr-1 text-[10px] uppercase tracking-wide text-muted-foreground">Zadanie</span>
        <Button variant={job === null ? 'secondary' : 'ghost'} size="xs" onClick={() => setJob(null)}>
          Wszystkie
        </Button>
        {jobs.map(j => (
          <Button
            key={j}
            variant={job === j ? 'secondary' : 'ghost'}
            size="xs"
            onClick={() => setJob(j)}
          >
            {data.labels[j]}
          </Button>
        ))}
      </div>

      {data.runs.length === 0 ? (
        <p className="rounded-lg border border-border bg-card px-4 py-6 text-center text-xs text-muted-foreground">
          Brak przebiegów dla tego projektu. Cron zapisuje wpis przy każdym uruchomieniu, więc pusta
          lista oznacza, że nie uruchomił się jeszcze ani razu.
        </p>
      ) : (
        <div className="overflow-hidden rounded-lg border border-border bg-card">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead className="w-8" />
                <TableHead className="w-36">Kiedy</TableHead>
                <TableHead className="w-48">Zadanie</TableHead>
                <TableHead className="w-20 text-right">Zadań</TableHead>
                <TableHead className="w-24 text-right">Czas</TableHead>
                <TableHead>Szczegóły</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {data.runs.map(run => (
                <TableRow key={run.id}>
                  <TableCell>
                    {run.ok ? (
                      <CheckCircle2 className="h-3.5 w-3.5 text-green-500" />
                    ) : (
                      <XCircle className="h-3.5 w-3.5 text-destructive" />
                    )}
                  </TableCell>
                  <TableCell className="whitespace-nowrap text-xs text-muted-foreground">
                    {fmtDateTime(run.finishedAt)}
                  </TableCell>
                  <TableCell className="text-xs text-foreground">{run.jobLabel}</TableCell>
                  <TableCell className="text-right text-xs text-foreground">
                    {run.itemsProcessed}
                  </TableCell>
                  <TableCell className="text-right text-xs text-muted-foreground">
                    {fmtDuration(run.durationMs)}
                  </TableCell>
                  <TableCell className={`text-xs ${run.ok ? 'text-muted-foreground' : 'text-destructive'}`}>
                    <span className="line-clamp-2">{run.detail ?? '—'}</span>
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </div>
      )}

      {/*
        HISTORIA STATUSOW, pod przebiegami crona. Dwie rozne rzeczy w jednym
        widoku, bo obie odpowiadaja na to samo pytanie: „co sie dzialo z tym
        projektem". Przebiegi mowia, czy dane sa swieze; statusy mowia, co sie
        w nich zmienilo.
      */}
      <div className="space-y-2 pt-2">
        <div className="flex items-baseline justify-between">
          <h4 className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
            Zmiany statusów
          </h4>
          <span className="text-[10px] text-muted-foreground">ostatnie 100</span>
        </div>

        {(data.statusy ?? []).length === 0 ? (
          <p className="rounded-lg border border-border bg-card px-4 py-6 text-center text-xs text-muted-foreground">
            Brak zapisanych zmian statusu. Zapisujemy je od chwili wdrożenia tej
            funkcji, więc pusto znaczy „jeszcze nic się nie zmieniło", a nie
            „nie działa".
          </p>
        ) : (
          <div className="overflow-hidden rounded-lg border border-border">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Kiedy</TableHead>
                  <TableHead>Zadanie</TableHead>
                  <TableHead>Zmiana</TableHead>
                  <TableHead>Kto</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {data.statusy.map(z => (
                  <TableRow key={z.id}>
                    <TableCell className="whitespace-nowrap text-xs text-muted-foreground">
                      {fmtDateTime(z.changedAt)}
                    </TableCell>
                    <TableCell className="max-w-[220px] text-xs text-foreground">
                      <span className="line-clamp-1" title={z.taskName}>{z.taskName}</span>
                    </TableCell>
                    <TableCell className="whitespace-nowrap text-xs">
                      {/* Null w `from` znaczy „nie wiemy", a nie „brak statusu",
                          i tak trzeba to pokazac — mysłnik, nie puste miejsce. */}
                      <span className="text-muted-foreground">{z.fromStatus ?? '—'}</span>
                      <ArrowRight className="mx-1 inline h-3 w-3 text-muted-foreground" aria-hidden />
                      <span className="font-medium text-foreground">{z.toStatus}</span>
                    </TableCell>
                    <TableCell className="whitespace-nowrap text-xs text-muted-foreground">
                      {z.actorLabel ?? '—'}
                      <span className="ml-1.5 rounded bg-muted px-1 py-0.5 text-[10px]">
                        {z.source === 'portal' ? 'portal' : 'ClickUp'}
                      </span>
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </div>
        )}
      </div>
    </div>
  )
}
