'use client'
import Link from 'next/link'
import { ChevronLeft, ChevronRight, ChevronDown } from '@/lib/icons'
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu'
import { cn } from '@/lib/utils'
import type { Period, PeriodKind } from '@/lib/timeReports'
import type { PortalBranding } from '@/lib/branding'

interface PeriodPickerProps {
  slug: string
  kind: PeriodKind
  period: Period
  periods: Period[]
  /** Klucz starszego okresu albo null, gdy sięgamy poza listę. */
  olderKey: string | null
  /** Klucz nowszego okresu albo null, gdy jesteśmy na ostatnim zamkniętym. */
  newerKey: string | null
  /** Marka klienta. Aktywny wybór ma ten sam kolor co aktywna zakładka. */
  branding: PortalBranding
}

function href(slug: string, kind: PeriodKind, key: string): string {
  return `/${slug}/raporty?typ=${kind}&okres=${key}`
}

export function PeriodPicker({ slug, kind, period, periods, olderKey, newerKey, branding }: PeriodPickerProps) {
  const arrow =
    'inline-flex h-8 w-8 items-center justify-center rounded-md text-muted-foreground transition-colors'
  const arrowActive = 'hover:bg-muted hover:text-foreground'
  const arrowOff = 'opacity-30 pointer-events-none'

  return (
    <div className="flex flex-wrap items-center gap-4">
      {/* Przełącznik rodzaju okresu. Zawsze prowadzi na ostatni zamknięty
          okres danego rodzaju, bo klucz tygodnia nie ma sensu dla miesiąca. */}
      <div className="inline-flex rounded-lg border border-border bg-card p-0.5">
        {(['tydzien', 'miesiac'] as const).map(option => (
          <Link
            key={option}
            href={`/${slug}/raporty?typ=${option}`}
            style={
              option === kind
                ? { backgroundColor: branding.brandColor, color: branding.brandForeground }
                : undefined
            }
            className={cn(
              'rounded-md px-3 py-1.5 text-sm font-medium transition-colors',
              option === kind ? '' : 'text-muted-foreground hover:text-foreground'
            )}
          >
            {option === 'tydzien' ? 'Tydzień' : 'Miesiąc'}
          </Link>
        ))}
      </div>

      <div className="flex items-center gap-1">
        {olderKey ? (
          <Link href={href(slug, kind, olderKey)} className={cn(arrow, arrowActive)} aria-label="Starszy okres">
            <ChevronLeft className="h-4 w-4" />
          </Link>
        ) : (
          <span className={cn(arrow, arrowOff)} aria-hidden="true">
            <ChevronLeft className="h-4 w-4" />
          </span>
        )}

        <DropdownMenu>
          <DropdownMenuTrigger className="inline-flex items-center gap-1.5 rounded-md px-3 py-1.5 text-sm font-medium text-foreground hover:bg-muted transition-colors">
            {period.label}
            <ChevronDown className="h-4 w-4 text-muted-foreground" />
          </DropdownMenuTrigger>
          <DropdownMenuContent align="center">
            {periods.map(option => (
              <DropdownMenuItem key={option.key} asChild>
                <Link href={href(slug, kind, option.key)}>{option.label}</Link>
              </DropdownMenuItem>
            ))}
          </DropdownMenuContent>
        </DropdownMenu>

        {newerKey ? (
          <Link href={href(slug, kind, newerKey)} className={cn(arrow, arrowActive)} aria-label="Nowszy okres">
            <ChevronRight className="h-4 w-4" />
          </Link>
        ) : (
          <span className={cn(arrow, arrowOff)} aria-hidden="true">
            <ChevronRight className="h-4 w-4" />
          </span>
        )}
      </div>
    </div>
  )
}
