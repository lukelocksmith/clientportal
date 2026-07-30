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
  email: string
  /** Null, gdy nikt nie podał telefonu. Dashboard wtedy nie rysuje tego wiersza. */
  phone: string | null
  /** Czy cokolwiek pochodzi z ustawień projektu. Panel admina to pokazuje. */
  fromPortal: boolean
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

export function resolveContact(
  portal: {
    contactName?: string | null
    contactEmail?: string | null
    contactPhone?: string | null
  },
  env: { name?: string; email?: string; phone?: string } = {}
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
    fromPortal: Boolean(portalName || portalEmail || portalPhone),
  }
}

/** Odczyt zmiennych agencji. Trzymane osobno, żeby resolveContact był czysty. */
export function contactEnv(): { name?: string; email?: string; phone?: string } {
  return {
    name: process.env.PORTAL_CONTACT_NAME,
    email: process.env.PORTAL_CONTACT_EMAIL,
    phone: process.env.PORTAL_CONTACT_PHONE,
  }
}
