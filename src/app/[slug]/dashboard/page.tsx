import Link from 'next/link'
import { redirect } from 'next/navigation'
import { ArrowRight, Check, ExternalLink, Mail, Phone } from 'lucide-react'
import { isTabEnabled, visibleTabs } from '@/lib/portalTabs'
import { getRecentlyClosed } from '@/lib/taskIndex'
import { getProjectLinks } from '@/lib/projectLinksStore'
import { getPortalForSession } from '@/lib/portalSession'
import { contactEnv, phoneHref, resolveContacts } from '@/lib/portalContact'
import { getTimeEntries } from '@/lib/clickup'
import type { ClickUpTimeEntry } from '@/lib/types'
import { getPortalScope } from '@/lib/portalScopeStore'
import { filterTimeEntriesToScope } from '@/lib/portalScope'
import { buildReport, currentWeekToDate, listPeriods } from '@/lib/timeReports'
import { formatDuration } from '@/lib/utils'
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

  // Ostatnia aktywnosc czytana z lustra Historii. Gdy Historia nie jest
  // wlaczona dla projektu, indeks moze byc pusty albo zalegly, wiec blok
  // pokazujemy tylko wtedy, gdy faktycznie cos w nim jest. Pusta sekcja
  // "Ostatnio zrobione" wygladalaby, jakbysmy nic nie robili.
  const [recentlyClosed, projectLinks] = await Promise.all([
    getRecentlyClosed(portal.id, 5),
    getProjectLinks(portal.id),
  ])

  /**
   * Godziny w tym tygodniu, od poniedziałku.
   *
   * Liczone DOKŁADNIE tak samo jak w Raportach, przez `buildReport`, więc z tym
   * samym 10-procentowym narzutem za organizację pracy. Własne sumowanie dałoby
   * drugą, mniejszą liczbę w tym samym portalu, a klient porównuje ją z fakturą.
   *
   * Blok jest za flagą RAPORTÓW, nie Dashboardu. Czas pracy jest informacją
   * rozliczeniową i jest celowo za flagą; pokazanie go na Dashboardzie projektu
   * z wyłączonymi Raportami obeszłoby tę decyzję bokiem.
   *
   * `null` oznacza „nie wiemy", nie „zero". Gdy ClickUp nie odpowie, blok się
   * nie pokazuje, bo zero godzin przy przepracowanym tygodniu to nie brak
   * danych, to nieprawda.
   */
  let weekMs: number | null = null
  let prevWeekMs: number | null = null
  let prevWeekLabel: string | null = null
  if (isTabEnabled(flags, 'raporty')) {
    try {
      const week = currentWeekToDate()
      // Poprzedni tydzień bierzemy z `listPeriods`, a nie liczymy sami: ta
      // funkcja zaczyna od ostatniego ZAMKNIĘTEGO okresu, czyli zwraca dokładnie
      // ten sam obiekt, którego używa zakładka Raporty. Dzięki temu obie liczby
      // pochodzą z jednego źródła i nie ma jak się rozjechać.
      const prev = listPeriods('tydzien', 1)[0]
      prevWeekLabel = prev?.label ?? null

      // Trzy pobrania są niezależne, więc lecą równolegle.
      const [scope, entries, prevEntries] = await Promise.all([
        getPortalScope(portal.id),
        getTimeEntries(portal.clickupFolderId, week.startMs, week.endMs),
        prev
          ? getTimeEntries(portal.clickupFolderId, prev.startMs, prev.endMs)
          : Promise.resolve([] as ClickUpTimeEntry[]),
      ])

      weekMs = buildReport(week, filterTimeEntriesToScope(entries, scope)).totalMs
      if (prev) {
        prevWeekMs = buildReport(prev, filterTimeEntriesToScope(prevEntries, scope)).totalMs
      }
    } catch (error) {
      // Jeden catch na oba okresy: przy awarii ClickUpa nie chcemy pokazać
      // jednej liczby i zgubić drugiej, bo klient nie wiedziałby, czy druga to
      // zero, czy brak danych.
      console.error('[dashboard] nie udalo sie policzyc godzin:', error)
      weekMs = null
      prevWeekMs = null
    }
  }

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

        {/* Godziny tego tygodnia. Jedna liczba, ta sama metoda co w Raportach,
            razem z narzutem, żeby nie było dwóch różnych sum w jednym portalu.
            Blok znika, gdy ClickUp nie odpowie: zero godzin przy przepracowanym
            tygodniu byłoby nieprawdą, nie brakiem danych. */}
        {weekMs !== null && (
          <div className="mt-5 rounded-xl border border-border bg-card px-5 py-4">
            <div className="flex flex-wrap gap-x-10 gap-y-3">
              <div>
                <p className="text-[10px] uppercase tracking-wide text-muted-foreground">
                  W tym tygodniu
                </p>
                <p className="mt-0.5 text-2xl font-semibold text-foreground">
                  {formatDuration(weekMs) || '0m'}
                </p>
                <p className="text-[10px] text-muted-foreground">od poniedziałku, na bieżąco</p>
              </div>

              {prevWeekMs !== null && (
                <div>
                  <p className="text-[10px] uppercase tracking-wide text-muted-foreground">
                    Poprzedni tydzień
                  </p>
                  <p className="mt-0.5 text-2xl font-semibold text-foreground">
                    {formatDuration(prevWeekMs) || '0m'}
                  </p>
                  {/* Etykieta okresu, nie samo słowo „poprzedni": bez daty
                      klient nie wie, czy chodzi o tydzień kalendarzowy, czy
                      o ostatnie siedem dni. */}
                  <p className="text-[10px] text-muted-foreground">{prevWeekLabel ?? 'zamknięty'}</p>
                </div>
              )}
            </div>

            <p className="mt-3 text-xs text-muted-foreground">
              Czas pracy razem z narzutem za organizację pracy. Rozbicie na zadania jest w{' '}
              <Link href={`/${slug}/raporty`} className="underline hover:text-foreground">
                Raportach
              </Link>
              .
            </p>
          </div>
        )}

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
                // Klucz z adresu, a gdy go nie ma (kontakt podany samym
                // telefonem) z numeru. Nazwa jako ostatnia deska ratunku.
                <li key={contact.email ?? contact.phone ?? contact.name}>
                  {contact.roleLabel && (
                    <p className="text-[10px] uppercase tracking-wide text-muted-foreground">
                      {contact.roleLabel}
                    </p>
                  )}
                  <p className="text-sm font-medium text-foreground">{contact.name}</p>
                  {contact.email && (
                    <a
                      href={`mailto:${contact.email}`}
                      className="mt-0.5 inline-flex items-center gap-2 text-sm text-foreground transition-colors hover:text-primary"
                    >
                      <Mail className="h-4 w-4 shrink-0 text-muted-foreground" />
                      {contact.email}
                    </a>
                  )}

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

        {/* Linki projektu. Pokazujemy sekcje tylko wtedy, gdy cokolwiek jest
            skonfigurowane: pusta ramka "Linki" mowilaby klientowi, ze czegos
            zapomnielismy, a najczesciej po prostu nie ma czego linkowac. */}
        {projectLinks.length > 0 && (
          <section className="mt-4 rounded-xl border border-border bg-card p-5">
            <h2 className="text-sm font-semibold text-foreground">Linki projektu</h2>
            <ul className="mt-3 grid gap-2 sm:grid-cols-2">
              {projectLinks.map(link => (
                <li key={link.url}>
                  <a
                    href={link.url}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="inline-flex items-center gap-2 text-sm text-foreground transition-colors hover:text-primary"
                  >
                    <ExternalLink className="h-4 w-4 shrink-0 text-muted-foreground" />
                    {link.label}
                  </a>
                </li>
              ))}
            </ul>
          </section>
        )}

        {recentlyClosed.length > 0 && (
          <section className="mt-4 rounded-xl border border-border bg-card p-5">
            <h2 className="text-sm font-semibold text-foreground">Ostatnio zrobione</h2>
            <p className="mt-0.5 text-xs text-muted-foreground">
              Pięć najnowszych domkniętych zgłoszeń. Pełna lista jest w Historii.
            </p>
            {/* Swiadomie BEZ licznikow typu "w tym miesiacu zamknelismy 12".
                Taka liczba rozjechalaby sie z kanbanem, ktory liczy na zywo
                z ClickUpa, a lustro ma stan z ostatniej synchronizacji. Lista
                pozycji tego problemu nie ma. */}
            <ul className="mt-3 space-y-2">
              {recentlyClosed.map(task => (
                <li key={task.clickupTaskId} className="flex items-start gap-2 text-sm">
                  <Check className="mt-0.5 h-4 w-4 shrink-0 text-green-500" />
                  <span className="flex-1 text-foreground">{task.name}</span>
                  <span className="shrink-0 tabular-nums text-xs text-muted-foreground">
                    {new Date(task.dateClosed).toLocaleDateString('pl-PL', {
                      day: '2-digit',
                      month: '2-digit',
                      year: 'numeric',
                    })}
                  </span>
                </li>
              ))}
            </ul>
          </section>
        )}

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
