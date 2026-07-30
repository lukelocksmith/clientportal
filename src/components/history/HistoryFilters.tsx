'use client'
import Link from 'next/link'
import { ChevronDown, X } from 'lucide-react'
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu'
import { cn, getPriorityLabel } from '@/lib/utils'
import { HistorySearch } from './HistorySearch'
import type { HistoryScope } from '@/lib/historyParams'
import type { PortalBranding } from '@/lib/branding'

/**
 * Pasek filtrów. Wszystko poza polem szukania to zwykłe linki na warianty
 * searchParams, ten sam wzorzec co PeriodPicker w raportach: zero stanu w
 * Reakcie, filtry działają bez JS, a link z ustawionymi filtrami da się
 * wysłać klientowi i zadziała.
 *
 * KAŻDY link zeruje `kursor`. Zmiana filtra przy zachowanym kursorze
 * pokazywałaby pustą stronę, bo kursor wskazuje pozycję w poprzednim,
 * innym zbiorze wyników.
 */
interface HistoryFiltersProps {
  slug: string
  current: { q: string | null; status: string | null; priorytet: string | null; zakres: HistoryScope }
  statuses: Array<{ status: string; count: number }>
  priorities: Array<{ priority: string; count: number }>
  /**
   * Marka klienta. Aktywny filtr musi mieć TEN SAM kolor co aktywna zakładka
   * w headerze. Wcześniej header był w kolorze klienta, a ten przełącznik
   * w czerwieni important.is, czyli na jednym ekranie były dwie konwencje
   * „to jest wybrane".
   */
  branding: PortalBranding
}

const SCOPES: Array<{ value: HistoryScope; label: string }> = [
  { value: 'wszystkie', label: 'Wszystkie' },
  { value: 'otwarte', label: 'Otwarte' },
  { value: 'zamkniete', label: 'Zamknięte' },
]

export function HistoryFilters({ slug, current, statuses, priorities, branding }: HistoryFiltersProps) {
  function href(changes: Record<string, string | null>): string {
    const params = new URLSearchParams()
    if (current.q) params.set('q', current.q)
    if (current.status) params.set('status', current.status)
    if (current.priorytet) params.set('priorytet', current.priorytet)
    if (current.zakres !== 'wszystkie') params.set('zakres', current.zakres)

    for (const [key, value] of Object.entries(changes)) {
      if (value === null) params.delete(key)
      else params.set(key, value)
    }
    // Nowy zestaw filtrów to nowy zbiór wyników, więc zawsze od pierwszej strony.
    params.delete('kursor')

    const qs = params.toString()
    return qs ? `/${slug}/historia?${qs}` : `/${slug}/historia`
  }

  const hasFilters =
    Boolean(current.q) || Boolean(current.status) || Boolean(current.priorytet) || current.zakres !== 'wszystkie'

  const trigger =
    'inline-flex items-center gap-1.5 rounded-lg border border-border bg-card px-3 py-1.5 text-sm transition-colors hover:bg-muted'

  return (
    <div className="flex flex-wrap items-center gap-3">
      <HistorySearch />

      <div className="inline-flex rounded-lg border border-border bg-card p-0.5">
        {SCOPES.map(scope => (
          <Link
            key={scope.value}
            href={href({ zakres: scope.value === 'wszystkie' ? null : scope.value })}
            style={
              scope.value === current.zakres
                ? { backgroundColor: branding.brandColor, color: branding.brandForeground }
                : undefined
            }
            className={cn(
              'rounded-md px-3 py-1.5 text-sm font-medium transition-colors',
              scope.value === current.zakres ? '' : 'text-muted-foreground hover:text-foreground'
            )}
          >
            {scope.label}
          </Link>
        ))}
      </div>

      {statuses.length > 0 && (
        <DropdownMenu>
          <DropdownMenuTrigger
            className={cn(trigger, current.status ? 'text-foreground' : 'text-muted-foreground')}
          >
            {current.status ?? 'Status'}
            <ChevronDown className="h-4 w-4 text-muted-foreground" />
          </DropdownMenuTrigger>
          <DropdownMenuContent align="start">
            <DropdownMenuItem asChild>
              <Link href={href({ status: null })}>Wszystkie statusy</Link>
            </DropdownMenuItem>
            {statuses.map(item => (
              <DropdownMenuItem key={item.status} asChild>
                <Link href={href({ status: item.status })}>
                  {item.status}
                  <span className="ml-auto pl-4 text-xs text-muted-foreground">{item.count}</span>
                </Link>
              </DropdownMenuItem>
            ))}
          </DropdownMenuContent>
        </DropdownMenu>
      )}

      {priorities.length > 0 && (
        <DropdownMenu>
          <DropdownMenuTrigger
            className={cn(trigger, current.priorytet ? 'text-foreground' : 'text-muted-foreground')}
          >
            {current.priorytet ? getPriorityLabel(current.priorytet) : 'Priorytet'}
            <ChevronDown className="h-4 w-4 text-muted-foreground" />
          </DropdownMenuTrigger>
          <DropdownMenuContent align="start">
            <DropdownMenuItem asChild>
              <Link href={href({ priorytet: null })}>Każdy priorytet</Link>
            </DropdownMenuItem>
            {priorities.map(item => (
              <DropdownMenuItem key={item.priority} asChild>
                <Link href={href({ priorytet: item.priority })}>
                  {getPriorityLabel(item.priority)}
                  <span className="ml-auto pl-4 text-xs text-muted-foreground">{item.count}</span>
                </Link>
              </DropdownMenuItem>
            ))}
          </DropdownMenuContent>
        </DropdownMenu>
      )}

      {hasFilters && (
        <Link
          href={`/${slug}/historia`}
          className="inline-flex items-center gap-1 text-sm text-muted-foreground transition-colors hover:text-foreground"
        >
          <X className="h-3.5 w-3.5" />
          Wyczyść
        </Link>
      )}
    </div>
  )
}
