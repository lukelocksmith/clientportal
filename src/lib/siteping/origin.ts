/**
 * Nazwa hosta, z ktorej realnie przyszlo zadanie — albo null.
 *
 * `Origin` jest wlasciwym naglowkiem, `Referer` to zapas: przegladarki
 * pomijaja `Origin` przy czesci zapytan GET, a wtedy `Referer` jest jedynym
 * sladem strony wywolujacej. Oba sa pelnymi adresami (`https://host/sciezka`),
 * a `site_domains` trzyma same nazwy hostow, wiec porownujemy hosty, nie
 * surowe ciagi — inaczej zaden realny ruch z przegladarki by nie przeszedl.
 *
 * Przyjmuje `Request`, nie `NextRequest`: funkcja dotyka wylacznie
 * `.headers.get(...)`, wiec szerszy typ wystarcza i odrywa ten modul od
 * importu next/server — dzieki temu chodzi tez w zwyklych testach node.
 */
export function requestHostname(request: Request): string | null {
  const raw = request.headers.get('origin') ?? request.headers.get('referer')
  if (!raw) return null
  try {
    return new URL(raw).hostname.toLowerCase()
  } catch {
    return null
  }
}

/**
 * Czy zadanie przyszlo z domeny tego portalu.
 *
 * TO JEST WLASCIWA BRAMA, nie `allowedOrigins` w `createSitepingHandler`.
 * Sprawdzone w skompilowanym pakiecie (`buildCorsHeaders` w `dist/index.js`):
 * `allowedOrigins` decyduje WYLACZNIE o tym, czy odpowiedz dostanie naglowek
 * `Access-Control-Allow-Origin`. Zadanie nie jest przez to odrzucane — curl
 * albo skrypt bez naglowka `Origin` przechodzi tamtedy nietkniety, bo CORS
 * jest mechanizmem przegladarki, a nie serwera.
 *
 * Brak `Origin` I `Referer` to takze odmowa: nic legalnego nie wola tego
 * endpointu spoza przegladarki. PATCH/DELETE swiadomie NIE przechodza przez
 * te brame — tam brama jest inna (`SITEPING_API_KEY`), a klient z tokenem
 * zadnego `Origin` nie wysyla.
 *
 * `siteDomains` zamiast calego portalu: ten modul nie musi znac wewnetrznego
 * ksztaltu `ResolvedPortal` z route.ts, a testy nie musza budowac falszywego
 * obiektu portalu — wystarczy tablica napisow.
 */
export function isFromAllowedDomain(request: Request, siteDomains: string[]): boolean {
  const hostname = requestHostname(request)
  if (!hostname) return false
  return siteDomains.some(d => d.toLowerCase() === hostname)
}

/**
 * Origin do naglowka CORS, jesli wolno go odeslac.
 *
 * `createSitepingHandler` porownuje `allowedOrigins` z naglowkiem `Origin`
 * ZNAK PO ZNAKU, a `site_domains` trzyma same nazwy hostow — podanie ich tam
 * wprost znaczyloby, ze naglowek CORS nie pojawi sie NIGDY i przegladarka
 * zablokowalaby kazda odpowiedz, lacznie z ta dla prawdziwego klienta.
 * Dlatego odsylamy dokladnie ten `Origin`, ktory przyszedl, i tylko wtedy, gdy
 * jego host przeszedl juz nasza wlasna kontrole (`isFromAllowedDomain`).
 */
export function corsOrigins(request: Request, siteDomains: string[]): string[] {
  const origin = request.headers.get('origin')
  if (!origin || !isFromAllowedDomain(request, siteDomains)) return []
  return [origin]
}
