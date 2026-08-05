import { NextRequest, NextResponse } from 'next/server'
import { and, desc, eq } from 'drizzle-orm'
import { isAdminRequest } from '@/lib/admin-auth'
import { db } from '@/lib/db'
import { mailLog, portals, portalUsers, sessions } from '@/lib/db/schema'
import { listPortalEvents, EVENT_LABELS } from '@/lib/portalEvents'

/**
 * Wszystko o jednej osobie w jednym miejscu: stan konta, co zgłosiła, kiedy
 * wchodziła, jakie maile do niej poszły.
 *
 * Jeden endpoint, nie trzy, bo to jest jeden widok w panelu. Trzy osobne
 * zapytania z przeglądarki znaczyłyby trzy stany wczytywania i trzy możliwe
 * błędy w jednym okienku, a przy pytaniu „czy on dostał dostęp" chodzi właśnie
 * o zestawienie tych rzeczy obok siebie.
 *
 * Historia idzie po ADRESIE, nie po `user_id`. Konto można usunąć i założyć
 * ponownie z tym samym adresem, a wtedy `user_id` jest nowy, choć rozmawiamy
 * o tej samej osobie i tej samej historii współpracy. Adres jest tym, co trwa.
 *
 * Tylko dla admina. To zestawienie mówi, kto u klienta co zamawiał i o której
 * się logował; klient nie dostaje takiego widoku na własnych pracowników.
 */
export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ userId: string }> }
) {
  if (!(await isAdminRequest(request))) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  const { userId } = await params

  const [user] = await db
    .select({
      id: portalUsers.id,
      email: portalUsers.email,
      name: portalUsers.name,
      isActive: portalUsers.isActive,
      failedAttempts: portalUsers.failedAttempts,
      lockedUntil: portalUsers.lockedUntil,
      lastLoginAt: portalUsers.lastLoginAt,
      createdAt: portalUsers.createdAt,
      portalId: portalUsers.portalId,
      portalName: portals.name,
      portalSlug: portals.slug,
    })
    .from(portalUsers)
    .leftJoin(portals, eq(portalUsers.portalId, portals.id))
    .where(eq(portalUsers.id, userId))
    .limit(1)

  if (!user) return NextResponse.json({ error: 'Nie ma takiego użytkownika' }, { status: 404 })

  const [events, mail, activeSessions] = await Promise.all([
    listPortalEvents({ portalId: user.portalId, userEmail: user.email, limit: 200 }),
    // Maile per adres ORAZ per projekt. Bez warunku na projekt ten sam adres
    // w dwóch projektach pokazywałby w obu tę samą listę wysyłek.
    db
      .select({
        id: mailLog.id,
        kind: mailLog.kind,
        subject: mailLog.subject,
        ok: mailLog.ok,
        detail: mailLog.detail,
        createdAt: mailLog.createdAt,
      })
      .from(mailLog)
      .where(and(eq(mailLog.recipient, user.email), eq(mailLog.portalId, user.portalId)))
      .orderBy(desc(mailLog.createdAt))
      .limit(50),
    // Czynne sesje: ile urządzeń ma dziś dostęp. Tabela `sessions` NIE jest
    // historią wejść, bo wiersze wygasają i giną przy wylogowaniu. Historia
    // wejść jest w zdarzeniach; to jest stan na teraz.
    db
      .select({
        id: sessions.id,
        createdAt: sessions.createdAt,
        expiresAt: sessions.expiresAt,
        ip: sessions.ip,
        userAgent: sessions.userAgent,
      })
      .from(sessions)
      .where(eq(sessions.userId, user.id))
      .orderBy(desc(sessions.createdAt))
      .limit(20),
  ])

  return NextResponse.json({
    user,
    events,
    mail,
    sessions: activeSessions,
    labels: EVENT_LABELS,
  })
}
