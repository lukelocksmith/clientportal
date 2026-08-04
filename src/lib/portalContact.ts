import { TEAM_MEMBERS, parseContactMemberIds } from './team'
/**
 * Kontakt opiekuna projektu, pokazywany na zakładce Dashboard.
 * Czysta logika, bez zależności od Next i bazy (scripts/check-portalContact.ts).
 *
 * Trzy poziomy: pole projektu, zmienna środowiskowa agencji, wartość domyślna
 * w kodzie. Dzięki temu nowy projekt ma sensowny kontakt od pierwszej chwili,
 * a podmiana opiekuna dla jednego klienta nie wymaga deployu.
 */

/** Wartości ostatniej instancji, gdy nie ma ani pola projektu, ani zmiennej. */
const FALLBACK_NAME = 'Zespół important.is'
const FALLBACK_EMAIL = 'hi@important.is'

export type PortalContact = {
  name: string
  /**
   * Null tylko dla kontaktu dodatkowego podanego wyłącznie telefonem. Członek
   * zespołu i zapas agencji mają adres zawsze.
   */
  email: string | null
  /** Null, gdy nikt nie podał telefonu. Dashboard wtedy nie rysuje tego wiersza. */
  phone: string | null
  /** Podpis roli, np. "Opiekun techniczny". Null dla kontaktu spoza zespołu. */
  roleLabel: string | null
}

/**
 * Zmienne z numerami zespołu, po jednej na osobę: `TEAM_PHONE_FILIP` itd.
 *
 * Numery są w środowisku, a nie w `team.ts`, z dwóch powodów. Pierwszy: to
 * prywatne komórki, a nie centralka, więc nie mają czego szukać w historii
 * repozytorium. Drugi: numer zmienia się częściej niż skład zespołu i wpisanie
 * go w Coolify jest krótszą drogą niż commit.
 */
export function memberPhoneEnvKey(memberId: string): string {
  return `TEAM_PHONE_${memberId.toUpperCase().replace(/[^A-Z0-9]/g, '_')}`
}

/**
 * Wartości ze środowiska agencji. `memberPhones` jest mapą id osoby na numer,
 * bo inaczej trzeba by przekazywać `process.env` do funkcji, które mają zostać
 * czyste i testowalne bez ustawiania zmiennych.
 */
export type ContactEnv = {
  name?: string
  email?: string
  phone?: string
  memberPhones?: Record<string, string | undefined>
}

/**
 * Walidacja e-maila wystarczająca do decyzji „czy wstawić to w mailto".
 * Nie próbujemy odtwarzać RFC 5322: pole wypełnia admin, nie internet, a
 * jedyny koszt błędu to niedziałający odnośnik, nie luka.
 */
export function isPlausibleEmail(value: string | null | undefined): boolean {
  if (!value) return false
  const v = value.trim()
  return v.length <= 200 && /^[^\s@]+@[^\s@.]+\.[^\s@]+$/.test(v)
}

/**
 * Telefon do `tel:`. Zostawiamy tylko cyfry, plus, spacje i myślniki, żeby nie
 * dało się przemycić czegokolwiek innego do atrybutu href.
 */
export function normalizePhone(value: string | null | undefined): string | null {
  if (!value) return null
  const v = value.trim()
  if (v.length === 0 || v.length > 32) return null
  if (!/^[+0-9][0-9\s\-()]*$/.test(v)) return null
  // Musi zostać co najmniej sześć cyfr, inaczej to nie jest numer.
  return (v.match(/\d/g) ?? []).length >= 6 ? v : null
}

/** Wersja numeru do atrybutu href: same cyfry i wiodący plus. */
export function phoneHref(phone: string): string {
  const digits = phone.replace(/[^\d+]/g, '')
  return `tel:${digits}`
}

