import { NextRequest, NextResponse } from 'next/server'
import { and, count, desc, eq, gte, max, ne } from 'drizzle-orm'
import { isAdminRequest } from '@/lib/admin-auth'
import { db } from '@/lib/db'
import { sitepingLog } from '@/lib/db/schema'
import { requireAdminPortal } from '@/lib/adminPortal'

/**
 * Log diagnostyczny SitePinga do panelu admina.
 *
 * WYLACZNIE dla admina i wylacznie per projekt. Wpisy niosa adresy podstron
 * i prefiksy IP odwiedzajacych cudza strone — klient portalu nie ma tego
 * widziec, a jeden klient tym bardziej nie ma widziec drugiego. Stad brama
 * `isAdminRequest` plus twarde `where` po `portal_id`, a nie filtr po slugu
 * gdzies dalej w kodzie.
 *
 * Odpowiedz ma DWIE czesci, bo panel odpowiada na dwa rozne pytania:
 *
 *   `entries`  — ostatnie zdarzenia, czyli „co sie dzieje teraz".
 *   `summary`  — zestawienie z 30 dni (tyle, ile wynosi retencja), czyli
 *                „czy w ogole cokolwiek dochodzi i czego jest najwiecej".
 *
 * Bez zestawienia lista ostatnich stu wierszy klamie w typowym przypadku:
 * udane odczyty panelu widgetu (GET) sa najczestszym zdarzeniem i wypchnelyby
 * z widoku wlasnie te odmowy, dla ktorych ten log powstal.
 */
const RETENTION_DAYS = 30
const MAX_ENTRIES = 100

export async function GET(request: NextRequest) {
  if (!(await isAdminRequest(request))) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  const slug = request.nextUrl.searchParams.get('slug')
  if (!slug) return NextResponse.json({ error: 'Podaj slug' }, { status: 400 })

  const gate = await requireAdminPortal(slug)
  if (!gate.ok) return gate.response
  const portalId = gate.portal.id

  // `only=problems` odsiewa udane zadania. To domyslny widok w panelu:
  // pytanie brzmi „czemu nie dziala", a nie „ile razy zadzialalo".
  const tylkoProblemy = request.nextUrl.searchParams.get('only') === 'problems'

  const filtry = [eq(sitepingLog.portalId, portalId)]
  if (tylkoProblemy) filtry.push(ne(sitepingLog.outcome, 'ok'))

  const entries = await db
    .select()
    .from(sitepingLog)
    .where(and(...filtry))
    .orderBy(desc(sitepingLog.createdAt))
    .limit(MAX_ENTRIES)

  const od = new Date(Date.now() - RETENTION_DAYS * 24 * 60 * 60 * 1000)
  const zestawienie = await db
    .select({
      outcome: sitepingLog.outcome,
      ile: count(),
      ostatni: max(sitepingLog.createdAt),
    })
    .from(sitepingLog)
    .where(and(eq(sitepingLog.portalId, portalId), gte(sitepingLog.createdAt, od)))
    .groupBy(sitepingLog.outcome)

  // Kiedy przyszlo OSTATNIE UDANE ZGLOSZENIE (POST, nie odczyt panelu). To jest
  // jedyna liczba w tym widoku, ktora mowi „widget dziala u klienta naprawde",
  // bo tylko ona oznacza zadanie zalozone w ClickUpie.
  const [ostatnieZgloszenie] = await db
    .select({ kiedy: max(sitepingLog.createdAt) })
    .from(sitepingLog)
    .where(
      and(
        eq(sitepingLog.portalId, portalId),
        eq(sitepingLog.outcome, 'ok'),
        eq(sitepingLog.method, 'POST')
      )
    )

  return NextResponse.json({
    entries,
    summary: {
      days: RETENTION_DAYS,
      byOutcome: zestawienie,
      lastFeedbackAt: ostatnieZgloszenie?.kiedy ?? null,
    },
  })
}
