/**
 * Kto zgłosił. CZYSTY moduł: bez bazy, bez Next, bez zegara.
 *
 * Dwa niezależne odbiorniki tej samej informacji:
 *
 *   1. ClickUp — stopka w opisie zadania, żeby osoba z zespołu widziała autora
 *      tam, gdzie pracuje, bez zaglądania do portalu.
 *   2. Nasza baza — `audit_log`, czyli historia per osoba.
 *
 * ŹRÓDŁEM PRAWDY JEST BAZA, nie stopka. Opis zadania w części pochodzi od
 * klienta, więc treść typu „Zgłoszone przez: Filip" da się w nim po prostu
 * napisać. Stopka jest wygodą dla zespołu, a nie dowodem; przy pytaniu „kto to
 * zgłosił" patrzymy w `audit_log`.
 */

/** Skąd przyszło zgłoszenie. Ten sam człowiek zgłasza różnymi drogami. */
export type ReportSource = 'form' | 'ai' | 'idea' | 'panic' | 'comment' | 'siteping'

export type Reporter = {
  /** Imię z konta. Null jest normalny: zaproszenie mogło pójść bez imienia. */
  name: string | null
  email: string
  portalName: string
  portalSlug: string
  source: ReportSource
}

const SOURCE_LABELS: Record<ReportSource, string> = {
  form: 'formularz w portalu',
  ai: 'asystent AI w portalu',
  idea: 'Dashboard, pomysł na ulepszenie portalu',
  panic: 'przycisk alarmowy w portalu',
  comment: 'komentarz w portalu',
  siteping: 'zgłoszenie z widgetu na stronie',
}

/**
 * Identyfikator aktora sesji admina. Sesja admina dostaje `userId: 'admin'`
 * (lib/auth.ts), więc to jest jedyny wyznacznik. Stała zamiast literału
 * rozsianego po trasach: przemianowanie tego wartości wymaga dotknięcia
 * JEDNEGO miejsca.
 */
export const ADMIN_ACTOR_ID = 'admin'

/**
 * E-mail konta obejściowego admina. Sesja admina dostaje `userId: 'admin'`
 * i ten adres (lib/auth.ts), więc jest to jedyny wyznacznik.
 */
export const ADMIN_ACTOR_EMAIL = 'admin@important.is'

/**
 * Sesja admina ma `userId: 'admin'`, czyli NIE uuid. Kolumny `user_id` są typu
 * uuid, więc wstawienie tego wprost kończy się `invalid input syntax for type
 * uuid`. Tabela `ai_usage` robiła dokładnie to i traciła cały zapis (insert
 * leciał wyjątkiem w try/catch, więc bez śladu w interfejsie).
 *
 * Zwracamy null, bo admin naprawdę nie jest wierszem w `portal_users`. Kto to
 * był, wiadomo z `user_email`.
 */
export function normalizeActorId(userId: string | null | undefined): string | null {
  if (!userId || userId === ADMIN_ACTOR_ID) return null
  return userId
}

export function isAdminActor(actor: { userId?: string | null; email?: string | null }): boolean {
  return actor.userId === ADMIN_ACTOR_ID || actor.email === ADMIN_ACTOR_EMAIL
}

/**
 * Podpis osoby do stopki i do interfejsu. Imię przed adresem, bo po imieniu
 * czyta się szybciej, ale adres zostaje: dwie osoby u klienta mogą mieć to samo
 * imię, adres jest jedyną rzeczą naprawdę rozróżniającą.
 */
export function reporterLabel(reporter: Pick<Reporter, 'name' | 'email'>): string {
  const name = reporter.name?.trim()
  return name ? `${name} <${reporter.email}>` : reporter.email
}

/**
 * Stopka dołączana do opisu zadania w ClickUpie.
 *
 * Rozdzielona `---`, żeby dała się odróżnić od treści zgłoszenia. Zadanie
 * utworzone przez nas w trybie obejścia admina jest oznaczone WPROST: taki wpis
 * nie może wyglądać jak zgłoszenie klienta, bo to fałszowałoby historię
 * współpracy, na którą potem powołujemy się przy rozliczeniu.
 *
 * BEZ linii „Projekt": zadanie i tak siedzi w folderze tego klienta w ClickUpie,
 * więc ta informacja jest tam, gdzie zespół i tak patrzy — dublowanie jej w
 * stopce nie dodawało nic (uwaga Łukasza po teście 24.08). Kanał zostaje, bo
 * REALNIE się różni między źródłami zgłoszenia (AI, alarm, widget, formularz).
 */
export function reporterFooter(reporter: Reporter): string {
  const who = isAdminActor({ email: reporter.email })
    ? 'important.is (tryb administratora, w imieniu klienta)'
    : reporterLabel(reporter)

  return [
    '---',
    `**Zgłoszone przez:** ${who}`,
    `**Kanał:** ${SOURCE_LABELS[reporter.source]}`,
  ].join('\n')
}

/**
 * Opis zadania ze stopką na końcu.
 *
 * Na końcu, nie na początku: pierwsze linie opisu są tym, co widać w podglądzie
 * ClickUpa i w powiadomieniach, więc należą do treści zgłoszenia, a nie do
 * metadanych. Pusty opis też dostaje stopkę, bo wtedy jest ona jedyną
 * informacją, jaką zadanie ma.
 */
export function withReporterFooter(description: string | null | undefined, reporter: Reporter): string {
  const body = (description ?? '').trim()
  const footer = reporterFooter(reporter)
  return body ? `${body}\n\n${footer}` : footer
}
