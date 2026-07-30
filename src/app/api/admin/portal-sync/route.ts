import { NextRequest, NextResponse } from 'next/server'
import { eq } from 'drizzle-orm'
import { isAdminRequest } from '@/lib/admin-auth'
import { db } from '@/lib/db'
import { portals } from '@/lib/db/schema'
import { listCronRuns, getLastSuccessfulRun, CRON_JOB_LABELS, type CronJob } from '@/lib/cronRuns'

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

  const [portal] = await db.select().from(portals).where(eq(portals.slug, slug)).limit(1)
  if (!portal) return NextResponse.json({ error: 'Portal nie istnieje' }, { status: 404 })

  const rawJob = request.nextUrl.searchParams.get('job')
  const job = JOBS.includes(rawJob as CronJob) ? (rawJob as CronJob) : undefined

  const [runs, ...lastOk] = await Promise.all([
    listCronRuns({ portalId: portal.id, job, limit: 100 }),
    ...JOBS.map(j => getLastSuccessfulRun(j, portal.id)),
  ])

  return NextResponse.json({
    runs,
    labels: CRON_JOB_LABELS,
    lastSuccess: Object.fromEntries(JOBS.map((j, i) => [j, lastOk[i]])),
  })
}
