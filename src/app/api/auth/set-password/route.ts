import { NextRequest, NextResponse } from 'next/server'
import { z } from 'zod'
import { eq } from 'drizzle-orm'
import { db } from '@/lib/db'
import { portalUsers } from '@/lib/db/schema'
import { checkInvite, consumeInvite } from '@/lib/invites'
import { createSession, setSessionCookie } from '@/lib/auth'
import { sendPasswordChangedNotice } from '@/lib/passwordNotice'
import { logEvent, requestOrigin, EVENT_LOGIN, EVENT_PASSWORD_SET } from '@/lib/portalEvents'

/**
 * Ustawienie hasła z zaproszenia. Trasa PUBLICZNA: użytkownik jeszcze nie ma
 * hasła, więc nie może być zalogowany. Autoryzacją jest sam token.
 *
 * Minimum 10 znaków, więcej niż 8 wymagane przy zakładaniu konta przez admina.
 * Tam hasło jest tymczasowe i zaraz zmieniane, tutaj zostaje na stałe.
 */
const schema = z.object({
  token: z.string().min(16).max(200),
  password: z.string().min(10).max(200),
})

export async function POST(request: NextRequest) {
  const parsed = schema.safeParse(await request.json().catch(() => null))
  if (!parsed.success) {
    return NextResponse.json({ error: 'Hasło musi mieć co najmniej 10 znaków' }, { status: 400 })
  }

  const { token, password } = parsed.data

  // Sprawdzamy przed zużyciem, żeby móc oddać konkretny powód odmowy.
  const check = await checkInvite(token)
  if (!check.ok) {
    const messages = {
      expired: 'Link stracił ważność. Napisz do nas, wyślemy nowy.',
      used: 'Ten link został już użyty. Zaloguj się swoim hasłem.',
      'not-found': 'Nie znamy tego linku.',
    } as const
    return NextResponse.json({ error: messages[check.reason] }, { status: 400 })
  }

  const result = await consumeInvite(token, password)
  if (!result.ok) {
    // Jedyna realna droga tutaj to wyścig dwóch równoczesnych żądań z tym
    // samym tokenem. Warunek isNull(usedAt) w UPDATE przepuszcza tylko jedno.
    return NextResponse.json({ error: 'Ten link został już użyty.' }, { status: 409 })
  }

  // Logujemy od razu, żeby użytkownik nie musiał wpisywać hasła drugi raz
  // minutę po jego ustawieniu.
  const [user] = await db
    .select({ id: portalUsers.id })
    .from(portalUsers)
    .where(eq(portalUsers.id, check.userId))
    .limit(1)

  const skad = requestOrigin(request.headers)

  if (user) {
    const sessionToken = await createSession(user.id, skad.ip ?? undefined, skad.userAgent ?? undefined)
    await setSessionCookie(sessionToken)
  }

  // Dwa zdarzenia, nie jedno: ustawienie hasła i wejście do portalu to osobne
  // fakty. Bez pierwszego nie da się odpowiedzieć „czy on kiedykolwiek odebrał
  // zaproszenie", bo `createSession` nadpisuje tylko datę ostatniego wejścia.
  await logEvent({
    portalId: check.portalId,
    actor: { userId: check.userId, email: check.email, name: check.name },
    action: EVENT_PASSWORD_SET,
    meta: { ...skad, zrodlo: 'link z maila' },
  })

  if (user) {
    await logEvent({
      portalId: check.portalId,
      actor: { userId: check.userId, email: check.email, name: check.name },
      action: EVENT_LOGIN,
      meta: { ...skad, wejscie: 'po ustawieniu hasla' },
    })
  }

  // Powiadomienie PO fakcie, na adres konta. Zabezpieczenie, nie uprzejmość:
  // link do ustawienia hasła idzie mailem, a skrzynka jest tym, co przeciwnik
  // przechwytuje najczęściej. Bez tego maila przejęcie konta jest ciche.
  //
  // Dane bierzemy z `check`, czyli ze sprawdzenia SPRZED zużycia tokenu. Po
  // `consumeInvite` zaproszenie jest już oznaczone jako użyte, więc powtórne
  // `checkInvite` zwróciłoby 'used' i nie dałoby ani adresu, ani imienia.
  await sendPasswordChangedNotice({
    to: check.email,
    recipientName: check.name,
    portalId: check.portalId,
    portalSlug: result.portalSlug,
  })

  return NextResponse.json({ ok: true, slug: result.portalSlug })
}
