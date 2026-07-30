import Link from 'next/link'
import { redirect } from 'next/navigation'
import { ArrowRight, Mail, Phone } from 'lucide-react'
import { isTabEnabled, visibleTabs } from '@/lib/portalTabs'
import { getPortalForSession } from '@/lib/portalSession'
import { contactEnv, phoneHref, resolveContacts } from '@/lib/portalContact'
import { PortalHeader } from '@/components/PortalHeader'
import { PanicButton } from '@/components/PanicButton'
import { BrandMark } from '@/components/BrandMark'
import { IdeaForm } from '@/components/dashboard/IdeaForm'

interface DashboardPageProps {
  params: Promise<{ slug: string }>
}

/**
 * Zakładka Dashboard: kontakt do opiekuna projektu, skróty do pozostałych
 * zakładek i alarm.
 *
 * Świadomie NIE ma tu żadnych liczników zadań. Kanban liczy na żywo z ClickUpa,
 * a lustro Historii ma stan z ostatniej synchronizacji, więc licznik na
 * dashboardzie pokazywałby czasem inną wartość niż tablica obok. Klient
 * zestawiłby dwie zakładki i zapytał, której wierzyć. Ten sam powód, dla
 * którego w Historii nie ma kolumny z czasem.
 */
export default async function DashboardPage({ params }: DashboardPageProps) {
  const { slug } = await params

  const result = await getPortalForSession(slug)
  if (!result.ok) redirect(result.reason === 'no-portal' ? '/' : `/${slug}/login`)
  const { session, portal, flags, branding } = result

  // Brama po stronie serwera, jak w pozostałych zakładkach.
  if (!isTabEnabled(flags, 'dashboard')) redirect(`/${slug}`)

  const contacts = resolveContacts(portal, contactEnv())

  // Skróty do wszystkiego poza samym dashboardem. Lista jedzie z tego samego
  // źródła co zakładki w headerze, więc nie może się z nimi rozjechać.
  const shortcuts = visibleTabs(flags).filter(tab => tab.key !== 'dashboard')

  return (
    <div className="min-h-screen bg-background">
      <PortalHeader
        slug={slug}
        portalName={portal.name}
        userEmail={session.email}
        flags={flags}
        branding={branding}
      />

      <main className="mx-auto max-w-5xl px-6 py-8">
        <h1 className="text-2xl font-semibold text-foreground">{portal.name}</h1>
        <p className="mt-1 text-sm text-muted-foreground">
          Tu znajdziesz kontakt do nas i skróty do swojego projektu.
        </p>

        <div className="mt-6 grid gap-4 md:grid-cols-2">
          <section className="rounded-xl border border-border bg-card p-5">
            <h2 className="text-sm font-semibold text-foreground">Kontakt</h2>
            <p className="mt-0.5 text-xs text-muted-foreground">
              Piszcie w każdej sprawie, także drobnej.
            </p>

            {/* Lista, nie jedna osoba: projekt ma opiekuna technicznego i
                project managera, a klient powinien wiedzieć, do kogo z czym. */}
            <ul className="mt-4 space-y-4">
              {contacts.map(contact => (
                <li key={contact.email}>
                  {contact.roleLabel && (
                    <p className="text-[10px] uppercase tracking-wide text-muted-foreground">
                      {contact.roleLabel}
                    </p>
                  )}
                  <p className="text-sm font-medium text-foreground">{contact.name}</p>
                  <a
                    href={`mailto:${contact.email}`}
                    className="mt-0.5 inline-flex items-center gap-2 text-sm text-foreground transition-colors hover:text-primary"
                  >
                    <Mail className="h-4 w-4 shrink-0 text-muted-foreground" />
                    {contact.email}
                  </a>

                  {/* Telefon rysujemy tylko wtedy, gdy ktoś go faktycznie podał.
                      Puste pole „Telefon:" wygląda na niedokończony portal. */}
                  {contact.phone && (
                    <div>
                      <a
                        href={phoneHref(contact.phone)}
                        className="inline-flex items-center gap-2 text-sm text-foreground transition-colors hover:text-primary"
                      >
                        <Phone className="h-4 w-4 shrink-0 text-muted-foreground" />
                        {contact.phone}
                      </a>
                    </div>
                  )}
                </li>
              ))}
            </ul>
          </section>

          <section className="rounded-xl border border-border bg-card p-5">
            <h2 className="text-sm font-semibold text-foreground">Coś pilnego?</h2>
            <p className="mt-0.5 text-xs text-muted-foreground">
              Alarm trafia od razu do zespołu, na Discorda i mailem. Używajcie, gdy sprawa nie może
              czekać na odpowiedź na maila.
            </p>
            <div className="mt-4">
              <PanicButton slug={slug} />
            </div>
          </section>
        </div>

        {/* Pomysly klienta na ulepszenie portalu. Osobna sekcja na pelnej
            szerokosci, bo to zaproszenie do pisania, a nie kolejna kafelka
            w rzedzie: obok Kontaktu i Alarmu przepadloby. */}
        <section className="mt-4 rounded-xl border border-border bg-card p-5">
          <h2 className="text-sm font-semibold text-foreground">
            Masz pomysł, jak ulepszyć ten portal?
          </h2>
          <p className="mt-0.5 text-xs text-muted-foreground">
            Napisz, czego brakuje albo co przeszkadza. Czytamy każdy pomysł i dopisujemy je do
            naszej listy zadań.
          </p>
          <div className="mt-3">
            <IdeaForm slug={slug} />
          </div>
        </section>

        {shortcuts.length > 0 && (
          <div className="mt-4 grid gap-3 sm:grid-cols-2 md:grid-cols-3">
            {shortcuts.map(tab => (
              <Link
                key={tab.key}
                href={`/${slug}${tab.path}`}
                className="group flex items-center justify-between rounded-xl border border-border bg-card px-5 py-4 transition-colors hover:bg-muted/50"
              >
                <span className="text-sm font-medium text-foreground">{tab.label}</span>
                <ArrowRight className="h-4 w-4 text-muted-foreground transition-transform group-hover:translate-x-0.5" />
              </Link>
            ))}
          </div>
        )}

        <BrandMark className="mt-10 text-center text-xs text-muted-foreground" />
      </main>
    </div>
  )
}
