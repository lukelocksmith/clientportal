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
 * CSP jest w src/proxy.ts, nie tutaj, bo wymaga nowego nonce'a przy KAZDYM
 * zadaniu, a naglowki z tego pliku sa statyczne.
 */
const securityHeaders = [
  { key: 'Referrer-Policy', value: 'strict-origin-when-cross-origin' },
  // Bez tego przegladarka moze zgadywac typ tresci i potraktowac wgrany plik
  // jako HTML.
  { key: 'X-Content-Type-Options', value: 'nosniff' },
  // Portal nie ma powodu dzialac w ramce, a bez tego da sie go nalozyc pod
  // cudza strone i zbierac klikniecia klienta.
  { key: 'X-Frame-Options', value: 'DENY' },
  /**
   * HSTS. Sprawdzone na produkcji 2026-08-03: Traefik tego naglowka NIE dodaje,
   * odpowiedz go nie zawierala, wiec nie jest to dublowanie konfiguracji.
   *
   * Rok, BEZ includeSubDomains i BEZ preload. To jest celowe: important.is ma
   * inne poddomeny (mailcow, n8n, demo, gb) i objecie ich wszystkich polityka
   * ustawiona z portalu klienta byloby decyzja o czyms, czego ten portal nie
   * obsluguje. Polityke pamieta przegladarka, wiec pomylka tutaj jest trudna do
   * odkrecenia.
   */
  { key: 'Strict-Transport-Security', value: 'max-age=31536000' },
  // Portal nie uzywa kamery, mikrofonu ani lokalizacji. Jawne wylaczenie
  // znaczy, ze wstrzykniety kod nie moze o nie poprosic w naszym imieniu.
  { key: 'Permissions-Policy', value: 'camera=(), microphone=(), geolocation=()' },
]

/**
 * HSTS jest WYLACZONY w developmencie i to nie jest wygodnictwo.
 *
 * Serwer deweloperski chodzi po http, a HSTS obowiazuje CALY host `localhost`,
 * bez rozroznienia portu, i przegladarka pamieta go rok. Wyslany raz z tego
 * projektu psul logowanie w Safari nie tylko tutaj, ale w kazdej innej
 * aplikacji uruchamianej lokalnie na dowolnym porcie. Chrome traktuje
 * localhost ulgowo, Safari nie.
 *
 * Zglosil Lukasz 2026-08-06: „nie da sie wejsc, https nie dziala".
 */
const isDev = process.env.NODE_ENV !== 'production'

const activeHeaders = isDev
  ? securityHeaders.filter(h => h.key !== 'Strict-Transport-Security')
  : securityHeaders

/**
 * Bundle widgetu SitePing serwowany stronom klientów.
 *
 * `X-Frame-Options: DENY` i reszta polityki portalu dotyczy STRON portalu.
 * Tutaj chodzi o plik JavaScript ładowany przez `<script src>` z cudzej
 * domeny, więc potrzebuje własnych nagłówków.
 *
 * Cache jest tu istotny, nie kosmetyczny: to 467 KB, które bez tego ciągnęłoby
 * się przy każdym wejściu na stronę klienta. Godzina to kompromis między
 * ruchem a czasem propagacji nowej wersji po naszym deployu — adres jest
 * stały i niewersjonowany, więc `immutable` byłoby tu błędem, bo zamroziłoby
 * klientom starą wersję na zawsze.
 */
const sitepingWidgetHeaders = [
  { key: 'Cache-Control', value: 'public, max-age=3600, stale-while-revalidate=86400' },
  // Ładowanie przez <script src> nie wymaga CORS, ale nagłówek nie szkodzi,
  // a pozwala stronie klienta pobrać ten plik także fetchem, gdy używa
  // własnego mechanizmu ładowania skryptów.
  { key: 'Access-Control-Allow-Origin', value: '*' },
]

const nextConfig: NextConfig = {
  output: 'standalone',
  async headers() {
    return [
      { source: '/:path*', headers: activeHeaders },
      { source: '/siteping/widget.js', headers: sitepingWidgetHeaders },
    ]
  },
};

export default nextConfig;
