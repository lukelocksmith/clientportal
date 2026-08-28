import Link from 'next/link'
import { Card, CardContent } from '@/components/ui/card'
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table'
import { formatDuration, getStatusColor } from '@/lib/utils'
import { kwotaNettoGrosze, formatujZl, formatujStawke } from '@/lib/money'
import { mergeReports, type MergedReport } from '@/lib/reportMerge'
import { PeriodPicker } from './PeriodPicker'
import type { PortalBranding } from '@/lib/branding'
import type { Period, PeriodKind, TimeReport } from '@/lib/timeReports'
import type { EstimateReport } from '@/lib/estimateReport'

interface ReportViewProps {
  slug: string
  kind: PeriodKind
  /**
   * Stawka NETTO w groszach. `null` znaczy „nie znamy" i wtedy raport pokazuje
   * SAME GODZINY, bez kwoty. Zgadnięta kwota obok faktury byłaby gorsza niż
   * jej brak (patrz lib/money.ts).
   */
  hourlyRateNet?: number | null
  periods: Period[]
  period: Period
  /** null oznacza, że ClickUp nie odpowiedział. */
  report: TimeReport | null
  /** Pozostała estymacja. `null`, gdy funkcja jest wyłączona dla projektu. */
  estimateReport?: EstimateReport | null
  olderKey: string | null
  newerKey: string | null
  branding: PortalBranding
}

/** Godziny nad podpisem, w jednym rozmiarze dla wszystkich kafli. */
function Kafel({
  label, value, hint, akcent = false,
}: {
  label: string
  value: string
  hint?: React.ReactNode
  akcent?: boolean
}) {
  return (
    <Card>
      <CardContent className="py-4">
        <p className="text-xs font-medium uppercase tracking-wide text-muted-foreground">{label}</p>
        <p className={`mt-1 text-2xl font-semibold tabular-nums ${akcent ? 'text-destructive' : 'text-foreground'}`}>
          {value}
        </p>
        {hint && <div className="mt-1 text-xs text-muted-foreground">{hint}</div>}
      </CardContent>
    </Card>
  )
}

