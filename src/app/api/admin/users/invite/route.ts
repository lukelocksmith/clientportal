import { NextRequest, NextResponse } from 'next/server'
import { z } from 'zod'
import { eq } from 'drizzle-orm'
import { render } from '@react-email/render'
import { isAdminRequest } from '@/lib/admin-auth'
import { db } from '@/lib/db'
import { portals, portalUsers } from '@/lib/db/schema'
import { createInvite, INVITE_TTL_HOURS } from '@/lib/invites'
import { sendMail, isMailConfigured } from '@/lib/mailer'
import { resolveBranding } from '@/lib/branding'
import { AccessEmail } from '@/emails/AccessEmail'

/**
 * Wysłanie użytkownikowi linku do ustawienia hasła, z panelu admina.
 *
 * Po co osobno od tworzenia konta: link wygasa po 72 godzinach, a maile giną.
 * Bez tego przycisku jedyną drogą było ustawienie hasła z ręki i przekazanie go
 * klientowi, czyli dokładnie to, czego cały ten mechanizm miał uniknąć: hasło
 * przechodzące przez nasze ręce i przez jakiś komunikator.
 *
 * Rodzaj wiadomości to 'invite', NIE 'reset', i to jest świadome. Treść resetu
 * mówi „dostaliśmy prośbę o zmianę hasła", a tutaj prośby nie było, bo wysyłkę
 * uruchamiamy my. Kłamstwo w pierwszym zdaniu maila o bezpieczeństwie jest
 * gorsze niż nieidealnie dopasowany nagłówek. Przy okazji 'invite' daje 72
 * godziny zamiast dwóch, co przy wysyłce z naszej strony jest właściwe:
 * klient nie siedzi przy ekranie i nie czeka.
 *
 * Poprzednie zaproszenia tego użytkownika tracą moc (createInvite), więc stary
 * link krążący w mailu przestaje działać.
 */
const schema = z.object({ userId: z.string().uuid() })

export async function POST(request: NextRequest) {
  if (!(await isAdminRequest(request))) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  const parsed = schema.safeParse(await request.json().catch(() => null))
  if (!parsed.success) {
    return NextResponse.json({ error: 'Podaj userId' }, { status: 400 })
  }

  const [user] = await db
    .select()
    .from(portalUsers)
    .where(eq(portalUsers.id, parsed.data.userId))
    .limit(1)
  if (!user) return NextResponse.json({ error: 'Nie ma takiego użytkownika' }, { status: 404 })

  const [portal] = await db.select().from(portals).where(eq(portals.id, user.portalId)).limit(1)
  if (!portal) return NextResponse.json({ error: 'Portal nie istnieje' }, { status: 404 })

  const { token, expiresAt } = await createInvite(user.id, portal.id)
  const appUrl = process.env.NEXT_PUBLIC_APP_URL ?? 'http://localhost:3000'
  const inviteUrl = `${appUrl}/${portal.slug}/zaproszenie/${token}`

  const branding = resolveBranding(portal)
  const email$ = AccessEmail({
    kind: 'invite',
    portalName: portal.name,
    recipientName: user.name,
    actionUrl: inviteUrl,
    expiresInHours: INVITE_TTL_HOURS,
    brandColor: branding.brandColor,
    brandForeground: branding.brandForeground,
  })

  const result = await sendMail({
    to: user.email,
    subject: `Twój dostęp do portalu ${portal.name}`,
    html: await render(email$),
    text: await render(email$, { plainText: true }),
    kind: 'invite',
    portalId: portal.id,
  })

  return NextResponse.json({
    sent: result.sent,
    expiresAt,
    // Link wracamy WYŁĄCZNIE gdy mail nie poszedł, żeby admin miał co przekazać
    // inną drogą. Przy udanej wysyłce nie ma powodu, by token krążył poza mailem.
    url: result.sent ? null : inviteUrl,
    reason: result.sent ? null : result.reason,
    detail: result.sent ? null : result.detail ?? null,
    mailConfigured: isMailConfigured(),
  })
}
