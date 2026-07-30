'use client'
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table'

/**
 * Zużycie AI w obrębie JEDNEGO projektu: podsumowanie, rozbicie na
 * użytkowników i na modele.
 *
 * Dane przychodzą z jednego zapytania do /api/admin/stats i są tu tylko
 * filtrowane po `portalId`. Osobny endpoint per projekt byłby złożonością bez
 * zysku: przy kilkunastu portalach całość to kilkadziesiąt wierszy.
 *
 * Koszty są SZACUNKOWE, liczone z cennika w lib/aiPricing.ts, i tak są
 * podpisane. To liczba do naszej oceny, nie do faktury dla klienta.
 */
export type UsageRow = {
  calls: number
  inputTokens: number
  outputTokens: number
  totalTokens: number
  costUsd: number
}

interface Props {
  portalId: string
  byProject: Array<UsageRow & { portalId: string; lastUsedAt: string | null }>
  byProjectUser: Array<UsageRow & { portalId: string; userEmail: string | null }>
  byProjectModel: Array<UsageRow & { portalId: string; provider: string; model: string }>
}

const fmtNum = (n: number) => Math.round(n).toLocaleString('pl-PL')
const fmtUsd = (n: number) => '$' + (n < 1 ? n.toFixed(4) : n.toFixed(2))

function fmtDate(iso: string | null): string {
  if (!iso) return '—'
  const d = new Date(iso)
  return Number.isNaN(d.getTime())
    ? '—'
    : d.toLocaleString('pl-PL', { day: '2-digit', month: '2-digit', year: 'numeric', hour: '2-digit', minute: '2-digit' })
}

export function ProjectAiStats({ portalId, byProject, byProjectUser, byProjectModel }: Props) {
  const total = byProject.find(r => r.portalId === portalId)
  const users = byProjectUser.filter(r => r.portalId === portalId)
  const models = byProjectModel.filter(r => r.portalId === portalId)

  if (!total || total.calls === 0) {
    return (
      <p className="px-4 py-8 text-center text-sm text-muted-foreground">
        W tym projekcie nikt jeszcze nie korzystał z czatu AI.
      </p>
    )
  }

  return (
    <div className="space-y-4 p-4">
      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
        <Metric label="Zapytania" value={fmtNum(total.calls)} />
        <Metric label="Tokeny (razem)" value={fmtNum(total.totalTokens)} />
        <Metric
          label="Input / Output"
          value={`${fmtNum(total.inputTokens)} / ${fmtNum(total.outputTokens)}`}
        />
        <Metric label="Koszt (szacunkowo)" value={fmtUsd(total.costUsd)} />
      </div>

      <p className="text-xs text-muted-foreground">
        Ostatnie użycie: {fmtDate(total.lastUsedAt)}
      </p>

      <div className="grid gap-4 lg:grid-cols-2">
        <Breakdown title="Wg użytkownika">
          {users.map((r, i) => (
            <TableRow key={(r.userEmail ?? 'brak') + i}>
              <TableCell className="max-w-[180px] truncate text-foreground" title={r.userEmail ?? ''}>
                {/* userEmail jest zdenormalizowany, żeby statystyki przetrwały
                    usunięcie konta. Null znaczy, że wpis powstał przed tą zmianą. */}
                {r.userEmail ?? 'nieznany'}
              </TableCell>
              <TableCell className="whitespace-nowrap text-right text-muted-foreground">
                {fmtNum(r.totalTokens)} tok
              </TableCell>
              <TableCell className="whitespace-nowrap text-right font-medium text-foreground">
                {fmtUsd(r.costUsd)}
              </TableCell>
            </TableRow>
          ))}
        </Breakdown>

        <Breakdown title="Wg modelu">
          {models.map((r, i) => (
            <TableRow key={`${r.provider}/${r.model}${i}`}>
              <TableCell
                className="max-w-[180px] truncate text-foreground"
                title={`${r.provider}/${r.model}`}
              >
                {r.model}
              </TableCell>
              <TableCell className="whitespace-nowrap text-right text-muted-foreground">
                {fmtNum(r.totalTokens)} tok
              </TableCell>
              <TableCell className="whitespace-nowrap text-right font-medium text-foreground">
                {fmtUsd(r.costUsd)}
              </TableCell>
            </TableRow>
          ))}
        </Breakdown>
      </div>
    </div>
  )
}

function Metric({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-lg border border-border bg-card p-3">
      <p className="text-xs text-muted-foreground">{label}</p>
      <p className="mt-0.5 text-lg font-semibold tabular-nums text-foreground">{value}</p>
    </div>
  )
}

function Breakdown({ title, children }: { title: string; children: React.ReactNode }) {
  const rows = Array.isArray(children) ? children : [children]
  return (
    <div className="overflow-hidden rounded-lg border border-border">
      <p className="border-b border-border bg-muted/40 px-3 py-2 text-xs font-medium text-muted-foreground">
        {title}
      </p>
      {rows.length === 0 ? (
        <p className="p-3 text-xs text-muted-foreground">Brak danych</p>
      ) : (
        <Table className="text-xs">
          <TableHeader className="sr-only">
            <TableRow>
              <TableHead>Pozycja</TableHead>
              <TableHead>Tokeny</TableHead>
              <TableHead>Koszt</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>{children}</TableBody>
        </Table>
      )}
    </div>
  )
}
