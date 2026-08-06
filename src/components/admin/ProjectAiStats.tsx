'use client'
import { Breakdown, BreakdownRow, Metric, fmtDate, fmtNum, fmtUsd } from '@/components/admin/usage'

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
 *
 * Wspólne cegiełki (format, kafelek, tabela) są w `usage.tsx`, bo ten sam widok
 * dla CAŁOŚCI rysuje `AiUsageStats`.
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
            // userEmail jest zdenormalizowany, żeby statystyki przetrwały
            // usunięcie konta. Null znaczy, że wpis powstał przed tą zmianą.
            <BreakdownRow
              key={(r.userEmail ?? 'brak') + i}
              label={r.userEmail ?? 'nieznany'}
              title={r.userEmail ?? ''}
              totalTokens={r.totalTokens}
              costUsd={r.costUsd}
            />
          ))}
        </Breakdown>

        <Breakdown title="Wg modelu">
          {models.map((r, i) => (
            <BreakdownRow
              key={`${r.provider}/${r.model}${i}`}
              label={r.model}
              title={`${r.provider}/${r.model}`}
              totalTokens={r.totalTokens}
              costUsd={r.costUsd}
            />
          ))}
        </Breakdown>
      </div>
    </div>
  )
}
