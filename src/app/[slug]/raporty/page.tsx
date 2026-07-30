import { redirect } from 'next/navigation'
import { z } from 'zod'
import { getTimeEntries } from '@/lib/clickup'
import {
  buildReport,
  listPeriods,
  parsePeriodKey,
  shiftPeriod,
  type TimeReport,
} from '@/lib/timeReports'
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

  const periods = listPeriods(kind, 12)
  const period = (okres ? parsePeriodKey(kind, okres) : null) ?? periods[0]

  let report: TimeReport | null = null
  try {
    // folderId pochodzi z bazy, nie z URL-a. To granica między klientami.
    const entries = await getTimeEntries(portal.clickupFolderId, period.startMs, period.endMs)
    report = buildReport(period, entries)
  } catch (error) {
    console.error('[raporty] ClickUp nie odpowiedział:', error)
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
      <ReportView
        branding={branding}
        slug={slug}
        kind={kind}
        periods={periods}
        period={period}
        report={report}
        olderKey={shiftPeriod(period, -1)?.key ?? null}
        newerKey={shiftPeriod(period, 1)?.key ?? null}
      />
    </div>
  )
}