export function ReportView({
  slug,
  kind,
  hourlyRateNet = null,
  periods,
  period,
  report,
  estimateReport = null,
  olderKey,
  newerKey,
  branding,
}: ReportViewProps) {
  // Liczymy z sumy CAŁEGO raportu (zadania + narzut), czyli z tej samej
  // liczby, którą klient widzi jako sumę okresu. Suma kolumny „W okresie"
  // równa się tej wartości, bo czas jest kwantowany u źródła (timeReports.ts).
  const kwotaNetto = report ? kwotaNettoGrosze(report.totalMs, hourlyRateNet) : null
  const scalony: MergedReport = mergeReports(report, estimateReport)
  const maEstymacje = estimateReport !== null

  return (
    <div className="mx-auto w-full max-w-5xl px-6 py-8">
      <h2 className="text-xl font-semibold text-foreground">Czas i budżet</h2>
      <p className="mt-1 text-sm text-muted-foreground">
        Czas zalogowany w wybranym okresie i praca, która jeszcze czeka na otwartych zadaniach.
      </p>

      <div className="mt-6">
        <PeriodPicker
          branding={branding}
          slug={slug}
          kind={kind}
          period={period}
          periods={periods}
          olderKey={olderKey}
          newerKey={newerKey}
        />
      </div>

      {report === null ? (
        <Card className="mt-6">
          <CardContent className="py-8 text-center">
            <p className="text-sm text-foreground">Nie udało się pobrać danych o czasie pracy.</p>
            <p className="mt-1 text-sm text-muted-foreground">
              Spróbuj ponownie za chwilę. Jeśli to się powtarza, kliknij Alarm na tablicy.
            </p>
            <Link
              href={`/${slug}/raporty?typ=${kind}&okres=${period.key}`}
              className="mt-4 inline-flex rounded-md bg-primary px-3 py-1.5 text-sm font-medium text-primary-foreground hover:bg-primary/90 transition-colors"
            >
              Spróbuj ponownie
            </Link>
          </CardContent>
        </Card>
      ) : (
        <>
          {/* TRZY LICZBY NA GÓRZE, w kolejności pytania, które zadaje klient:
              ile już poszło (to jest faktura), ile jeszcze zostało zaplanowane,
              i jak bardzo zjedliśmy estymatę. Klient WDF pyta o dokładnie to
              na cotygodniowych spotkaniach (17 i 21.07: budżet miesięczny,
              „przepracowane kontra estymacja"). Wcześniej te liczby były
              w dwóch osobnych sekcjach, jedna pod drugą, i nie składały się
              w obraz. */}
          <div className={`mt-6 grid gap-3 ${maEstymacje ? 'sm:grid-cols-3' : 'sm:grid-cols-1'}`}>
            <Kafel
              label={kind === 'tydzien' ? 'W tym tygodniu' : 'W tym miesiącu'}
              value={formatDuration(scalony.periodTotalMs) || '0m'}
              hint={
                kwotaNetto !== null ? (
                  <>
                    {/* „netto" jest przy kwocie NA STAŁE. Raport leży obok
                        faktury z VAT-em jako osobną pozycją, więc kwota bez
                        podpisu dawałaby się przeczytać jako brutto. */}
                    <span className="font-medium text-foreground">{formatujZl(kwotaNetto)}</span>
                    {' netto · '}
                    {formatujStawke(hourlyRateNet!)}
                  </>
                ) : undefined
              }
            />

            {maEstymacje && (
              <>
                <Kafel
                  label="Zostało w planie"
                  value={formatDuration(scalony.remainingMs) || '0m'}
                  akcent={scalony.remainingMs < 0}
                  hint={
                    scalony.tasksWithoutEstimate > 0
                      ? `${scalony.tasksWithoutEstimate} zadań bez estymacji, poza tą liczbą`
                      : 'zadania w toku, do zrobienia i zablokowane'
                  }
                />
                <Kafel
                  label="Zużyta estymata"
                  value={scalony.usagePct === null ? '—' : `${scalony.usagePct}%`}
                  akcent={scalony.usagePct !== null && scalony.usagePct > 100}
                  hint={
                    scalony.usagePct === null
                      ? 'brak estymacji na otwartych zadaniach'
                      : `${formatDuration(scalony.spentOpenMs) || '0m'} z ${formatDuration(scalony.estimateOpenMs)}`
                  }
                />
              </>
            )}
          </div>

          {scalony.rows.length === 0 ? (
            <p className="mt-6 rounded-lg border border-border bg-card px-4 py-8 text-center text-sm text-muted-foreground">
              W tym okresie nie zalogowano czasu.
            </p>
          ) : (
            /* JEDNA tabela zamiast dwóch. Zadanie, które ma i czas w okresie,
               i estymację, jest tu JEDNYM wierszem — wcześniej stało w dwóch
               listach na tym samym ekranie. Wąskie ekrany przewijają tabelę
               w poziomie zamiast łamać kolumny. */
            <div className="mt-6 overflow-x-auto">
              <Table className="min-w-[720px] table-fixed">
                <TableHeader>
                  <TableRow>
                    <TableHead>Zadanie</TableHead>
                    <TableHead className="w-28">Status</TableHead>
                    <TableHead className="w-24 text-right">W okresie</TableHead>
                    {maEstymacje && <TableHead className="w-24 text-right">Estymacja</TableHead>}
                    {maEstymacje && <TableHead className="w-24 text-right">Zostało</TableHead>}
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {scalony.rows.map(row => (
                    <TableRow key={row.taskId}>
                      <TableCell className="whitespace-normal pr-4 font-medium text-foreground">
                        {row.name}
                      </TableCell>
                      <TableCell>
                        <span
                          className="inline-flex rounded-full px-2 py-0.5 text-xs font-medium"
                          style={{
                            backgroundColor: `${getStatusColor(row.status)}1f`,
                            color: getStatusColor(row.status),
                          }}
                        >
                          {row.status}
                        </span>
                      </TableCell>
                      <TableCell className="text-right tabular-nums text-foreground">
                        {/* Myślnik, nie „0m": zadanie otwarte, którego w tym
                            okresie nie ruszano, to brak wpisu, a nie zero minut
                            pracy w ogóle. */}
                        {row.periodMs > 0 ? formatDuration(row.periodMs) : <span className="text-muted-foreground">—</span>}
                      </TableCell>
                      {maEstymacje && (
                        <TableCell className="text-right tabular-nums text-muted-foreground">
                          {row.estimateMs === null ? '—' : formatDuration(row.estimateMs)}
                        </TableCell>
                      )}
                      {maEstymacje && (
                        <TableCell
                          className={`text-right tabular-nums ${
                            row.remainingMs !== null && row.remainingMs < 0 ? 'text-destructive' : 'text-foreground'
                          }`}
                        >
                          {/* Przekroczona estymacja zostaje UJEMNA. To jest
                              sygnał do rozmowy, a obcięcie do zera schowałoby
                              dokładnie tę informację, dla której ta kolumna
                              istnieje. */}
                          {row.remainingMs === null
                            ? '—'
                            : `${row.remainingMs < 0 ? '-' : ''}${formatDuration(Math.abs(row.remainingMs)) || '0m'}`}
                        </TableCell>
                      )}
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </div>
          )}
        </>
      )}
    </div>
  )
}
