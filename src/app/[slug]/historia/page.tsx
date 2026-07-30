import Link from 'next/link'
import { redirect } from 'next/navigation'
import { eq } from 'drizzle-orm'
import { ChevronRight, Clock } from 'lucide-react'
import { getSession } from '@/lib/auth'
import { db } from '@/lib/db'
import { portals } from '@/lib/db/schema'
import { getHistoryFacets, queryHistory } from '@/lib/taskIndex'
import { getLastSuccessfulRun } from '@/lib/cronRuns'
import { isTabEnabled, type PortalFlags } from '@/lib/portalTabs'
import { resolveBranding } from '@/lib/branding'
import { parseHistoryParams, scopeToFilters, nextPageHref } from '@/lib/historyParams'
import { PortalHeader } from '@/components/PortalHeader'
import { HistoryFilters } from '@/components/history/HistoryFilters'
import { HistoryTable } from '@/components/history/HistoryTable'

const PAGE_SIZE = 25

interface HistoriaPageProps {
  params: Promise<{ slug: string }>
  searchParams: Promise<{ [key: string]: string | string[] | undefined }>
}

function formatSyncDate(date: Date): string {
  return date.toLocaleString('pl-PL', {
    day: '2-digit',
    month: '2-digit',
    year: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  })
}

export default async function HistoriaPage({ params, searchParams }: HistoriaPageProps) {
  const { slug } = await params

  const session = await getSession(slug)
  if (!session || session.portalSlug !== slug) {
    redirect(`/${slug}/login`)
  }

  const [portal] = await db.select().from(portals).where(eq(portals.slug, slug)).limit(1)
  if (!portal) redirect('/')

  const flags: PortalFlags = {
    kanbanEnabled: portal.kanbanEnabled,
    reportsEnabled: portal.reportsEnabled,
    historyEnabled: portal.historyEnabled,
    dashboardEnabled: portal.dashboardEnabled,
  }

  const branding = resolveBranding(portal)

  // Brama po stronie serwera. Ukrycie zakładki w headerze to kosmetyka,
  // adres musi być zamknięty także dla kogoś, kto wpisze go z ręki.
  if (!isTabEnabled(flags, 'historia')) redirect(`/${slug}`)

  const query = parseHistoryParams(await searchParams)

  // portal.id pochodzi z bazy po slugu z sesji, nigdy z parametrów adresu.
  // To granica między klientami.
  const [page, facets, lastSync] = await Promise.all([
    queryHistory(portal.id, {
      q: query.q ?? null,
      status: query.status ?? null,
      priority: query.priorytet ?? null,
      cursor: query.kursor ?? null,
      limit: PAGE_SIZE,
      ...scopeToFilters(query.zakres),
    }),
    getHistoryFacets(portal.id),
    getLastSuccessfulRun('task-index', portal.id),
  ])

  const searching = Boolean(query.q)
  const filtered =
    searching || Boolean(query.status) || Boolean(query.priorytet) || query.zakres !== 'wszystkie'

  return (
    <div className="min-h-screen bg-background">
      <PortalHeader
        slug={slug}
        portalName={portal.name}
        userEmail={session.email}
        flags={flags}
        branding={branding}
      />

      <main className="mx-auto max-w-5xl px-6 py-8">
        <div className="flex flex-wrap items-end justify-between gap-4">
          <div>
            <h1 className="text-2xl font-semibold text-foreground">Historia zgłoszeń</h1>
            <p className="mt-1 text-sm text-muted-foreground">
              Wszystkie zadania tego projektu, od najnowszych. Kliknij wiersz, żeby zobaczyć szczegóły.
            </p>
          </div>

          {/* Data ostatniej synchronizacji jest widoczna świadomie: lista
              zbudowana z lustra w naszej bazie mogłaby być zaległa, a zaległa
              lista bez tej informacji wygląda jak brak zadań. */}
          {lastSync && (
            <p className="inline-flex items-center gap-1.5 text-xs text-muted-foreground">
              <Clock className="h-3.5 w-3.5" />
              dane na {formatSyncDate(lastSync)}
            </p>
          )}
        </div>

        <div className="mt-6">
          <HistoryFilters
            slug={slug}
            current={{
              q: query.q ?? null,
              status: query.status ?? null,
              priorytet: query.priorytet ?? null,
              zakres: query.zakres,
            }}
            statuses={facets.statuses}
            priorities={facets.priorities}
          />
        </div>

        {facets.indexedCount === 0 ? (
          // Pusty indeks to inny problem niż brak wyników i wymaga innego
          // komunikatu, bo klient nie ma tu czego szukać ani czym filtrować.
          <p className="mt-6 rounded-lg border border-border bg-card px-4 py-8 text-center text-sm text-muted-foreground">
            Historia jeszcze się nie zbudowała. Zajrzyj za chwilę.
          </p>
        ) : page.rows.length === 0 ? (
          <div className="mt-6 rounded-lg border border-border bg-card px-4 py-8 text-center">
            <p className="text-sm text-muted-foreground">
              {searching
                ? `Nic nie pasuje do „${query.q}”.`
                : 'Brak zgłoszeń spełniających wybrane filtry.'}
            </p>
            {filtered && (
              <Link
                href={`/${slug}/historia`}
                className="mt-2 inline-block text-sm text-primary hover:underline"
              >
                Wyczyść filtry
              </Link>
            )}
          </div>
        ) : (
          <>
            <p className="mt-6 text-xs text-muted-foreground">
              {page.total}{' '}
              {page.total === 1 ? 'zgłoszenie' : page.total < 5 ? 'zgłoszenia' : 'zgłoszeń'}
              {filtered ? ' po filtrach' : ''}
            </p>

            <div className="mt-2">
              <HistoryTable rows={page.rows} slug={slug} userEmail={session.email} />
            </div>

            {/* Stronicowanie kursorowe. Bez przycisku "wstecz", bo kursor
                jest jednokierunkowy: cofnięcie wymagałoby trzymania stosu
                kursorów w adresie. Przycisk wstecz przeglądarki działa. */}
            {page.nextCursor && (
              <div className="mt-4 flex justify-center">
                <Link
                  href={nextPageHref(slug, query, page.nextCursor)}
                  className="inline-flex items-center gap-1.5 rounded-lg border border-border bg-card px-4 py-2 text-sm text-foreground transition-colors hover:bg-muted"
                >
                  Starsze zgłoszenia
                  <ChevronRight className="h-4 w-4" />
                </Link>
              </div>
            )}
          </>
        )}
      </main>
    </div>
  )
}
