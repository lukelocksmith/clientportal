import { NextRequest, NextResponse } from 'next/server'
import { verifyToken } from '@/lib/apiAuth'
import { recordCronRun } from '@/lib/cronRuns'
import { acquireCronLock } from '@/lib/cronLock'
import { deliverPending, pendingCount } from '@/lib/pendingReports'

export const dynamic = 'force-dynamic'
// Dowożenie to najwyżej kilkadziesiąt wywołań ClickUpa, ale przy dłuższej
// awarii kolejka bywa długa, a przerwany przebieg zostawia zgłoszenia na
// kolejny — więc limit czasu jak w pozostałych cronach, nie domyślny.
export const maxDuration = 300

/**
 * Dowozi do ClickUpa zgłoszenia, które nie weszły tam przy zgłoszeniu.
 *
 * Wołane z crontaba co 2 minuty. Auth jak w pozostałych cronach:
 * `Authorization: Bearer <CRON_SECRET>` albo `?token=<CRON_SECRET>`.
 *
 * PO CO (31.08): patrz komentarz przy tabeli `pending_reports`. W skrócie —
 * do tej pory awaria API ClickUpa kasowała treść zgłoszenia klienta, bo
 * ClickUp był jedynym miejscem zapisu. Teraz zgłoszenie czeka u nas, a ten
 * cron je dowozi z ponawianiem.
 *
 * Częściej niż eskalacja alarmów (2 min wobec 5), bo tu chodzi o zgłoszenie,
 * które klient właśnie wysłał i patrzy na tablicę.
 */
async function handle(request: NextRequest) {
  if (!verifyToken(request, 'CRON_SECRET')) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  // Dubel przebiegu = to samo zgłoszenie dowiezione dwa razy, czyli dwa
  // zadania w ClickUpie z jednej sprawy klienta.
  const lock = await acquireCronLock('pending-reports')
  if (lock.kind === 'busy') {
    return NextResponse.json({ ranAt: new Date().toISOString(), skipped: 'inny przebieg pending-reports trwa' })
  }
  if (lock.kind === 'acquired') {
    try {
      return await run()
    } finally {
      await lock.release()
    }
  }
  return run()
}

async function run(): Promise<NextResponse> {
  const startedAt = new Date()
  try {
    const wynik = await deliverPending({ limit: 25 })
    const zostalo = await pendingCount()

    // `ok: false` przy zaległości starszej niż kwadrans: wpis w cron_runs
    // świeci wtedy na czerwono i leci alarm na Discorda. Sam przebieg się
    // udał, ale kolejka, która nie schodzi, jest awarią, nie statystyką.
    await recordCronRun({
      job: 'pending-reports',
      ok: wynik.stale === 0,
      itemsProcessed: wynik.delivered,
      detail:
        `przetworzono ${wynik.processed}, dowiezione ${wynik.delivered}, nieudane ${wynik.failed}, ` +
        `w kolejce zostało ${zostalo}${wynik.stale > 0 ? `, zaległych ${wynik.stale}` : ''}`,
      startedAt,
    })

    return NextResponse.json({ ranAt: startedAt.toISOString(), ...wynik, zostalo })
  } catch (e) {
    console.error('[pending-reports] przebieg nieudany:', e)
    await recordCronRun({
      job: 'pending-reports',
      ok: false,
      detail: e instanceof Error ? e.message : String(e),
      startedAt,
    })
    return NextResponse.json({ error: 'Przebieg nieudany' }, { status: 500 })
  }
}

export async function GET(request: NextRequest) {
  return handle(request)
}
