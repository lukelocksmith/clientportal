import { NextRequest, NextResponse } from 'next/server'
import { desc, eq } from 'drizzle-orm'
import { isAdminRequest } from '@/lib/admin-auth'
import { db } from '@/lib/db'
import { aiChatLogs } from '@/lib/db/schema'
import { requireAdminPortal } from '@/lib/adminPortal'

/**
 * Zapisy rozmów z asystentem AI, do panelu admina.
 *
 * PO CO (30.08): zgłoszenie zrobione przez asystenta nie pojawiło się na
 * tablicy i nie dało się ustalić dlaczego — z rozmowy nie zostawało nic poza
 * liczbą tokenów w `ai_usage`. Tu leży pełna treść: co napisał klient, co
 * odpisał model, czy wywołał narzędzie i co ono oddało.
 *
 * Tylko dla admina, jak każda trasa w tym katalogu. Transkrypt zawiera treść
 * pisaną przez klienta, więc nie ma prawa wyjść poza panel.
 */
export async function GET(request: NextRequest) {
  if (!(await isAdminRequest(request))) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  const slug = request.nextUrl.searchParams.get('slug')
  if (!slug) return NextResponse.json({ error: 'Podaj slug' }, { status: 400 })

  const gate = await requireAdminPortal(slug)
  if (!gate.ok) return gate.response

  // Pięćdziesiąt rozmów, nie dwieście: każdy wiersz niesie ze sobą cały
  // transkrypt, więc to jest odpowiedź liczona w setkach kilobajtów.
  const rows = await db
    .select()
    .from(aiChatLogs)
    .where(eq(aiChatLogs.portalId, gate.portal.id))
    .orderBy(desc(aiChatLogs.createdAt))
    .limit(50)

  return NextResponse.json({ chats: rows })
}
