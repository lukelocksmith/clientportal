'use client'
import { BarChart3 } from 'lucide-react'
import { Breakdown, BreakdownRow, Metric, fmtNum, fmtUsd } from '@/components/admin/usage'

/**
 * Zużycie AI dla CAŁOŚCI: sumy plus rozbicie na projekty, użytkowników i modele.
 *
 * Ten sam widok dla jednego projektu rysuje `ProjectAiStats`. Obie wersje
 * korzystają z tych samych cegiełek w `usage.tsx`; wcześniej ta była wpisana
 * wprost w `AdminPanel`, powtarzała markup tabeli trzy razy i rysowała go BEZ
 * nagłówków, w przeciwieństwie do swojej bliźniaczki.
 */
type Stat = { totalTokens: number; costUsd: number }

interface Props {
  totals: { calls: number; inputTokens: number; outputTokens: number; totalTokens: number; costUsd: number }
  byProject: Array<Stat & { portalId: string; slug: string | null; name: string | null }>
  byUser: Array<Stat & { userEmail: string | null }>
  byModel: Array<Stat & { provider: string; model: string }>
}

export function AiUsageStats({ totals, byProject, byUser, byModel }: Props) {
  return (
    <section>
      <div className="flex items-center gap-2 mb-3">
        <BarChart3 className="h-4 w-4 text-primary" />
        <h2 className="font-semibold text-foreground">Zużycie AI (czat „nowe zadanie”)</h2>
        <span className="text-xs text-muted-foreground ml-auto">koszty szacunkowe wg cennika</span>
      </div>

      <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 mb-4">
        <Metric label="Zapytania" value={fmtNum(totals.calls)} />
        <Metric label="Tokeny (razem)" value={fmtNum(totals.totalTokens)} />
        <Metric
          label="Input / Output"
          value={`${fmtNum(totals.inputTokens)} / ${fmtNum(totals.outputTokens)}`}
        />
        <Metric label="Koszt" value={fmtUsd(totals.costUsd)} />
      </div>

      <div className="grid md:grid-cols-3 gap-4">
        <Breakdown title="Wg projektu">
          {byProject.map(r => (
            <BreakdownRow
              key={r.portalId}
              label={r.name ?? r.slug ?? '—'}
              totalTokens={r.totalTokens}
              costUsd={r.costUsd}
            />
          ))}
        </Breakdown>

        <Breakdown title="Wg użytkownika">
          {byUser.map((r, i) => (
            <BreakdownRow
              key={r.userEmail ?? i}
              label={r.userEmail ?? '—'}
              totalTokens={r.totalTokens}
              costUsd={r.costUsd}
            />
          ))}
        </Breakdown>

        <Breakdown title="Wg modelu">
          {byModel.map((r, i) => (
            <BreakdownRow
              key={`${r.provider}/${r.model}` + i}
              label={r.model}
              title={`${r.provider}/${r.model}`}
              totalTokens={r.totalTokens}
              costUsd={r.costUsd}
            />
          ))}
        </Breakdown>
      </div>
    </section>
  )
}
