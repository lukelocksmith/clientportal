/**
 * Dopasowanie monitorów i zadań testowych SuperChecka DO PROJEKTU.
 *
 * To jest granica między klientami i dlatego siedzi w osobnym, czystym pliku
 * z testami. Monitor w SuperChecku nie wie nic o naszych portalach; jedyne, co
 * ich łączy, to adres. Pomyłka tutaj nie kończy się błędem, tylko pokazaniem
 * klientowi cudzej dostępności, czego nikt by nie zauważył.
 *
 * Domeny projektu bierzemy z `site_domains`, tej samej kolumny, która steruje
 * widgetem SitePing. Klient ma tam produkcję i ewentualnie staging, po
 * przecinku, bez protokołu.
 */

/** Host bez `www.`, bez portu, małymi literami. `www` to nie inna witryna. */
export function normalizeHost(value: string): string {
  return value
    .trim()
    .toLowerCase()
    .replace(/^https?:\/\//, '')
    .split('/')[0]
    .split(':')[0]
    .replace(/^www\./, '')
}

/** Domeny projektu z kolumny `site_domains`. Puste wejście daje pustą listę. */
export function projectHosts(siteDomains: string | null | undefined): string[] {
  if (!siteDomains) return []
  return siteDomains
    .split(',')
    .map(normalizeHost)
    .filter(h => h.length > 0 && h.includes('.'))
}

/**
 * Czy adres monitora należy do tego projektu.
 *
 * Porównujemy CAŁY host, nie fragment. `endsWith` na samej nazwie wpuszczałby
 * `niewodadlafirmy.pl` do projektu `wodadlafirmy.pl`, a takiej pomyłki nikt by
 * nie zobaczył: liczby wyglądałyby poprawnie. Subdomeny projektu wpuszczamy
 * jawnie, po kropce.
 */
export function targetBelongsToProject(target: string | null | undefined, hosts: readonly string[]): boolean {
  if (!target) return false
  const host = normalizeHost(target)
  if (!host) return false
  return hosts.some(h => host === h || host.endsWith(`.${h}`))
}

/**
 * Czy zadanie testowe dotyczy tego projektu.
 *
 * Zadania w SuperChecku nie mają adresu w metadanych, mają nazwę pisaną przez
 * człowieka („important.is - monitoring E2E"). Szukamy więc w nazwie domeny
 * projektu albo jego nazwy z portalu. To jest dopasowanie SŁABSZE niż po
 * adresie i tak je traktujemy: brak trafienia znaczy „nie pokazujemy nic",
 * nigdy „pokażmy pierwsze z brzegu".
 */
export function jobBelongsToProject(
  jobName: string | null | undefined,
  hosts: readonly string[],
  portalName: string | null | undefined,
): boolean {
  const name = (jobName ?? '').trim().toLowerCase()
  if (!name) return false
  if (hosts.some(h => name.includes(h))) return true
  const portal = (portalName ?? '').trim().toLowerCase()
  // Nazwa projektu krótsza niż trzy znaki („L-ka" po obcięciu) trafiałaby
  // w przypadkowe słowa, więc jej nie używamy.
  return portal.length >= 3 && name.includes(portal)
}
