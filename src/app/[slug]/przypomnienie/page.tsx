import Link from 'next/link'
import { redirect } from 'next/navigation'
import { eq } from 'drizzle-orm'
import { db } from '@/lib/db'
import { portals } from '@/lib/db/schema'
import { resolveBranding } from '@/lib/branding'
import { ForgotPasswordForm } from '@/components/invite/ForgotPasswordForm'
import { BrandMark } from '@/components/BrandMark'

interface Props {
  params: Promise<{ slug: string }>
}

/**
 * „Nie pamiętam hasła". Strona publiczna, jak logowanie i zaproszenie.
 *
 * Świadomie NIE sprawdzamy tutaj, czy konto istnieje, i nie mówimy tego
 * użytkownikowi po wysłaniu. Inaczej ta strona byłaby narzędziem do
 * sprawdzania, kto jest klientem important.is.
 */
export default async function ForgotPasswordPage({ params }: Props) {
  const { slug } = await params

  const [portal] = await db.select().from(portals).where(eq(portals.slug, slug)).limit(1)
  if (!portal) redirect('/')

  const branding = resolveBranding(portal)

  return (
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

        <div className="rounded-xl border border-border bg-card p-6">
          <h2 className="font-semibold text-foreground">Nie pamiętam hasła</h2>
          <p className="mt-1 text-sm text-muted-foreground">
            Podaj swój adres e-mail. Wyślemy link do ustawienia nowego hasła.
          </p>
          <div className="mt-4">
            <ForgotPasswordForm slug={slug} />
          </div>
        </div>

        <p className="mt-4 text-center text-sm">
          <Link href={`/${slug}/login`} className="text-muted-foreground hover:text-foreground">
            Wróć do logowania
          </Link>
        </p>

        <BrandMark className="mt-6 text-center text-xs text-muted-foreground" />
      </div>
    </div>
  )
}
