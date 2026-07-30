import { redirect } from 'next/navigation'
import { eq } from 'drizzle-orm'
import { db } from '@/lib/db'
import { portals } from '@/lib/db/schema'
import { resolveBranding } from '@/lib/branding'
import { LoginForm } from '@/components/auth/LoginForm'

interface Props {
  params: Promise<{ slug: string }>
}

/**
 * Ekran logowania do portalu klienta.
 *
 * Serwerowy, żeby pobrać markę projektu z bazy. Wcześniej cała strona była
 * kliencka i przez to rysowała kwadrat w kolorze important.is oraz pierwszą
 * literę SLUGA zamiast nazwy projektu. Pierwszy ekran, jaki widzi klient,
 * pokazywał więc naszą markę zamiast jego, dokładnie odwrotnie do zamiaru.
 *
 * Strona jest publiczna, `proxy.ts` przepuszcza `/login` bez sesji.
 */
export async function generateMetadata({ params }: Props) {
  const { slug } = await params
  const [portal] = await db
    .select({ name: portals.name })
    .from(portals)
    .where(eq(portals.slug, slug))
    .limit(1)
  // Szablon w layoucie dokleja " · important.is".
  return { title: portal ? `Logowanie: ${portal.name}` : 'Logowanie' }
}

export default async function LoginPage({ params }: Props) {
  const { slug } = await params

  const [portal] = await db.select().from(portals).where(eq(portals.slug, slug)).limit(1)
  if (!portal) redirect('/')

  const branding = resolveBranding(portal)

  return (
    <div className="flex min-h-screen items-center justify-center bg-muted/30 p-4">
      <div className="w-full max-w-md">
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
              {/* Pierwsza litera NAZWY projektu, nie sluga. */}
              {portal.name[0]?.toUpperCase()}
            </div>
          )}
          <h1 className="text-2xl font-bold text-foreground">{portal.name}</h1>
          <p className="mt-1 text-sm text-muted-foreground">
            Zaloguj się, aby zobaczyć swoje zadania
          </p>
        </div>

        <div className="rounded-xl border border-border bg-card p-6 shadow-sm">
          <LoginForm slug={slug} />
        </div>

        <p className="mt-6 text-center text-xs text-muted-foreground">
          Problemy z logowaniem? Skontaktuj się z nami.
        </p>
      </div>
    </div>
  )
}
