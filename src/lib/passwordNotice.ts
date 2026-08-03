import { render } from '@react-email/render'
import { eq } from 'drizzle-orm'
import { db } from './db'
import { portals } from './db/schema'
import { resolveBranding } from './branding'
import { sendMail } from './mailer'
import { PasswordChangedEmail } from '@/emails/PasswordChangedEmail'

/**
 * Powiadomienie o zmianie hasła.
 *
 * Osobny moduł, nie kod w trasie, bo hasło zmienia się dziś w jednym miejscu
 * (ustawienie z linku), ale zmieni się też w każdym kolejnym, jakie dojdzie:
 * zmiana z panelu, wymuszona rotacja. Powiadomienie, które trzeba pamiętać
 * dopisać, nie zostanie dopisane.
 *
 * Adres kontaktowy jest agencyjny, nie opiekuna projektu. Zgłoszenie „to nie ja
 * zmieniałem hasło" jest pilne i musi trafić tam, gdzie ktoś jest, a nie do
 * jednej osoby, która może być na urlopie.
 */
const SECURITY_CONTACT = 'hi@important.is'

/** Czas polski, nie UTC: odbiorca porównuje to z własnym zegarem. */
export function formatChangedAt(at: Date): string {
  const data = at.toLocaleDateString('pl-PL', {
    day: '2-digit',
    month: '2-digit',
    year: 'numeric',
    timeZone: 'Europe/Warsaw',
  })
  const godzina = at.toLocaleTimeString('pl-PL', {
    hour: '2-digit',
    minute: '2-digit',
    timeZone: 'Europe/Warsaw',
  })
  return `${data} o ${godzina}`
}

/**
 * Wysyła powiadomienie. NIGDY nie rzuca wyjątkiem.
 *
 * Hasło w tym momencie jest już zmienione, a użytkownik zalogowany. Wyjątek
 * z wysyłki maila pokazałby mu „nie udało się" po operacji, która się udała,
 * i skłoniłby do ustawiania hasła po raz drugi tym samym, już zużytym linkiem.
 */
export async function sendPasswordChangedNotice(input: {
  to: string
  recipientName: string | null
  portalId: string
  portalSlug: string
  changedAt?: Date
}): Promise<void> {
  try {
    const [portal] = await db.select().from(portals).where(eq(portals.id, input.portalId)).limit(1)
    if (!portal) return

    const appUrl = process.env.NEXT_PUBLIC_APP_URL ?? 'http://localhost:3000'
    const branding = resolveBranding(portal)

    const email$ = PasswordChangedEmail({
      portalName: portal.name,
      recipientName: input.recipientName,
      loginUrl: `${appUrl}/${input.portalSlug}/login`,
      changedAt: formatChangedAt(input.changedAt ?? new Date()),
      contactEmail: SECURITY_CONTACT,
      brandColor: branding.brandColor,
      brandForeground: branding.brandForeground,
    })

    await sendMail({
      to: input.to,
      kind: 'password-changed',
      portalId: input.portalId,
      subject: `Hasło do portalu ${portal.name} zostało zmienione`,
      html: await render(email$),
      text: await render(email$, { plainText: true }),
    })
  } catch (e) {
    console.error('[passwordNotice] nie udało się wysłać powiadomienia:', e)
  }
}
