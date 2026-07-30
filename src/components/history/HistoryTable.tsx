'use client'
import { useCallback, useState } from 'react'
import { Paperclip, MessageSquare, CornerDownRight, Loader2 } from 'lucide-react'
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table'
import { StatusBadge } from '@/components/StatusBadge'
import { TaskDrawer } from '@/components/kanban/TaskDrawer'
import { toast } from 'sonner'
import { getPriorityLabel } from '@/lib/utils'
import type { HistoryRow } from '@/lib/taskIndex'
import type { ClickUpTask } from '@/lib/types'

/**
 * Tabela zgłoszeń. Klient, nie serwer, wyłącznie z powodu kliknięcia w wiersz:
 * otwiera ten sam TaskDrawer co kanban. Filtry powyżej są linkami i zostają
 * serwerowe, więc jedyny stan tutaj to wybrane zadanie.
 *
 * Dlaczego wiersz nie zawiera od razu pełnego zadania: indeks trzyma chudą
 * projekcję, bez komentarzy, załączników i opisu w markdownie. Drawer chce
 * pełnego ClickUpTask, więc dociągamy go na kliknięcie przez istniejący
 * endpoint, który zwraca też załączniki.
 */
interface HistoryTableProps {
  rows: HistoryRow[]
  slug: string
  userEmail: string
}

function formatAdded(ms: number): string {
  if (!ms) return '—'
  return new Date(ms).toLocaleDateString('pl-PL', {
    day: '2-digit',
    month: '2-digit',
    year: 'numeric',
  })
}

export function HistoryTable({ rows, slug, userEmail }: HistoryTableProps) {
  const [task, setTask] = useState<ClickUpTask | null>(null)
  const [loadingId, setLoadingId] = useState<string | null>(null)

  const open = useCallback(
    async (taskId: string) => {
      setLoadingId(taskId)
      try {
        const res = await fetch(`/api/clickup/tasks/${taskId}?slug=${encodeURIComponent(slug)}`)
        if (!res.ok) {
          // Historia czyta z lustra, więc zadanie mogło zostać w ClickUpie
          // usunięte albo przeniesione po ostatniej synchronizacji. Wcześniej
          // taki wiersz po prostu gasił kręciołek i nie robił nic, co wygląda
          // jak zepsuty portal.
          toast.error(
            res.status === 403 || res.status === 404
              ? 'Tego zadania już nie ma. Lista odświeży się przy najbliższej synchronizacji.'
              : 'Nie udało się otworzyć zadania.'
          )
          return
        }
        const data = await res.json()
        const full = data.task ?? null
        if (!full?.id) {
          toast.error('Nie udało się otworzyć zadania.')
          return
        }
        setTask(full)
      } catch {
        toast.error('Brak połączenia. Spróbuj ponownie.')
      } finally {
        setLoadingId(null)
      }
    },
    [slug]
  )

  return (
    <>
      {/* table-fixed i whitespace-normal na nazwie: bez tego domyślny
          whitespace-nowrap z shadcn rozpycha tabelę długą nazwą zadania
          i wypycha prawe kolumny za krawędź ekranu. */}
      <Table className="table-fixed">
        <TableHeader>
          <TableRow>
            {/* "Dodano", nie "Zgłoszono". date_created to moment wpisania
                zadania do ClickUpa, a zgłoszenia z maila czy WhatsAppa trafiają
                tam z opóźnieniem. Nazwanie tego "zgłoszeniem" dawałoby klientowi
                nieprawdziwą podstawę do rozmowy o czasie reakcji. */}
            <TableHead className="w-24">Dodano</TableHead>
            <TableHead>Zgłoszenie</TableHead>
            <TableHead className="w-28">Status</TableHead>
            <TableHead className="w-24">Priorytet</TableHead>
          </TableRow>
        </TableHeader>
        <TableBody>
          {rows.map(row => (
            <TableRow
              key={row.clickupTaskId}
              onClick={() => open(row.clickupTaskId)}
              tabIndex={0}
              onKeyDown={e => {
                if (e.key === 'Enter' || e.key === ' ') {
                  e.preventDefault()
                  open(row.clickupTaskId)
                }
              }}
              className="cursor-pointer transition-colors hover:bg-muted/50"
            >
              <TableCell className="tabular-nums text-muted-foreground">
                {formatAdded(row.dateCreated)}
              </TableCell>

              <TableCell className="whitespace-normal pr-4">
                <div className="flex items-start gap-2">
                  <span className="font-medium text-foreground">{row.name}</span>
                  {loadingId === row.clickupTaskId && (
                    <Loader2 className="mt-0.5 h-3.5 w-3.5 shrink-0 animate-spin text-muted-foreground" />
                  )}
                </div>

                <div className="mt-1 flex flex-wrap items-center gap-x-3 gap-y-1 text-xs text-muted-foreground">
                  {row.subtaskCount > 0 && (
                    <span>
                      {row.subtaskCount}{' '}
                      {row.subtaskCount === 1 ? 'podzadanie' : row.subtaskCount < 5 ? 'podzadania' : 'podzadań'}
                    </span>
                  )}
                  {row.attachmentCount > 0 && (
                    <span className="inline-flex items-center gap-1">
                      <Paperclip className="h-3 w-3" />
                      {row.attachmentCount}
                    </span>
                  )}
                  {row.publicCommentCount > 0 && (
                    <span className="inline-flex items-center gap-1">
                      <MessageSquare className="h-3 w-3" />
                      {row.publicCommentCount}
                    </span>
                  )}
                </div>

                {/* Fraza trafiła w podzadaniu, a nie w tym wierszu. Bez tego
                    dopisku klient widziałby wiersz bez szukanego słowa i uznał
                    wyszukiwarkę za zepsutą. */}
                {row.matchedSubtasks.length > 0 && (
                  <div className="mt-1.5 space-y-0.5">
                    {row.matchedSubtasks.slice(0, 3).map((name, i) => (
                      <div
                        key={i}
                        className="flex items-start gap-1.5 text-xs text-muted-foreground"
                      >
                        <CornerDownRight className="mt-0.5 h-3 w-3 shrink-0" />
                        <span>
                          trafienie w podzadaniu: <span className="text-foreground">{name}</span>
                        </span>
                      </div>
                    ))}
                    {row.matchedSubtasks.length > 3 && (
                      <div className="pl-4.5 text-xs text-muted-foreground">
                        i {row.matchedSubtasks.length - 3} więcej
                      </div>
                    )}
                  </div>
                )}
              </TableCell>

              <TableCell>
                <StatusBadge status={row.status} />
              </TableCell>

              <TableCell className="text-xs text-muted-foreground">
                {row.priority ? getPriorityLabel(row.priority) : '—'}
              </TableCell>
            </TableRow>
          ))}
        </TableBody>
      </Table>

      {task && (
        <TaskDrawer
          task={task}
          slug={slug}
          userEmail={userEmail}
          onClose={() => setTask(null)}
          onTaskUpdated={updated => setTask(updated)}
          onNavigate={taskId => open(taskId)}
        />
      )}
    </>
  )
}
