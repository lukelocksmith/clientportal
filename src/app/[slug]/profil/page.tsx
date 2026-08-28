import { redirect } from 'next/navigation'
import { ShieldAlert } from '@/lib/icons'
import { getPortalForSession } from '@/lib/portalSession'
import { normalizeActorId } from '@/lib/reporter'
import { avatarInitials } from '@/lib/profile'
import { getProfile } from '@/lib/profileStore'
import { PortalHeader } from '@/components/PortalHeader'
import { BrandMark } from '@/components/BrandMark'
import { NameForm } from '@/components/profile/NameForm'
import { AvatarForm } from '@/components/profile/AvatarForm'
import { PasswordForm } from '@/components/profile/PasswordForm'

interface ProfilPageProps {
  params: Promise<{ slug: string }>
}

/**
 * Profil użytkownika: imię, zdjęcie, hasło.
 *
 * Za tą samą bramą sesji co pozostałe zakładki, ale BEZ flagi projektu i bez
 * wpisu w `portalTabs`. Powód: to nie jest funkcja, którą włącza się klientowi,
 * tylko ustawienia własnego konta, których każdy zalogowany musi mieć jak
 * dosięgnąć. Do tej pory imię i hasło zmieniał wyłącznie admin przez token API.
 *
 * ŚWIADOMIE NIE MA TU ustawień powiadomień, mimo że przewiduje je spec z 6.08.
 * O kanałach powiadomień decyduje administrator per projekt
 * (`portals.notification_config`, decyzja z 24.08), więc przełącznik na
 * profilu klienta albo kłamałby, albo obchodziłby tamtą decyzję bokiem.
 */
export default async function ProfilPage({ params }: ProfilPageProps) {
  const { slug } = await params

  const result = await getPortalForSession(slug)
  if (!result.ok) redirect(result.reason === 'no-portal' ? '/' : `/${slug}/login`)
  const { session, portal, flags, branding } = result

  // Sesja admina ma `userId: 'admin'` i NIE jest wierszem w `portal_users`.
  // Podgląd portalu ma działać, ale nie ma tu czego edytować: hasło admina
  // siedzi w zmiennej środowiskowej, a imienia i zdjęcia takie konto nie ma.
  const userId = normalizeActorId(session.userId)
  const profile = userId ? await getProfile(userId, portal.id) : null

  return (
    <div className="min-h-screen bg-background">
      <PortalHeader
        slug={slug}
        portalName={portal.name}
        userEmail={session.email}
        flags={flags}
        branding={branding}
      />

      <main className="mx-auto max-w-2xl px-6 py-8">
        <h1 className="text-2xl font-semibold text-foreground">Twój profil</h1>
        <p className="mt-1 text-sm text-muted-foreground">
          Ustawienia Twojego konta w portalu {portal.name}.
        </p>

        {!profile ? (
          <div className="mt-6 flex items-start gap-3 rounded-xl border border-border bg-card p-5">
            <ShieldAlert className="mt-0.5 h-5 w-5 shrink-0 text-muted-foreground" />
            <div>
              <h2 className="text-sm font-semibold text-foreground">
                To jest podgląd administratora
              </h2>
              <p className="mt-1 text-sm text-muted-foreground">
                Oglądasz portal w trybie obejścia admina, więc nie ma tu konta klienta do
                edycji. Zaloguj się kontem użytkownika tego projektu, żeby zmienić imię,
                zdjęcie albo hasło.
              </p>
            </div>
          </div>
        ) : (
          <div className="mt-6 space-y-4">
            <section className="rounded-xl border border-border bg-card p-5">
              <h2 className="text-sm font-semibold text-foreground">Zdjęcie</h2>
              <p className="mt-0.5 mb-4 text-xs text-muted-foreground">
                Nieobowiązkowe. Bez zdjęcia pokazujemy inicjały.
              </p>
              <AvatarForm
                slug={slug}
                hasAvatar={profile.hasAvatar}
                initials={avatarInitials(profile.name, profile.email)}
              />
            </section>

            <section className="rounded-xl border border-border bg-card p-5">
              <h2 className="text-sm font-semibold text-foreground">Dane konta</h2>
              <p className="mt-0.5 mb-4 text-xs text-muted-foreground">
                Adres {profile.email} jest Twoim loginem. Zmienia go administrator.
              </p>
              <NameForm slug={slug} initialName={profile.name} />
            </section>

            <section className="rounded-xl border border-border bg-card p-5">
              <h2 className="text-sm font-semibold text-foreground">Hasło</h2>
              <p className="mt-0.5 mb-4 text-xs text-muted-foreground">
                Prosimy o obecne hasło, żeby nikt, kto usiądzie przy Twoim niezablokowanym
                komputerze, nie przejął konta.
              </p>
              <PasswordForm slug={slug} />
            </section>
          </div>
        )}

        <BrandMark className="mt-10 text-center text-xs text-muted-foreground" />
      </main>
    </div>
  )
}
