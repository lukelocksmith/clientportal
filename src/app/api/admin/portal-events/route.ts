import { NextRequest, NextResponse } from 'next/server'
import { eq } from 'drizzle-orm'
import { isAdminRequest } from '@/lib/admin-auth'
import { db } from '@/lib/db'
import { portals } from '@/lib/db/schema'
import {
  listPortalEvents,
  portalEventActors,
  EVENT_LABELS,
  type EventAction,
} from '@/lib/portalEvents'

/**
 * Historia zgłoszeń projektu, do panelu admina.
 *
 * Tylko dla admina. Klient NIE dostaje tego widoku: jego pracownicy widzieliby
 * wtedy, kto z ich strony co zamawiał, a to jest informacja o wewnętrznych
 * sprawach klienta, której nie mamy prawa im redystrybuować, choćby technicznie
 * była to ta sama tabela.
 *
 * Jedno zapytanie zwraca i listę zdarzeń, i listę osób. Osoby są potrzebne do
 * zbudowania filtra, a przy filtrze zawężonym do jednej osoby nie da się ich
 * odtworzyć z samej listy zdarzeń.
 */
const VALID_ACTIONS = Object.keys(EVENT_LABELS) as EventAction[]

export async function GET(request: NextRequest) {
  if (!(await isAdminRequest(request))) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  const slug = request.nextUrl.searchParams.get('slug')
  if (!slug) return NextResponse.json({ error: 'Podaj slug' }, { status: 400 })

  const [portal] = await db.select().from(portals).where(eq(portals.slug, slug)).limit(1)
  if (!portal) return NextResponse.json({ error: 'Portal nie istnieje' }, { status: 404 })

  const rawAction = request.nextUrl.searchParams.get('action')
  // Nieznana wartość jest ignorowana, nie odrzucana: filtr to wygoda, a nie
  // warunek poprawności, więc lepiej pokazać wszystko niż wyrzucić błąd.
  const action = VALID_ACTIONS.includes(rawAction as EventAction)
    ? (rawAction as EventAction)
    : undefined

  const email = request.nextUrl.searchParams.get('email') ?? undefined

  const [events, actors] = await Promise.all([
    listPortalEvents({ portalId: portal.id, action, userEmail: email, limit: 200 }),
    portalEventActors(portal.id),
  ])

  return NextResponse.json({ events, actors, labels: EVENT_LABELS })
}
