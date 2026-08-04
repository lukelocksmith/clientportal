import { RootLoginForm } from '@/components/auth/RootLoginForm'

/**
 * Strona główna portalu: formularz logowania.
 *
 * Wcześniej stała tu wizytówka z tekstem „Zaloguj się korzystając z linku
 * podanego przez agencję", czyli ślepy zaułek. Klient, który wpisał
 * `portal.important.is` z pamięci, a nie z maila, nie miał dokąd pójść.
 *
 * Dynamicznie, nie statycznie. Ta strona prowadzi do ustawienia ciasteczka
 * sesji, a statyczny HTML z rocznym cache'em to ten sam problem, który wysadził
 * panel admina 2026-08-03: przeglądarka trzymała powłokę wskazującą paczki
 * JavaScript, których po przebudowie już nie było, i strona zostawała martwa.
 */
export const dynamic = 'force-dynamic'

export const metadata = {
  title: 'Zaloguj się · Portal klienta important.is',
}

export default function RootPage() {
  return (
    <div className="flex min-h-screen items-center justify-center bg-muted/30 p-4">
      <div className="w-full max-w-sm">
        <div className="mb-8 text-center">
          <div className="mb-4 inline-flex h-12 w-12 items-center justify-center rounded-xl bg-primary text-xl font-bold text-primary-foreground">
            i
          </div>
          <h1 className="text-2xl font-bold text-foreground">Portal klienta</h1>
          <p className="mt-1 text-sm text-muted-foreground">
            Zaloguj się, żeby zobaczyć swój projekt.
          </p>
        </div>

        <div className="rounded-xl border border-border bg-card p-5">
          <RootLoginForm />
        </div>

        {/* Odzyskiwanie hasła jest per projekt (`/{slug}/przypomnienie`), a tutaj
            projektu jeszcze nie znamy. Zamiast zgadywać, podajemy adres, pod
            którym ktoś odpowie. Nie obiecujemy działania, którego nie ma. */}
        <p className="mt-4 text-center text-xs text-muted-foreground">
          Nie pamiętasz hasła albo nie możesz się dostać? Napisz na{' '}
          <a href="mailto:hi@important.is" className="underline hover:text-foreground">
            hi@important.is
          </a>
          .
        </p>

        <p className="mt-6 text-center text-xs text-muted-foreground">
          Portal dostarcza{' '}
          <a href="https://important.is" className="font-medium hover:underline">
            important.is
          </a>
        </p>
      </div>
    </div>
  )
}
