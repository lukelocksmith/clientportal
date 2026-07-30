import type { NextConfig } from "next";

/**
 * Naglowki bezpieczenstwa. Do tej pory portal nie ustawial zadnych.
 *
 * Referrer-Policy jest tu NAJWAZNIEJSZY i wynika wprost z tego, jak dziala
 * zaproszenie: adres strony zawiera jednorazowy token, a ta strona laduje logo
 * klienta z JEGO domeny. Bez tej polityki przegladarka moglaby wyslac pelny
 * adres, razem z tokenem, jako Referer na serwer klienta.
 *
 * Dzisiejsze przegladarki domyslnie robia strict-origin-when-cross-origin, wiec
 * token i tak by nie wyszedl. Ale opieranie wlasciwosci bezpieczenstwa na
 * DOMYSLNEJ wartosci w przegladarce to nie zabezpieczenie, tylko szczescie:
 * wystarczy starsza przegladarka albo zmiana domyslnej polityki. Ustawiamy
 * jawnie.
 *
 * Czego tu NIE MA i dlaczego:
 * - CSP: Next wstrzykuje skrypty inline, wiec sensowna polityka wymaga nonce'ow
 *   i osobnego przejscia. Dodana na slepo albo zepsulaby strone, albo bylaby
 *   pozorna przez 'unsafe-inline'.
 * - HSTS: prawdopodobnie ustawia go juz Traefik przed aplikacja. Wpisanie go
 *   tutaj bez sprawdzenia produkcji zdublowaloby konfiguracje. Do potwierdzenia
 *   na serwerze.
 */
const securityHeaders = [
  { key: 'Referrer-Policy', value: 'strict-origin-when-cross-origin' },
  // Bez tego przegladarka moze zgadywac typ tresci i potraktowac wgrany plik
  // jako HTML.
  { key: 'X-Content-Type-Options', value: 'nosniff' },
  // Portal nie ma powodu dzialac w ramce, a bez tego da sie go nalozyc pod
  // cudza strone i zbierac klikniecia klienta.
  { key: 'X-Frame-Options', value: 'DENY' },
]

const nextConfig: NextConfig = {
  output: 'standalone',
  async headers() {
    return [{ source: '/:path*', headers: securityHeaders }]
  },
};

export default nextConfig;
