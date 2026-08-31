import { NextResponse } from 'next/server'
import { and, isNull, sql } from 'drizzle-orm'
import { db } from '@/lib/db'
import { cronRuns, pendingReports } from '@/lib/db/schema'
import { reportingHealth, type CronName } from '@/lib/healthReporting'

export const dynamic = 'force-dynamic'

/**
 * Czy droga zgłoszeń klienta jest przejezdna. Dla ZEWNĘTRZNEGO czujnika.
 *
 * PO CO: ochrona zgłoszeń i alarmów stoi na dwóch cronach, a te alarmują
 * wyłącznie wtedy, gdy się wykonają i nie udadzą. Cron, który przestał być
 * wołany, milczy — i to milczenie do 31.08 wyglądało identycznie jak spokój.
 * Zauważyć je może tylko coś spoza tego serwera, dlatego ta trasa istnieje
 * i dlatego jest bez tokenu: czujnik ma ją odpytywać co pięć minut.
 *
 * Odpowiedź jest TEKSTEM, nie JSON-em, żeby czujnik szukał w niej słowa „OK"
 * (monitor typu „keyword"). Nie wychodzi stąd nic o klientach: ani nazwy
 * projektów, ani treści zgłoszeń, tylko wiek przebiegów i liczniki.
 *
 * Kod 503 przy problemie, żeby czujnik zapalił się także wtedy, gdy zmieni
 * się treść komunikatu i słowo kluczowe przestanie pasować.
 */
const PILNOWANE: CronName[] = ['pending-reports', 'panic-escalation', 'task-index']

export async function GET() {
  try {
    // Ostatni przebieg każdego zadania jednym pytaniem. Bierzemy KAŻDY
    // przebieg, nie tylko udany: cron, który chodzi i się wywala, jest widziany
    // przez własny alarm na Discordzie, a ta trasa pilnuje CISZY.
    const wiersze = await db
      .select({ job: cronRuns.job, ostatni: sql<Date>`max(${cronRuns.finishedAt})` })
      .from(cronRuns)
      .groupBy(cronRuns.job)

    const lastRuns: Partial<Record<CronName, Date | null>> = {}
    for (const name of PILNOWANE) {
      const row = wiersze.find(w => w.job === name)
      lastRuns[name] = row?.ostatni ? new Date(row.ostatni) : null
    }

    const [kolejka] = await db
      .select({
        ile: sql<number>`count(*)::int`,
        najstarsze: sql<Date | null>`min(${pendingReports.createdAt})`,
      })
      .from(pendingReports)
      .where(and(isNull(pendingReports.deliveredAt)))

    const now = new Date()
    const najstarszeMinuty = kolejka?.najstarsze
      ? Math.floor((now.getTime() - new Date(kolejka.najstarsze).getTime()) / 60_000)
      : null

    const werdykt = reportingHealth({
      lastRuns,
      pending: kolejka?.ile ?? 0,
      oldestPendingMinutes: najstarszeMinuty,
      now,
    })

    return new NextResponse(werdykt.line, {
      status: werdykt.ok ? 200 : 503,
      headers: { 'Content-Type': 'text/plain; charset=utf-8', 'Cache-Control': 'no-store' },
    })
  } catch (e) {
    // Padnięta baza to też awaria drogi zgłoszeń, i to najpoważniejsza.
    console.error('[health/zgloszenia] nie udało się policzyć stanu:', e)
    return new NextResponse('PROBLEM · baza portalu nie odpowiada', {
      status: 503,
      headers: { 'Content-Type': 'text/plain; charset=utf-8', 'Cache-Control': 'no-store' },
    })
  }
}
