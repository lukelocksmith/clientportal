import { NextRequest, NextResponse } from 'next/server'
import { verifyToken } from '@/lib/apiAuth'
import { recordCronRun, sprawdzKanalAlarmow } from '@/lib/cronRuns'

export const dynamic = 'force-dynamic'
export const maxDuration = 60

/**
 * SYGNAŁ ŻYCIA KANAŁU ALARMÓW. Kto pilnuje pilnującego.
 *
 * PO CO (14.09). Wszystko, co portal ma do powiedzenia o własnych awariach,
 * wychodzi jednym webhookiem Discorda: czerwony przycisk klienta, kolejka
 * zgłoszeń, porzucone rozmowy z asystentem, błędy 5xx, nieudane maile, a nawet
 * zewnętrzna czujka z Mac mini. Usunięty webhook albo zmienione uprawnienia
 * kanału uciszały to wszystko naraz, a cisza wyglądała identycznie jak spokój.
 *
 * Ten cron sprawdza kanał BEZ wysyłania wiadomości: Discord oddaje na GET
 * metadane webhooka, więc da się potwierdzić jego istnienie, nie zaśmiecając
 * kanału zespołu. Czujka, która co godzinę pisze „żyję", po tygodniu przestaje
 * być czytana i wtedy jest tyle samo warta co jej brak.
 *
 * Wynik trafia do `cron_runs` i do `/api/health/zgloszenia`, a ten endpoint
 * pilnuje z zewnątrz UptimeRobot — powiadamiający mailem i Pushoverem, czyli
 * drogą, która NIE przechodzi przez Discorda. To jest cały sens: druga droga
 * nie może dzielić z pierwszą punktu awarii.
 *
 * Auth jak w pozostałych cronach: `Authorization: Bearer <CRON_SECRET>`
 * albo `?token=<CRON_SECRET>`.
 */
async function handle(request: NextRequest) {
  if (!verifyToken(request, 'CRON_SECRET')) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  const startedAt = new Date()
  const stan = await sprawdzKanalAlarmow()

  await recordCronRun({
    job: 'alert-channel',
    ok: stan.ok,
    itemsProcessed: stan.ok ? 1 : 0,
    detail: stan.detail,
    startedAt,
  })

  // Kod 200 także przy niesprawnym kanale: to nie jest awaria TEJ trasy, a jej
  // wynik czyta endpoint zdrowia. Gdyby tu leciało 503, czujka UptimeRobota
  // stojąca na cronach zapalałaby się dwa razy o tej samej rzeczy.
  return NextResponse.json({
    ranAt: new Date().toISOString(),
    kanal: stan.ok ? 'odpowiada' : 'NIE ODPOWIADA',
    detail: stan.detail,
  })
}

export const GET = handle
export const POST = handle
