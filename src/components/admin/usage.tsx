'use client'
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table'

/**
 * Wspólne cegiełki widoków zużycia AI: format liczb, kafelek metryki i tabela
 * rozbicia.
 *
 * Istniały w dwóch kopiach: w `ProjectAiStats` (zużycie jednego projektu) i
 * wprost w `AdminPanel` (zużycie całości). Kopie zdążyły się rozjechać:
 * wersja z panelu rysowała trzy tabele BEZ nagłówków, więc czytnik ekranu
 * podawał same liczby bez informacji, czym są. Ta sama treść w dwóch miejscach
 * zawsze rozjedzie się w tę stronę, w której nikt nie patrzy.
 */

export const fmtNum = (n: number) => Math.round(n).toLocaleString('pl-PL')
export const fmtUsd = (n: number) => '$' + (n < 1 ? n.toFixed(4) : n.toFixed(2))

export function fmtDate(iso: string | null): string {
  if (!iso) return '—'
  const d = new Date(iso)
  return Number.isNaN(d.getTime())
    ? '—'
    : d.toLocaleString('pl-PL', { day: '2-digit', month: '2-digit', year: 'numeric', hour: '2-digit', minute: '2-digit' })
}

export function Metric({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-lg border border-border bg-card p-3">
      <p className="text-xs text-muted-foreground">{label}</p>
      <p className="mt-0.5 text-lg font-semibold tabular-nums text-foreground">{value}</p>
    </div>
  )
}

/**
 * Tabela „nazwa / tokeny / koszt". Nagłówek jest `sr-only`: wzrokowo zbędny,
 * bo kolumny są oczywiste, ale bez niego czytnik ekranu podaje gołe liczby.
 */
export function Breakdown({ title, children }: { title: string; children: React.ReactNode }) {
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

/**
 * Jeden wiersz rozbicia. Wszystkie trzy rozbicia (projekt, użytkownik, model)
 * mają ten sam kształt: etykieta plus tokeny plus koszt.
 */
export function BreakdownRow({
  label,
  title,
  totalTokens,
  costUsd,
}: {
  label: string
  title?: string
  totalTokens: number
  costUsd: number
}) {
  return (
    <TableRow>
      <TableCell className="max-w-[180px] truncate text-foreground" title={title ?? label}>
        {label}
      </TableCell>
      <TableCell className="whitespace-nowrap text-right text-muted-foreground">
        {fmtNum(totalTokens)} tok
      </TableCell>
      <TableCell className="whitespace-nowrap text-right font-medium text-foreground">
        {fmtUsd(costUsd)}
      </TableCell>
    </TableRow>
  )
}
