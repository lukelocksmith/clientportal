import { redirect } from 'next/navigation'
import { z } from 'zod'
import { getTimeEntries } from '@/lib/clickup'
import { getCachedTasksForScope } from '@/lib/clickupCache'
import { getPortalScope } from '@/lib/portalScopeStore'
import { filterTimeEntriesToScope } from '@/lib/portalScope'
import {
  buildReport,
  currentMonthToDate,
  listPeriods,
  parsePeriodKey,
  shiftPeriod,
  type TimeReport,
} from '@/lib/timeReports'
import { buildEstimateReport, type EstimateReport } from '@/lib/estimateReport'
import { ReportView } from '@/components/reports/ReportView'
import { PortalHeader } from '@/components/PortalHeader'
import { isTabEnabled } from '@/lib/portalTabs'
import { getPortalForSession } from '@/lib/portalSession'

interface RaportyPageProps {
  params: Promise<{ slug: string }>
  searchParams: Promise<{ [key: string]: string | string[] | undefined }>
}

/**
 * Cokolwiek niepoprawnego w URL cicho wraca do domyślnego okresu, zamiast
 * zwracać 404. Podesłany klientowi link nigdy nie ma umrzeć.
 */
const searchSchema = z.object({
  typ: z.enum(['tydzien', 'miesiac']).catch('tydzien'),
  okres: z.string().max(16).optional().catch(undefined),
})

function first(value: string | string[] | undefined): string | undefined {
  return Array.isArray(value) ? value[0] : value
}

export default async function RaportyPage({ params, searchParams }: RaportyPageProps) {
  const { slug } = await params

  const result = await getPortalForSession(slug)
  if (!result.ok) redirect(result.reason === 'no-portal' ? '/' : `/${slug}/login`)
  const { session, portal, flags, branding } = result

  // Brama po stronie serwera. Ukrycie zakładki w headerze to tylko kosmetyka,
  // adres musi być zamknięty także dla kogoś, kto wpisze go z ręki.
  if (!isTabEnabled(flags, 'raporty')) redirect(`/${slug}`)

  const raw = await searchParams
  const { typ: kind, okres } = searchSchema.parse({ typ: first(raw.typ), okres: first(raw.okres) })

  // Miesiąc, w odróżnieniu od tygodnia, doklejamy bieżący (jeszcze trwający)
  // na start listy — patrz komentarz przy currentMonthToDate. Bez `okres`
  // w URL-u ten właśnie okres staje się domyślnym widokiem zakładki.
  const periods = kind === 'miesiac' ? [currentMonthToDate(), ...listPeriods(kind, 12)] : listPeriods(kind, 12)
  const period = (okres ? parsePeriodKey(kind, okres) : null) ?? periods[0]

  // Oba niezależne pobrania lecą równolegle: sekwencyjne await sumowały
  // latencję ClickUpa na czas renderowania zakładki.
  let report: TimeReport | null = null
  try {
    // folderId pochodzi z bazy, nie z URL-a. To granica między klientami.
    // ClickUp filtruje wpisy czasu tylko po FOLDERZE, wiec zawezenie do list
    // portalu robimy u siebie. Bez tego raport zawieral godziny z list, ktorych
    // do portalu nie wybralismy, a to jest liczba, ktora klient porownuje
    // z faktura. `task_location.list_id` przychodzi razem z wpisem, wiec nie
    // potrzebujemy dodatkowych wywolan.
    const [entries, scope] = await Promise.all([
      getTimeEntries(portal.clickupFolderId, period.startMs, period.endMs),
      getPortalScope(portal.id),
    ])
    report = buildReport(period, filterTimeEntriesToScope(entries, scope))
  } catch (error) {
    console.error('[raporty] ClickUp nie odpowiedział:', error)
  }

  // Za flagą, osobną od reportsEnabled: klienci majacy juz wlaczony raport
  // czasu pracy nie maja automatycznie dostac tego widgetu (patrz schema.ts).
  // Scope tu jest wejściem do pobrania zadań, więc te dwa awaity muszą zostać
  // sekwencyjne; oba idą z cache'u/bazy, nie z ClickUpa.
  let estimateReport: EstimateReport | null = null
  if (portal.estimateReportEnabled) {
    try {
      const scope = await getPortalScope(portal.id)
      const tasks = await getCachedTasksForScope(portal.clickupFolderId, scope)
      estimateReport = buildEstimateReport(tasks)
    } catch (error) {
      console.error('[raporty] Nie udało się policzyć pozostałej estymacji:', error)
    }
  }

  return (
    <div className="min-h-screen bg-background">
      <PortalHeader
        slug={slug}
        portalName={portal.name}
        userEmail={session.email}
        flags={flags}
        branding={branding}
      />
      {/* JEDEN widok: czas w okresie i pozostała estymacja w tej samej liście.
          Wcześniej były to dwie sekcje jedna pod drugą, z tymi samymi
          zadaniami w obu (uwaga Łukasza 28.08). */}
      <ReportView
        branding={branding}
        slug={slug}
        hourlyRateNet={portal.hourlyRateNet}
        kind={kind}
        periods={periods}
        period={period}
        report={report}
        estimateReport={estimateReport}
        olderKey={shiftPeriod(period, -1)?.key ?? null}
        newerKey={shiftPeriod(period, 1)?.key ?? null}
      />
    </div>
  )
}
