import { NextRequest, NextResponse } from 'next/server'
import { and, desc, eq, or, isNull } from 'drizzle-orm'
import { isAdminRequest } from '@/lib/admin-auth'
import { db } from '@/lib/db'
import { mailLog } from '@/lib/db/schema'
import { requireAdminPortal } from '@/lib/adminPortal'

/**
 * Rejestr wysłanych maili, do panelu admina.
 *
 * Powstał po zdarzeniu z 2026-08-03: dodano konto klientowi, osoba
 * powiedziała, że nie dostała zaproszenia, a ustalenie prawdy wymagało wejścia
 * po SSH do logów postfixa i odpytania API przekaźnika. Ten endpoint istnieje,
 * żeby ta odpowiedź była w panelu.
 *
 * Zwracamy też maile BEZ przypisanego projektu (`portal_id IS NULL`), bo
 * nieudana wysyłka może nie mieć kontekstu projektu, a to właśnie ona jest
 * najciekawsza.
 */
export async function GET(request: NextRequest) {
  if (!(await isAdminRequest(request))) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  const slug = request.nextUrl.searchParams.get('slug')
  if (!slug) return NextResponse.json({ error: 'Podaj slug' }, { status: 400 })

  const gate = await requireAdminPortal(slug)
  if (!gate.ok) return gate.response

  // Filtr po odbiorcy: „czy TEN adres cokolwiek od nas dostał". To pierwsze
  // pytanie, jakie się zadaje, gdy klient mówi, że maila nie ma.
  const recipient = request.nextUrl.searchParams.get('recipient')

  const filters = [or(eq(mailLog.portalId, gate.portal.id), isNull(mailLog.portalId))]
  if (recipient) filters.push(eq(mailLog.recipient, recipient))

  const rows = await db
    .select()
    .from(mailLog)
    .where(and(...filters))
    .orderBy(desc(mailLog.createdAt))
    .limit(100)

  return NextResponse.json({ mails: rows })
}
