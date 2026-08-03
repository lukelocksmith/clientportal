import { NextRequest, NextResponse } from 'next/server'
import { z } from 'zod'
import { and, eq } from 'drizzle-orm'
import { render } from '@react-email/render'
import { db } from '@/lib/db'
import { portals, portalUsers } from '@/lib/db/schema'
import { createInvite, resetRequestedRecently, RESET_TTL_HOURS } from '@/lib/invites'
import { sendMail } from '@/lib/mailer'
import { resolveBranding } from '@/lib/branding'
import { AccessEmail } from '@/emails/AccessEmail'

/**
 * „Nie pamiętam hasła". Trasa PUBLICZNA, więc ma trzy zabezpieczenia, których
 * zaproszenia nie potrzebowały:
 *
 * 1. NIE ZDRADZAMY, czy konto istnieje. Odpowiedź jest identyczna dla adresu
 *    istniejącego i wymyślonego. Inaczej ten formularz byłby narzędziem do
 *    sprawdzania, kto jest klientem important.is, a to informacja handlowa.
 * 2. ODSTĘP MIĘDZY PROŚBAMI. Bez niego każdy mógłby w pętli zasypywać cudzą
 *    skrzynkę naszymi mailami, co kończy się naszym serwerem na czarnej liście.
 *    Przy zadziałaniu odstępu odpowiedź jest TAKA SAMA jak przy sukcesie, bo
 *    inaczej różnica w odpowiedzi znowu zdradzałaby istnienie konta.
 * 3. KRÓTSZA WAŻNOŚĆ linku niż przy zaproszeniu (2 h wobec 72 h), bo tu
 *    użytkownik właśnie o niego poprosił i siedzi przy skrzynce.
 *
 * Konta nieaktywne pomijamy po cichu: dostęp odebrany to dostęp odebrany, a
 * reset hasła nie może być drogą powrotną.
 */
const schema = z.object({
  email: z.string().email().max(200).toLowerCase(),
  slug: z.string().min(1).max(50),
})

/** Jedna odpowiedź na wszystkie przypadki. Patrz punkt 1 powyżej. */
const NEUTRAL = {
  ok: true,
  message: 'Jeśli konto o tym adresie istnieje, wysłaliśmy na nie link do ustawienia nowego hasła.',
}

export async function POST(request: NextRequest) {
  const parsed = schema.safeParse(await request.json().catch(() => null))
  // Nawet przy popsutym wejściu nie mówimy nic konkretnego o adresie.
  if (!parsed.success) return NextResponse.json(NEUTRAL)

  const { email, slug } = parsed.data

  const [portal] = await db.select().from(portals).where(eq(portals.slug, slug)).limit(1)
  if (!portal) return NextResponse.json(NEUTRAL)

  const [user] = await db
    .select({ id: portalUsers.id, name: portalUsers.name, isActive: portalUsers.isActive })
    .from(portalUsers)
    .where(and(eq(portalUsers.email, email), eq(portalUsers.portalId, portal.id)))
    .limit(1)

  if (!user || !user.isActive) return NextResponse.json(NEUTRAL)

  if (await resetRequestedRecently(user.id)) {
    // Link już poszedł chwilę temu. Nie wysyłamy drugiego, ale odpowiadamy
    // tak samo, żeby nie ujawnić, że konto istnieje.
    return NextResponse.json(NEUTRAL)
  }

  const { token } = await createInvite(user.id, portal.id, 'reset')
  const appUrl = process.env.NEXT_PUBLIC_APP_URL ?? 'http://localhost:3000'
  const actionUrl = `${appUrl}/${slug}/zaproszenie/${token}`

  const branding = resolveBranding(portal)
  const email$ = AccessEmail({
    kind: 'reset',
    portalName: portal.name,
    recipientName: user.name,
    actionUrl,
    expiresInHours: RESET_TTL_HOURS,
    brandColor: branding.brandColor,
    brandForeground: branding.brandForeground,
  })

  const result = await sendMail({
    to: email,
    subject: `Zmiana hasła do portalu ${portal.name}`,
    html: await render(email$),
    text: await render(email$, { plainText: true }),
    kind: 'reset',
    portalId: portal.id,
  })

  if (!result.sent) {
    // Log dla nas, neutralna odpowiedź dla świata. Użytkownik i tak nic z tym
    // nie zrobi, a informacja „mail nie wyszedł" potwierdzałaby istnienie konta.
    console.error(`[forgot-password] mail do ${email} nie wyszedł:`, result.reason, result.detail ?? '')
  }

  return NextResponse.json(NEUTRAL)
}
