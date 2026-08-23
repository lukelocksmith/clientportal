import { NextRequest, NextResponse } from 'next/server'
import { isAdminRequest } from '@/lib/admin-auth'
import { requireAdminPortal } from '@/lib/adminPortal'
import { listCronRuns, getLastSuccessfulRun, CRON_JOB_LABELS, type CronJob } from '@/lib/cronRuns'
import { listStatusHistory } from '@/lib/statusHistory'

/**
 * Logi synchronizacji projektu: Track Time i indeks Historii.
 *
 * Tylko dla admina. Klient widzi z tego jedynie datę „dane na dzień X" na
 * swojej zakładce; treść błędów i czasy przebiegów to nasza diagnostyka.
 *
 * Oprócz listy zwracamy datę ostatniego UDANEGO przebiegu per zadanie. Nie da
 * się jej wyliczyć z listy po stronie panelu, gdy wszystkie ostatnie przebiegi
 * w oknie są nieudane, a to jest właśnie ten moment, w którym ta data jest
 * najbardziej potrzebna.
 */
const JOBS = Object.keys(CRON_JOB_LABELS) as CronJob[]

export async function GET(request: NextRequest) {
  if (!(await isAdminRequest(request))) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  const slug = request.nextUrl.searchParams.get('slug')
  if (!slug) return NextResponse.json({ error: 'Podaj slug' }, { status: 400 })

  const gate = await requireAdminPortal(slug)
  if (!gate.ok) return gate.response

  const rawJob = request.nextUrl.searchParams.get('job')
  const job = JOBS.includes(rawJob as CronJob) ? (rawJob as CronJob) : undefined

  // Historia statusow leci RAZEM z przebiegami, jednym zapytaniem: to jest
  // jeden widok w panelu, a trzy osobne pobrania z przegladarki znaczylyby trzy
  // stany wczytywania i trzy mozliwe bledy w jednym okienku.
  const [runs, statusy, ...lastOk] = await Promise.all([
    listCronRuns({ portalId: gate.portal.id, job, limit: 100 }),
    listStatusHistory({ portalId: gate.portal.id, limit: 100 }),
    ...JOBS.map(j => getLastSuccessfulRun(j, gate.portal.id)),
  ])

  return NextResponse.json({
    runs,
    statusy,
    labels: CRON_JOB_LABELS,
    lastSuccess: Object.fromEntries(JOBS.map((j, i) => [j, lastOk[i]])),
  })
}
