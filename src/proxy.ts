import { NextResponse } from 'next/server'
import type { NextRequest } from 'next/server'

/**
 * Polityka bezpieczeństwa treści (CSP), budowana per żądanie.
 *
 * Nonce musi być nowy dla KAŻDEGO żądania, inaczej traci sens: przewidywalna
 * wartość pozwala napastnikowi dopisać własny skrypt z pasującym nonce.
 * Dlatego CSP nie może stać w `next.config.ts` razem z pozostałymi nagłówkami,
 * bo tamte są statyczne.
 *
 * Dobór dyrektyw wynika z tego, co ta aplikacja RZECZYWIŚCIE ładuje:
 *
 *   script-src      nonce + strict-dynamic, bo Next wstrzykuje własne skrypty
 *                   startowe w treść strony. Bez nonce aplikacja się nie
 *                   uruchamia, a z 'unsafe-inline' polityka nie chroni od
 *                   niczego istotnego.
 *   style-src-attr  'unsafe-inline' JEST tu konieczne. Kolor marki klienta,
 *                   kolory statusów i priorytetów wstawiamy jako atrybut
 *                   `style` wyliczany z danych, więc bez tego portal
 *                   wyrenderowałby się bez kolorów. Osobna dyrektywa na
 *                   atrybuty, nie luzowanie całego `style-src`, żeby wstrzyknięty
 *                   znacznik `<style>` nadal był blokowany.
 *   img-src https:  klienci mają własne logo pod dowolnym adresem, a szuflada
 *                   zadania pokazuje miniatury załączników z ClickUpa. Obrazek
 *                   z obcego hosta jest nieporównanie mniej groźny niż skrypt.
 *   connect-src     tylko własne źródło: portal woła wyłącznie swoje API, także
 *                   przy strumieniowaniu odpowiedzi asystenta.
 *   'unsafe-eval'   WYŁĄCZNIE w trybie deweloperskim, bo React używa tam eval
 *                   do odtwarzania śladów stosu. Na produkcji nie jest potrzebne.
 */
function buildCsp(nonce: string): string {
  const isDev = process.env.NODE_ENV === 'development'
  return [
    "default-src 'self'",
    `script-src 'self' 'nonce-${nonce}' 'strict-dynamic'${isDev ? " 'unsafe-eval'" : ''}`,
    "style-src 'self'",
    "style-src-attr 'unsafe-inline'",
    "img-src 'self' data: blob: https:",
    "font-src 'self'",
    "connect-src 'self'",
    "object-src 'none'",
    "base-uri 'self'",
    "form-action 'self'",
    "frame-ancestors 'none'",
    // Podnoszenie http na https tylko na produkcji. Lokalnie serwer chodzi po
    // http, więc ta dyrektywa kazałaby przeglądarce pukać po https na port,
    // na którym nie ma TLS-a, i strona nie wstawała wcale (Safari 2026-08-06).
    ...(isDev ? [] : ['upgrade-insecure-requests']),
  ].filter(Boolean).join('; ')
}

// Middleware runs on Edge — we only do lightweight cookie check here.
// Full DB session validation happens in each route/layout.
export function proxy(request: NextRequest) {
  const { pathname } = request.nextUrl

  // btoa, nie Buffer: ta funkcja działa na Edge, gdzie Buffer nie jest częścią
  // standardu. randomUUID daje wartość nieprzewidywalną, base64 tylko ubiera ją
  // w postać, której oczekuje specyfikacja nonce.
  const nonce = btoa(crypto.randomUUID())
  const csp = buildCsp(nonce)

  /**
   * Nagłówek dokładamy do KAŻDEJ odpowiedzi, także do przekierowań i do
   * ścieżek publicznych. Ta funkcja ma cztery wyjścia i wcześniej łatwo było
   * dopisać politykę tylko do ostatniego, co dałoby strony bez ochrony właśnie
   * tam, gdzie jest najbardziej potrzebna: na logowaniu i na stronie
   * ustawiania hasła z linku.
   *
   * Nonce ustawiamy też na nagłówkach ŻĄDANIA, bo stąd odczytuje go Next,
   * żeby podpisać nim swoje własne skrypty.
   */
  function next() {
    const requestHeaders = new Headers(request.headers)
    requestHeaders.set('x-nonce', nonce)
    requestHeaders.set('Content-Security-Policy', csp)
    const response = NextResponse.next({ request: { headers: requestHeaders } })
    response.headers.set('Content-Security-Policy', csp)
    return response
  }

  // Extract slug from path like /wdf or /wdf/chat
  const slugMatch = pathname.match(/^\/([a-z0-9-]+)(\/.*)?$/)
  if (!slugMatch) return next()

  const slug = slugMatch[1]
  const subpath = slugMatch[2] ?? ''

  // Skip auth for login page, invite page, API routes and admin panel.
  //
  // Strona zaproszenia MUSI być publiczna: użytkownik trafia na nią z maila,
  // jeszcze nie mając hasła, więc sesji mieć nie może. Autoryzacją jest tam
  // jednorazowy token w adresie, sprawdzany po stronie serwera.
  const isInvite = subpath.startsWith('/zaproszenie/')
  const isForgot = subpath === '/przypomnienie'
  if (subpath === '/login' || isInvite || isForgot || pathname.startsWith('/api/') || slug === 'admin') {
    return next()
  }

  // Check session cookie exists (full validation in layout).
  // The admin cookie counts too: an admin browsing any portal has no
  // portal_session, and getSession(slug) resolves the admin bypass. Without
  // this the bypass is unreachable from a browser — the edge bounced the
  // admin to the login page before any page code ran.
  // Presence is all we check here (no DB, no crypto on Edge); admin_session
  // is HMAC-verified downstream in getAdminSession().
  const sessionCookie = request.cookies.get('portal_session')
  const adminCookie = request.cookies.get('admin_session')
  if (!sessionCookie?.value && !adminCookie?.value) {
    const loginUrl = new URL(`/${slug}/login`, request.url)
    loginUrl.searchParams.set('from', pathname)
    const redirect = NextResponse.redirect(loginUrl)
    redirect.headers.set('Content-Security-Policy', csp)
    return redirect
  }

  return next()
}

export const config = {
  matcher: [
    '/((?!_next/static|_next/image|favicon.ico|public).*)',
  ],
}
