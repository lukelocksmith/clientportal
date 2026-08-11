/**
 * Adres strony klienta, na którą portal potrafi go odesłać, żeby zaznaczył
 * miejsce zgłoszenia.
 *
 * CZYSTY moduł, bez bazy i bez Next: wynik trafia do komponentu klienckiego,
 * a ten nie może przez import wciągnąć sterownika postgresa do paczki
 * przeglądarki. Ten błąd raz już położył całą aplikację i nie widzi go `tsc`.
 *
 * Źródłem jest konfiguracja projektu, ta sama, która decyduje o przyjmowaniu
 * zgłoszeń przez `/api/siteping/[slug]`. Dzięki temu nie da się doprowadzić do
 * stanu, w którym portal wysyła klienta na stronę, z której endpoint i tak
 * odrzuciłby zgłoszenie: obie ścieżki czytają `siteDomains`.
 */

/**
 * Czy host jest lokalny, czyli podawany po http.
 *
 * `localhost` NIE MA certyfikatu, więc adres `https://localhost` kończy się
 * odmową połączenia — nic nie nasłuchuje na porcie 443. Wymuszanie https
 * wszędzie psuło przez to całe testowanie lokalne.
 *
 * Eksportowana, bo test połączenia (`lib/siteping/check.ts`) buduje adres do
 * pobrania strony klienta i musi wybrać ten sam schemat co link „Pokaż na
 * stronie". Dwie kopie tej reguły rozjechałyby się przy pierwszej zmianie.
 */
export function lokalny(host: string): boolean {
  // Bez portu: `localhost:5500` jest tak samo lokalny jak `localhost`.
  const nazwa = host.split(':')[0]
  return (
    nazwa === 'localhost' ||
    nazwa.endsWith('.localhost') ||
    nazwa === '127.0.0.1' ||
    nazwa === '[::1]'
  )
}

/**
 * Pierwsza skonfigurowana domena jako pełny adres, albo null.
 *
 * Null znaczy „portal nie zna strony tego klienta" i jest odpowiedzią
 * PRAWIDŁOWĄ, nie błędem: wołający ma wtedy pominąć wybór drogi i otworzyć
 * asystenta od razu.
 *
 * Schemat WYLICZAMY z hosta, a nie wpisujemy na sztywno. `site_domains` trzyma
 * same nazwy hostów, bo tak wymaga porównanie z nagłówkiem `Origin`, więc
 * schemat trzeba skądś wziąć: dla hostów lokalnych http, dla reszty https.
 * Strona klienta w internecie ma chodzić po https i odesłanie na http
 * oznaczałoby ostrzeżenie przeglądarki w chwili zgłaszania usterki.
 */
export function portalSiteUrl(
  portal: {
    sitepingEnabled: boolean
    siteDomains: string | null
  },
  /**
   * Krótkotrwały token tożsamości, żeby widget na stronie klienta nie pytał
   * o imię i mail. Opcjonalny: bez niego link działa jak dotąd, tylko widget
   * zapyta. Generuje go komponent serwerowy, bo tylko on zna sesję.
   */
  identityToken?: string | null
): string | null {
  if (!portal.sitepingEnabled) return null

  const pierwsza = (portal.siteDomains ?? '')
    .split(',')
    .map(d => d.trim())
    .find(d => d.length > 0)

  if (!pierwsza) return null

  // Domena wpisana z pełnym adresem to błąd konfiguracji, ale odesłanie
  // klienta na `https://https//cos` byłoby gorsze niż jego naprawienie tutaj.
  const host = pierwsza.replace(/^https?:\/\//i, '').replace(/\/+$/, '')
  if (!host) return null

  const baza = `${lokalny(host) ? 'http' : 'https'}://${host}${SITEPING_PARAM}`
  // `encodeURIComponent` mimo że token JWT składa się ze znaków bezpiecznych
  // w adresie: to założenie o cudzym formacie, a nie coś, co kontrolujemy.
  return identityToken ? `${baza}&${SITEPING_TOKEN_PARAM}=${encodeURIComponent(identityToken)}` : baza
}

/**
 * Parametr włączający widget na stronie klienta.
 *
 * Strona może osadzać widget warunkowo, żeby nie pokazywać go każdemu
 * odwiedzającemu (tak jest na important.is: to strona firmowa, a widoczny dla
 * wszystkich przycisk zgłaszania uwag to otwarta droga spamu prosto do
 * ClickUpa). Bez tego parametru przycisk „Pokaż na stronie" prowadził na
 * stronę, na której widgetu nie ma, więc klient klikał „Zaznacz miejsce"
 * i nie widział niczego.
 *
 * Wartość `1` jest umowna: strona sprawdza OBECNOŚĆ parametru, nie jego treść.
 * Ten sam parametr niesie deep-linki z ClickUpa (`?siteping=<id>`), więc jedno
 * sprawdzenie obsługuje obie drogi.
 *
 * Strony, które osadzają widget bezwarunkowo, po prostu ten parametr zignorują.
 */
const SITEPING_PARAM = '?siteping=1'

/**
 * Parametr niosący token tożsamości.
 *
 * W adresie jedzie TOKEN, nigdy imię i mail. Token jest nieprzezroczysty,
 * wygasa po kwadransie i jest związany z jednym projektem, więc jego
 * wyciek do historii przeglądarki czy nagłówka `Referer` nie zdradza danych
 * osobowych ani nie pozwala podszyć się pod kogoś na dłużej.
 */
export const SITEPING_TOKEN_PARAM = 'sp_token'
