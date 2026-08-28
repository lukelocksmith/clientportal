import type { SiteStatus as SiteStatusModel } from '@/lib/monitoring'

/**
 * „Stan strony" na Dashboardzie: dostępność, testy, szybkość ładowania.
 *
 * Trzy zasady, które trzymają ten widok uczciwym:
 *
 * 1. BRAK DANYCH MÓWI, ŻE ICH NIE MA. Nigdy zera ani stu procent „na wszelki
 *    wypadek": „0%" czyta się jak „strona nie działa", a „100%" jak obietnica.
 * 2. OKNO JEST PODPISANE. „99,4%" bez okresu jest bez znaczenia; przy trzydziestu
 *    dniach klient wie, co porównuje.
 * 3. CZAS ODPOWIEDZI TO NIE SZYBKOŚĆ ŁADOWANIA. Pierwsze mierzy serwer (setki
 *    milisekund), drugie przeglądarkę składającą stronę (sekundy). Stoją
 *    w osobnych kaflach i pod osobnymi nazwami.
 *
 * Sekcja jest za flagą `monitoringEnabled`, bo pokazanie dostępności jest
 * zobowiązaniem: klient zobaczy nasze przerwy pierwszy.
 */

function Kafel({
  label, value, hint, ton = 'zwykly',
}: {
  label: string
  value: string
  hint: string
  ton?: 'zwykly' | 'dobry' | 'zly' | 'nieznany'
}) {
  const kolor = {
    zwykly: 'text-foreground',
    dobry: 'text-foreground',
    zly: 'text-destructive',
    nieznany: 'text-muted-foreground',
  }[ton]
  return (
    <div className="rounded-lg border border-border bg-card px-4 py-3">
      <p className="text-xs font-medium uppercase tracking-wide text-muted-foreground">{label}</p>
      <p className={`mt-1 text-2xl font-semibold tabular-nums ${kolor}`}>{value}</p>
      <p className="mt-1 text-xs text-muted-foreground">{hint}</p>
    </div>
  )
}

const BRAKI: Record<NonNullable<SiteStatusModel['powod']>, string> = {
  'brak-tokenu': 'Projekt nie jest jeszcze podpięty do monitoringu.',
  'brak-domen': 'Nie mamy zapisanej domeny tego projektu.',
  'brak-monitorow': 'Dla tej domeny nie mamy jeszcze żadnej czujki.',
  blad: 'Nie udało się pobrać danych o stanie strony.',
}

/** Data w formie „28 sie, 19:40". Bez sekund, bo to nie jest log. */
function kiedy(iso: string | null): string {
  if (!iso) return 'brak daty'
  const d = new Date(iso)
  if (Number.isNaN(d.getTime())) return 'brak daty'
  return d.toLocaleString('pl-PL', { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' })
}

export function SiteStatus({ status }: { status: SiteStatusModel }) {
  const { uptime, tests, speed, powod } = status
  const pusto = !uptime && !tests && !speed

  return (
    <section className="mt-4 rounded-xl border border-border bg-card p-5">
      <h2 className="text-sm font-semibold text-foreground">Stan strony</h2>
      <p className="mt-1 text-sm text-muted-foreground">
        Co widzą nasze czujki: czy strona odpowiada, czy testy przechodzą i jak szybko się ładuje.
      </p>

      {pusto ? (
        <p className="mt-4 text-sm text-muted-foreground">{powod ? BRAKI[powod] : BRAKI.blad}</p>
      ) : (
        <div className="mt-4 grid gap-3 sm:grid-cols-2 md:grid-cols-3">
          <Kafel
            label="Dostępność"
            value={uptime ? `${uptime.percent.toLocaleString('pl-PL')}%` : '—'}
            ton={uptime ? (uptime.down ? 'zly' : 'dobry') : 'nieznany'}
            hint={
              uptime
                ? `${uptime.days} dni, ${uptime.monitors === 1 ? '1 czujka' : `${uptime.monitors} czujki`}` +
                  (uptime.down ? ' · teraz nie odpowiada' : '') +
                  (uptime.p95Ms ? ` · odpowiedź do ${uptime.p95Ms} ms` : '')
                : 'brak pomiaru'
            }
          />

          <Kafel
            label="Testy"
            value={tests ? (tests.status === 'passed' ? 'przeszły' : tests.status === 'failed' ? 'błąd' : tests.status) : '—'}
            ton={tests ? (tests.status === 'passed' ? 'dobry' : 'zly') : 'nieznany'}
            hint={
              tests
                ? `${tests.jobName} · ${kiedy(tests.at)}` + (tests.testCount ? ` · ${tests.testCount} scenariuszy` : '')
                : 'brak przebiegu dla tego projektu'
            }
          />

          <Kafel
            label="Szybkość ładowania"
            value={speed ? `${speed.score}/100` : '—'}
            ton={speed ? (speed.score >= 50 ? 'dobry' : 'zly') : 'nieznany'}
            hint={
              speed
                ? `telefon${speed.lcpMs ? ` · treść widoczna po ${(speed.lcpMs / 1000).toFixed(1)} s` : ''} · ${kiedy(speed.measuredAt)}`
                : 'pomiar jeszcze nieskonfigurowany'
            }
          />
        </div>
      )}
    </section>
  )
}
