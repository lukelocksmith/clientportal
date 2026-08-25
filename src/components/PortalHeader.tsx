'use client'
import Link from 'next/link'
import { usePathname } from 'next/navigation'
import { cn } from '@/lib/utils'
import { visibleTabs, type PortalFlags } from '@/lib/portalTabs'
import type { PortalBranding } from '@/lib/branding'
import { NotificationBell } from '@/components/NotificationBell'
import { ThemeToggle } from '@/components/ThemeToggle'

interface PortalHeaderProps {
  slug: string
  portalName: string
  userEmail: string
  /**
   * Kolor marki i logo projektu, już zwalidowane przez resolveBranding.
   * Header nie waliduje nic sam: dostaje wartości gotowe do wstawienia.
   */
  branding: PortalBranding
  /**
   * Flagi zakładek portalu. Jeden obiekt, nie osobny boolean per zakładka:
   * przy czterech zakładkach osobne propsy trzeba by przewlekać przez
   * KanbanBoardClient i KanbanBoard za każdym dodaniem funkcji.
   */
  flags: PortalFlags
  /** Akcje po prawej stronie. Kanban wstawia tu Alarm, Odśwież i Nowe zadanie. */
  children?: React.ReactNode
}

export function PortalHeader({
  slug,
  portalName,
  userEmail,
  flags,
  branding,
  children,
}: PortalHeaderProps) {
  const pathname = usePathname()
  const tabs = visibleTabs(flags).map(tab => ({
    href: `/${slug}${tab.path}`,
    label: tab.label,
  }))

  return (
    <header className="border-b border-border bg-card px-6 py-4">
      {/* Jeden rząd: tożsamość, zakładki, akcje. Akcje trzyma po prawej
          ml-auto, dzięki czemu zakładki zostają przy logo także wtedy, gdy
          strona nie przekazuje żadnych akcji (raporty). flex-wrap ratuje
          układ na wąskich ekranach, gdzie tablica ma trzy przyciski. */}
      <div className="flex flex-wrap items-center gap-x-6 gap-y-3">
        <div className="flex flex-shrink-0 items-center gap-3">
          {branding.logoUrl ? (
            // Zwykły <img>, nie next/image: adres jest dowolny (domena klienta
            // albo data URI), a next/image wymagałby wpisania każdej domeny do
            // remotePatterns w next.config, czyli deployu przy każdym nowym
            // kliencie. object-contain, żeby logo o dowolnych proporcjach nie
            // zostało zniekształcone.
            // eslint-disable-next-line @next/next/no-img-element
            <img
              src={branding.logoUrl}
              alt={portalName}
              className="h-8 w-8 rounded-lg object-contain"
              style={{ backgroundColor: branding.brandColor }}
            />
          ) : (
            <div
              className="flex h-8 w-8 items-center justify-center rounded-lg text-sm font-bold"
              style={{ backgroundColor: branding.brandColor, color: branding.brandForeground }}
            >
              {portalName[0]?.toUpperCase()}
            </div>
          )}
          <div>
            <h1 className="font-semibold text-foreground">{portalName}</h1>
            <p className="text-xs text-muted-foreground">{userEmail}</p>
          </div>
        </div>

        {/* Jedna zakładka to nie nawigacja, więc przy samym kanbanie header
            wygląda dokładnie jak przed dodaniem zakładek. */}
        <nav className={cn('flex gap-1', tabs.length < 2 && 'hidden')}>
          {tabs.map(tab => {
            // Kanban jest aktywny tylko przy dokładnym trafieniu, inaczej
            // podświetlałby się także na podstronach.
            const active =
              tab.href === `/${slug}` ? pathname === tab.href : pathname.startsWith(tab.href)
            return (
              <Link
                key={tab.href}
                href={tab.href}
                // Aktywna zakładka bierze kolor marki klienta. Tekst na niej
                // liczy readableForeground, więc jasny brand nie daje białych
                // liter na żółtym tle.
                style={
                  active
                    ? { backgroundColor: branding.brandColor, color: branding.brandForeground }
                    : undefined
                }
                className={cn(
                  'rounded-md px-3 py-1.5 text-sm font-medium transition-colors',
                  active ? '' : 'text-muted-foreground hover:bg-muted hover:text-foreground'
                )}
              >
                {tab.label}
              </Link>
            )
          })}
        </nav>

        {/* Dzwonek przed akcjami strony: jest wspólny dla całego portalu,
            a `children` bywa zestawem przycisków konkretnej zakładki. */}
        <div className="ml-auto flex items-center gap-2">
          <ThemeToggle />
          <NotificationBell slug={slug} />
          {children}
        </div>
      </div>
    </header>
  )
}
