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
import { PeriodPicker } from './PeriodPicker'
import type { Period, PeriodKind, TimeReport } from '@/lib/timeReports'

interface ReportViewProps {
  slug: string
  kind: PeriodKind
  periods: Period[]
  period: Period
  /** null oznacza, że ClickUp nie odpowiedział. */
  report: TimeReport | null
  olderKey: string | null
  newerKey: string | null
}

export function ReportView({
  slug,
  kind,
  periods,
  period,
  report,
  olderKey,
  newerKey,
}: ReportViewProps) {
  return (
    <div className="mx-auto w-full max-w-4xl px-6 py-8">
      <h2 className="text-xl font-semibold text-foreground">Raport czasu pracy</h2>
      <p className="mt-1 text-sm text-muted-foreground">
        Czas zalogowany na Twoich zadaniach w zamkniętym okresie.
      </p>

      <div className="mt-6">
        <PeriodPicker
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
          <Card className="mt-6">
            <CardContent className="flex items-baseline justify-between py-5">
              <span className="text-sm font-medium text-muted-foreground">Łącznie</span>
              <span className="text-2xl font-semibold tabular-nums text-foreground">
                {formatDuration(report.totalMs) || '0m'}
              </span>
            </CardContent>
          </Card>

          {report.rows.length === 0 ? (
            <p className="mt-6 rounded-lg border border-border bg-card px-4 py-8 text-center text-sm text-muted-foreground">
              W tym okresie nie zalogowano czasu.
            </p>
          ) : (
            <div className="mt-6">
              {/* table-fixed plus whitespace-normal na nazwie: bez tego domyślny
                  whitespace-nowrap z shadcn rozpycha tabelę długą nazwą pozycji
                  narzutu i wypycha kolumny Status oraz Czas za krawędź ekranu. */}
              <Table className="table-fixed">
                <TableHeader>
                  <TableRow>
                    <TableHead>Zadanie</TableHead>
                    <TableHead className="w-28">Status</TableHead>
                    <TableHead className="w-20 text-right">Czas</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {report.rows.map(row => (
                    <TableRow key={row.taskId}>
                      <TableCell className="whitespace-normal pr-4 font-medium text-foreground">
                        {row.taskName}
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
                        {formatDuration(row.durationMs)}
                      </TableCell>
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
