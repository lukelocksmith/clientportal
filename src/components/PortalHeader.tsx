'use client'
import Link from 'next/link'
import { usePathname } from 'next/navigation'
import { cn } from '@/lib/utils'

interface PortalHeaderProps {
  slug: string
  portalName: string
  userEmail: string
  /** Akcje po prawej stronie. Tablica wstawia tu Alarm, Odśwież i Nowe zadanie. */
  children?: React.ReactNode
}

export function PortalHeader({ slug, portalName, userEmail, children }: PortalHeaderProps) {
  const pathname = usePathname()
  const tabs = [
    { href: `/${slug}`, label: 'Tablica' },
    { href: `/${slug}/raporty`, label: 'Raporty' },
  ]

  return (
    <header className="border-b border-border bg-card px-6 py-4">
      {/* Jeden rząd: tożsamość, zakładki, akcje. Akcje trzyma po prawej
          ml-auto, dzięki czemu zakładki zostają przy logo także wtedy, gdy
          strona nie przekazuje żadnych akcji (raporty). flex-wrap ratuje
          układ na wąskich ekranach, gdzie tablica ma trzy przyciski. */}
      <div className="flex flex-wrap items-center gap-x-6 gap-y-3">
        <div className="flex flex-shrink-0 items-center gap-3">
          <div className="h-8 w-8 rounded-lg bg-primary flex items-center justify-center text-primary-foreground text-sm font-bold">
            {portalName[0]?.toUpperCase()}
          </div>
          <div>
            <h1 className="font-semibold text-foreground">{portalName}</h1>
            <p className="text-xs text-muted-foreground">{userEmail}</p>
          </div>
        </div>

        <nav className="flex gap-1">
          {tabs.map(tab => {
            // Tablica jest aktywna tylko przy dokładnym trafieniu, inaczej
            // podświetlałaby się także na podstronach.
            const active =
              tab.href === `/${slug}` ? pathname === tab.href : pathname.startsWith(tab.href)
            return (
              <Link
                key={tab.href}
                href={tab.href}
                className={cn(
                  'rounded-md px-3 py-1.5 text-sm font-medium transition-colors',
                  active
                    ? 'bg-muted text-foreground'
                    : 'text-muted-foreground hover:bg-muted hover:text-foreground'
                )}
              >
                {tab.label}
              </Link>
            )
          })}
        </nav>

        <div className="ml-auto flex items-center gap-2">{children}</div>
      </div>
    </header>
  )
}