/**
 * Pełna lista kontaktów projektu: wybrani członkowie zespołu, a po nich
 * opcjonalny kontakt dodatkowy spoza zespołu.
 *
 * Gdy `contact_member_ids` jest null (nowy projekt, jeszcze nieskonfigurowany),
 * bierzemy cały zespół. Gdy jest pustym ciągiem, to znaczy że ktoś ŚWIADOMIE
 * odznaczył wszystkich, i wtedy zostaje sam kontakt dodatkowy albo zapas
 * agencji. Ta różnica między null i "" jest istotna, bo inaczej nie da się
 * wyłączyć wszystkich członków zespołu.
 */
export function resolveContacts(
  portal: {
    contactMemberIds?: string | null
    contactName?: string | null
    contactEmail?: string | null
    contactPhone?: string | null
  },
  env: ContactEnv = {}
): PortalContact[] {
  const members =
    portal.contactMemberIds === null || portal.contactMemberIds === undefined
      ? TEAM_MEMBERS.slice()
      : parseContactMemberIds(portal.contactMemberIds)

  const list: PortalContact[] = members.map(m => ({
    name: m.name,
    email: m.email,
    // Numer ze środowiska ma pierwszeństwo nad wpisanym w `team.ts`, żeby dało
    // się go podmienić bez commita. Oba przechodzą przez tę samą walidację:
    // literówka w zmiennej Coolify nie może wjechać do atrybutu href.
    phone: normalizePhone(env.memberPhones?.[m.id]) ?? normalizePhone(m.phone),
    roleLabel: m.roleLabel,
  }))

  /**
   * Kontakt dodatkowy wchodzi, gdy ma sensowny e-mail ALBO sensowny telefon.
   *
   * Wcześniej wymagany był e-mail, więc wpisanie w panelu samego telefonu
   * kończyło się tym, że zapis się udawał i nic się nie pokazywało. Cicha utrata
   * danych wygląda dokładnie jak awaria, o którą trzeba pytać.
   */
  const extraEmail = isPlausibleEmail(portal.contactEmail) ? portal.contactEmail!.trim() : null
  const extraPhone = normalizePhone(portal.contactPhone)
  if (extraEmail || extraPhone) {
    list.push({
      name: portal.contactName?.trim() || 'Kontakt do projektu',
      email: extraEmail,
      phone: extraPhone,
      roleLabel: null,
    })
  }

  // Nic nie zostało: spadamy na zapas agencji, żeby Dashboard nigdy nie
  // pokazał sekcji kontaktu bez żadnego adresu.
  if (list.length === 0) {
    const fallback = resolveContact(portal, env)
    list.push({ ...fallback, roleLabel: null })
  }

  return list
}

function resolveContact(
  portal: {
    contactName?: string | null
    contactEmail?: string | null
    contactPhone?: string | null
  },
  env: ContactEnv = {}
): PortalContact {
  const portalName = portal.contactName?.trim() || null
  const portalEmail = isPlausibleEmail(portal.contactEmail) ? portal.contactEmail!.trim() : null
  const portalPhone = normalizePhone(portal.contactPhone)

  const envEmail = isPlausibleEmail(env.email) ? env.email!.trim() : null
  const envPhone = normalizePhone(env.phone)

  return {
    name: portalName ?? env.name?.trim() ?? FALLBACK_NAME,
    email: portalEmail ?? envEmail ?? FALLBACK_EMAIL,
    phone: portalPhone ?? envPhone ?? null,
    roleLabel: null,
  }
}

/** Odczyt zmiennych agencji. Trzymane osobno, żeby resolveContact był czysty. */
export function contactEnv(): ContactEnv {
  const memberPhones: Record<string, string | undefined> = {}
  for (const m of TEAM_MEMBERS) {
    memberPhones[m.id] = process.env[memberPhoneEnvKey(m.id)]
  }

  return {
    name: process.env.PORTAL_CONTACT_NAME,
    email: process.env.PORTAL_CONTACT_EMAIL,
    phone: process.env.PORTAL_CONTACT_PHONE,
    memberPhones,
  }
}
