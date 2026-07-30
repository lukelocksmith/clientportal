import Link from 'next/link'
import { redirect } from 'next/navigation'
import { eq } from 'drizzle-orm'
import { db } from '@/lib/db'
import { portals } from '@/lib/db/schema'
import { checkInvite, INVITE_TTL_HOURS } from '@/lib/invites'
import { resolveBranding } from '@/lib/branding'
import { SetPasswordForm } from '@/components/invite/SetPasswordForm'

interface Props {
  params: Promise<{ slug: string; token: string }>
}

/**
 * Strona z linku w zaproszeniu: użytkownik ustawia tu własne hasło.
 *
 * Token sprawdzamy PRZED pokazaniem formularza, żeby nikt nie wpisywał hasła
 * do linku, który i tak nie zadziała. Trzy powody odmowy mają trzy różne
 * komunikaty, bo prowadzą do różnych działań: wygasły wymaga nowego linku,
 * zużyty wystarczy zalogowaniem, nieznany to najczęściej obcięty adres z maila.
 *
 * Strona jest publiczna z natury, więc `proxy.ts` musi ją przepuszczać bez
 * sesji, tak samo jak `/login`.
 */
export default async function InvitePage({ params }: Props) {
  const { slug, token } = await params

  const [portal] = await db.select().from(portals).where(eq(portals.slug, slug)).limit(1)
  if (!portal) redirect('/')

  const branding = resolveBranding(portal)
  const check = await checkInvite(token)

  const shell = (children: React.ReactNode) => (
    <div className="flex min-h-screen items-center justify-center bg-muted/30 p-4">
      <div className="w-full max-w-sm">
        <div className="mb-8 text-center">
          {branding.logoUrl ? (
            // eslint-disable-next-line @next/next/no-img-element
            <img
              src={branding.logoUrl}
              alt={portal.name}
              className="mx-auto mb-4 h-12 w-12 rounded-xl object-contain"
              style={{ backgroundColor: branding.brandColor }}
            />
          ) : (
            <div
              className="mx-auto mb-4 inline-flex h-12 w-12 items-center justify-center rounded-xl text-xl font-bold"
              style={{ backgroundColor: branding.brandColor, color: branding.brandForeground }}
            >
              {portal.name[0]?.toUpperCase()}
            </div>
          )}
          <h1 className="text-lg font-semibold text-foreground">{portal.name}</h1>
        </div>
        <div className="rounded-xl border border-border bg-card p-6">{children}</div>
      </div>
    </div>
  )

  if (!check.ok) {
    const messages: Record<typeof check.reason, { title: string; body: string; showLogin: boolean }> = {
      expired: {
        title: 'Link stracił ważność',
        body: `Zaproszenia są ważne ${INVITE_TTL_HOURS} godziny. Napisz do nas, wyślemy nowe.`,
        showLogin: false,
      },
      used: {
        title: 'Hasło jest już ustawione',
        body: 'Ten link został użyty. Zaloguj się swoim hasłem.',
        showLogin: true,
      },
      'not-found': {
        title: 'Nie znamy tego linku',
        body: 'Sprawdź, czy adres z maila skopiował się w całości. Jeśli tak, napisz do nas.',
        showLogin: false,
      },
    }
    const m = messages[check.reason]
    return shell(
      <div className="text-center">
        <h2 className="font-semibold text-foreground">{m.title}</h2>
        <p className="mt-2 text-sm text-muted-foreground">{m.body}</p>
        {m.showLogin && (
          <Link
            href={`/${slug}/login`}
            className="mt-4 inline-block text-sm text-primary hover:underline"
          >
            Przejdź do logowania
          </Link>
        )}
      </div>
    )
  }

  return shell(
    <>
      <h2 className="font-semibold text-foreground">Ustaw swoje hasło</h2>
      <p className="mt-1 text-sm text-muted-foreground">
        Konto: <span className="text-foreground">{check.email}</span>
      </p>
      <div className="mt-4">
        <SetPasswordForm slug={slug} token={token} />
      </div>
    </>
  )
}
