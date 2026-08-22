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
import { pluralForm } from '@/lib/plural'
import type { EstimateReport } from '@/lib/estimateReport'

/** Rdzeń i czasownik razem, bo "zadań nie MA" a "zadania nie MAJĄ" — różni się nie tylko końcówka. */
const TASKS_WITHOUT_ESTIMATE = {
  one: 'zadanie nie ma',
  few: 'zadania nie mają',
  many: 'zadań nie ma',
}

/**
 * formatDuration zwraca '' dla wartości <= 0 (pomyślana pod czas zalogowany,
 * który nigdy nie jest ujemny). Tu ujemna wartość jest sygnałem, nie błędem —
 * estymacja przekroczona ma być widoczna jako "-2h 30m", nie znikać.
 */
function formatSigned(ms: number): string {
  if (ms === 0) return '0m'
  const sign = ms < 0 ? '-' : ''
  return sign + (formatDuration(Math.abs(ms)) || '0m')
}

export function EstimateReportView({ report }: { report: EstimateReport }) {
  return (
    <div className="mx-auto w-full max-w-4xl px-6 pt-8">
      <h2 className="text-xl font-semibold text-foreground">Pozostała estymacja</h2>
      <p className="mt-1 text-sm text-muted-foreground">
        Ile pracy zostało do zrobienia na zadaniach w do zrobienia, w trakcie i zablokowane —
        estymacja pomniejszona o czas już przepracowany.
      </p>

      <Card className="mt-6">
        <CardContent className="flex items-baseline justify-between py-5">
          <span className="text-sm font-medium text-muted-foreground">Łącznie pozostało</span>
          <span
            className={`text-2xl font-semibold tabular-nums ${
              report.totalRemainingMs < 0 ? 'text-destructive' : 'text-foreground'
            }`}
          >
            {formatSigned(report.totalRemainingMs)}
          </span>
        </CardContent>
      </Card>

      {report.tasksWithoutEstimate > 0 && (
        <p className="mt-2 text-xs text-muted-foreground">
          {report.tasksWithoutEstimate}{' '}
          {pluralForm(report.tasksWithoutEstimate, TASKS_WITHOUT_ESTIMATE)} ustawionej estymacji —
          nie wliczono ich do sumy.
        </p>
      )}

      {report.rows.length === 0 ? (
        <p className="mt-6 rounded-lg border border-border bg-card px-4 py-8 text-center text-sm text-muted-foreground">
          Brak otwartych zadań z estymacją.
        </p>
      ) : (
        <div className="mt-6">
          <Table className="table-fixed">
            <TableHeader>
              <TableRow>
                <TableHead>Zadanie</TableHead>
                <TableHead className="w-28">Status</TableHead>
                <TableHead className="w-20 text-right">Estymacja</TableHead>
                <TableHead className="w-20 text-right">Przepracowane</TableHead>
                <TableHead className="w-24 text-right">Zostało</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {report.rows.map(row => (
                <TableRow key={row.taskId}>
                  <TableCell className="whitespace-normal pr-4 font-medium text-foreground">
                    <a href={row.url} target="_blank" rel="noreferrer" className="hover:underline">
                      {row.name}
                    </a>
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
                  <TableCell className="text-right tabular-nums text-muted-foreground">
                    {formatDuration(row.estimateMs) || '0m'}
                  </TableCell>
                  <TableCell className="text-right tabular-nums text-muted-foreground">
                    {formatDuration(row.spentMs) || '0m'}
                  </TableCell>
                  <TableCell
                    className={`text-right tabular-nums font-medium ${
                      row.remainingMs < 0 ? 'text-destructive' : 'text-foreground'
                    }`}
                  >
                    {formatSigned(row.remainingMs)}
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </div>
      )}
    </div>
  )
}
