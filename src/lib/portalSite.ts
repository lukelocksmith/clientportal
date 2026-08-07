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
 * Pierwsza skonfigurowana domena jako pełny adres, albo null.
 *
 * Null znaczy „portal nie zna strony tego klienta" i jest odpowiedzią
 * PRAWIDŁOWĄ, nie błędem: wołający ma wtedy pominąć wybór drogi i otworzyć
 * asystenta od razu.
 *
 * `https` na sztywno, mimo że `site_domains` trzyma same nazwy hostów. Portal
 * chodzi po https, więc odesłanie klienta na http oznaczałoby ostrzeżenie
 * przeglądarki przy zgłaszaniu usterki — czyli usterkę na usterce.
 */
export function portalSiteUrl(portal: {
  sitepingEnabled: boolean
  siteDomains: string | null
}): string | null {
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

  return `https://${host}`
}
