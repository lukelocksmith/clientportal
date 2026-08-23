import { render } from '@react-email/render'
import { createInvite, INVITE_TTL_HOURS } from './invites'
import { sendMail, isMailConfigured } from './mailer'
import { resolveBranding } from './branding'
import { AccessEmail } from '../emails/AccessEmail'

/**
 * Zaproszenie mailowe do portalu: token, link, wiadomość i odpowiedź dla
 * panelu. Wyciągnięte z dwóch tras (tworzenie konta i ponowna wysyłka
 * zaproszenia), które trzymały DOSŁOWNIE tę samą ~45-liniową sekwencję.
 * Kopie takiej logiki rozjeżdżają się przy pierwszej zmianie treści maila,
 * a tu dwie ścieżki muszą wysyłać identyczną wiadomość.
 *
 * Link wraca WYŁĄCZNIE gdy mail nie poszedł, żeby admin miał co przekazać
 * ręcznie. Przy udanej wysyłce nie ma powodu, by token krążył poza mailem.
 */
export async function sendInviteEmail(input: {
  userId: string
  userEmail: string
  userName: string | null
  portal: {
    id: string
    slug: string
    name: string
    logoUrl: string | null
    brandColor: string | null
  }
}): Promise<{
  sent: boolean
  expiresAt: Date
  url: string | null
  reason: string | null
  detail?: string | null
  mailConfigured: boolean
}> {
  const { token, expiresAt } = await createInvite(input.userId, input.portal.id)
  const appUrl = process.env.NEXT_PUBLIC_APP_URL ?? 'http://localhost:3000'
  const inviteUrl = `${appUrl}/${input.portal.slug}/zaproszenie/${token}`

  const branding = resolveBranding(input.portal)
  const email$ = AccessEmail({
    kind: 'invite',
    portalName: input.portal.name,
    recipientName: input.userName,
    actionUrl: inviteUrl,
    expiresInHours: INVITE_TTL_HOURS,
    brandColor: branding.brandColor,
    brandForeground: branding.brandForeground,
  })

  const result = await sendMail({
    to: input.userEmail,
    subject: `Twój dostęp do portalu ${input.portal.name}`,
    html: await render(email$),
    text: await render(email$, { plainText: true }),
    kind: 'invite',
    portalId: input.portal.id,
  })

  return {
    sent: result.sent,
    expiresAt,
    url: result.sent ? null : inviteUrl,
    reason: result.sent ? null : result.reason ?? null,
    detail: result.sent ? null : result.detail ?? null,
    mailConfigured: isMailConfigured(),
  }
}
