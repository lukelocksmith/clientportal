/**
 * Krótkotrwały token tożsamości, przekazywany z portalu na stronę klienta.
 *
 * PO CO: widget na stronie klienta nie wyśle ciasteczek portalu (sprawdzone
 * w bundlu: zero `credentials`), więc sam z siebie nie wie, kto właśnie
 * zgłasza. Bez tego pyta o imię i mail przy pierwszym zgłoszeniu, a wpisana
 * odpowiedź jest samopodpisem, którego nikt nie weryfikuje.
 *
 * JAK: portal podpisuje token przy generowaniu linku „Pokaż na stronie",
 * strona klienta wymienia go PO STRONIE SERWERA na imię i mail
 * (`GET /api/siteping/identity`), i podaje je widgetowi w `config.identity`.
 * Widget mając te dane nie pokazuje okna z pytaniem ani razu.
 *
 * DLACZEGO TOKEN W ADRESIE, A NIE IMIĘ I MAIL: w adresie jedzie ciąg
 * nieprzezroczysty, który sam z siebie nic nie zdradza i wygasa. Dane osobowe
 * wpisane wprost trafiałyby do logów serwera klienta, historii przeglądarki
 * i nagłówka `Referer` wysyłanego na obce domeny, a podszycie się pod kogoś
 * sprowadzałoby się do edycji linku.
 *
 * CZAS ŻYCIA: 15 minut. Token ma przeżyć przejście z portalu na stronę i
 * chwilę szukania miejsca do zaznaczenia, nie całą sesję pracy.
 */
import { SignJWT, jwtVerify } from 'jose'

/**
 * Odbiorca tokenu. Wpisany w podpis, więc token wystawiony do czegoś innego
 * (gdyby ten sam sekret obsłużył kiedyś drugie zastosowanie) nie przejdzie
 * tutaj, i odwrotnie.
 */
const AUDIENCE = 'siteping-identity'
const ISSUER = 'portal.important.is'

/** 15 minut. Patrz komentarz na górze pliku. */
export const IDENTITY_TOKEN_TTL_SECONDS = 15 * 60

export type SitepingIdentity = {
  name: string | null
  email: string
  /** Slug portalu. Token ważny dla JEDNEGO projektu, nie dla wszystkich. */
  slug: string
}

function secret(): Uint8Array | null {
  const raw = process.env.JWT_SECRET
  // Brak sekretu NIE jest błędem krytycznym: portal ma dalej działać, tylko
  // bez podstawiania tożsamości. Widget wtedy zapyta, jak dotąd.
  if (!raw || raw.length < 16) return null
  return new TextEncoder().encode(raw)
}

/** Czy podstawianie tożsamości jest w ogóle skonfigurowane. */
export function isIdentityTokenConfigured(): boolean {
  return secret() !== null
}

/**
 * Podpisuje token dla zalogowanego użytkownika portalu.
 *
 * Zwraca `null`, gdy brak sekretu — wołający ma wtedy zbudować link BEZ
 * tokenu, zamiast wysyłać klienta z czymś, czego druga strona nie zweryfikuje.
 */
export async function signIdentityToken(dane: SitepingIdentity): Promise<string | null> {
  const klucz = secret()
  if (!klucz) return null

  return new SignJWT({ name: dane.name, email: dane.email, slug: dane.slug })
    .setProtectedHeader({ alg: 'HS256' })
    .setIssuedAt()
    .setIssuer(ISSUER)
    .setAudience(AUDIENCE)
    .setExpirationTime(`${IDENTITY_TOKEN_TTL_SECONDS}s`)
    .sign(klucz)
}

/**
 * Sprawdza token i zwraca tożsamość, albo `null` gdy cokolwiek nie gra:
 * zły podpis, wygasły, wystawiony do innego celu, albo dla innego projektu.
 *
 * `expectedSlug` jest WYMAGANY, nie opcjonalny. Bez niego token wydany dla
 * jednego klienta dałoby się użyć na stronie drugiego, a stąd już tylko krok
 * do podpisania cudzego zgłoszenia czyimś nazwiskiem.
 */
export async function verifyIdentityToken(
  token: string,
  expectedSlug: string
): Promise<SitepingIdentity | null> {
  const klucz = secret()
  if (!klucz || !token) return null

  try {
    const { payload } = await jwtVerify(token, klucz, {
      audience: AUDIENCE,
      issuer: ISSUER,
    })

    const email = typeof payload.email === 'string' ? payload.email : null
    const slug = typeof payload.slug === 'string' ? payload.slug : null
    if (!email || !slug || slug !== expectedSlug) return null

    return {
      email,
      slug,
      name: typeof payload.name === 'string' && payload.name.length > 0 ? payload.name : null,
    }
  } catch {
    // Wygasły albo podrobiony. Jedno i drugie znaczy „nie znam tej osoby",
    // a rozróżnianie tego w odpowiedzi tylko podpowiadałoby atakującemu.
    return null
  }
}
