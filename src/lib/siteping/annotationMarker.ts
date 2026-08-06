/**
 * Budowa opisu zadania ClickUp z danych SitePing, i odczyt z powrotem.
 *
 * Czysty modul: bez ClickUp, bez bazy, bez sieci. ClickUp jest jedynym
 * miejscem przechowywania — ten modul tylko koduje/dekoduje to, co trzeba
 * odnalezc bez dociagania zalacznika (clientId do dedupu, url do filtrowania
 * getFeedbacks), zeby findByClientId/getFeedbacks dzialaly na tym, co juz
 * zwraca lista zadan, bez zadania per-task fetcha.
 */

interface AnnotationLike {
  cssSelector: string
  xpath: string
  textSnippet: string
  elementTag: string
  elementId?: string | null
  textPrefix: string
  textSuffix: string
  fingerprint: string
  neighborText: string
  anchorKey?: string | null
  xPct: number
  yPct: number
  wPct: number
  hPct: number
  scrollX: number
  scrollY: number
  viewportW: number
  viewportH: number
  devicePixelRatio: number
}

const CLIENT_ID_MARKER = /<!--\s*siteping-client-id:([a-zA-Z0-9_-]+)\s*-->/
const URL_MARKER = /<!--\s*siteping-url:([^\s]+)\s*-->/

export function embedClientIdMarker(clientId: string): string {
  return `<!-- siteping-client-id:${clientId} -->`
}

export function extractClientIdFromDescription(description: string | null): string | null {
  if (!description) return null
  const match = description.match(CLIENT_ID_MARKER)
  return match ? match[1] : null
}

export function embedUrlMarker(url: string): string {
  return `<!-- siteping-url:${encodeURIComponent(url)} -->`
}

export function extractUrlFromDescription(description: string | null): string | null {
  if (!description) return null
  const match = description.match(URL_MARKER)
  return match ? decodeURIComponent(match[1]) : null
}

/** Nazwa parametru, po ktorym widget SitePinga rozpoznaje glebokie linkowanie. */
const DEEP_LINK_PARAM = 'siteping'

/**
 * Adres, ktory otwiera strone klienta I podświetla zaznaczone miejsce.
 *
 * Widget umie to sam: przy `deepLink: true` w konfiguracji czyta parametr
 * `?siteping=<id zgloszenia>` przy starcie, przewija do anotacji, przypina
 * podswietlenie i pulsuje znacznikiem. Bez tej flagi po stronie osadzenia link
 * otworzy zwykla strone i nic nie podświetli — to jest wymog konfiguracji, nie
 * opcja (patrz `scripts/siteping-manual-test.html`).
 *
 * `pageUrl` z widgetu to sciezka (`/oferta`), a nie pelny adres, wiec sklejamy
 * ja z origin, ktory portal ma zapisany. Gdy origin jest nieznany, zwracamy
 * null zamiast zgadywac schemat czy domene — polamany link jest gorszy niz
 * jego brak, bo zespol traci czas na sprawdzanie, czemu nie dziala.
 */
export function buildAnnotationLink(
  siteOrigin: string | null | undefined,
  pageUrl: string,
  feedbackId: string
): string | null {
  if (!siteOrigin) return null

  try {
    const url = new URL(pageUrl, siteOrigin)
    url.searchParams.set(DEEP_LINK_PARAM, feedbackId)
    return url.toString()
  } catch {
    return null
  }
}

/**
 * Opis zadania w ClickUpie.
 *
 * KOLEJNOSC JEST CELOWA. Na gorze tresc zgloszenia, bo to ona trafia do
 * podgladu zadania, do powiadomien i na karte — zespol ma najpierw widziec, o
 * co klient prosi, a nie sciezke CSS. Nizej „gdzie", czyli klikalny link i
 * element. Na samym dole markery, ktore sa dla maszyny, nie dla czlowieka.
 *
 * `feedbackId` jest opcjonalne, bo identyfikator zadania powstaje dopiero po
 * jego utworzeniu: opis budujemy dwa razy, drugi raz z linkiem (patrz
 * `createFeedback` w store.ts).
 */
export function buildFeedbackDescription(input: {
  clientId: string
  url: string
  message: string
  annotation: AnnotationLike | null
  siteOrigin?: string | null
  feedbackId?: string | null
}): string {
  const lines = [input.message.trim(), '']

  const link = input.feedbackId
    ? buildAnnotationLink(input.siteOrigin, input.url, input.feedbackId)
    : null

  if (link) {
    lines.push('**🔗 Zobacz na stronie:**', link, '_(otwiera stronę i podświetla zaznaczone miejsce)_', '')
  } else {
    lines.push(`**Strona:** ${input.url}`)
  }

  if (input.annotation) {
    const a = input.annotation
    const tag = a.elementTag.toLowerCase()
    const label = a.textSnippet ? ` — „${a.textSnippet.trim().slice(0, 80)}”` : ''
    lines.push(
      `**Element:** \`${tag}${a.elementId ? '#' + a.elementId : ''}\`${label}`,
      `**Selektor:** \`${a.cssSelector}\``
    )
  }

  return lines.join('\n').trimEnd()
}

/**
 * Dokleja markery na SAMYM koncu, juz po stopce zglaszajacego.
 *
 * Osobno od `buildFeedbackDescription`, bo miedzy tresc a markery wchodzi
 * jeszcze stopka z `withReporterFooter` — gdyby markery byly czescia opisu,
 * ladowalyby w srodku, nad stopka. ClickUp pokazuje komentarze HTML jako
 * zwykly tekst, wiec ich miejsce jest na dole, gdzie nikomu nie przeszkadzaja.
 */
export function withSitepingMarkers(text: string, clientId: string, url: string): string {
  return `${text}\n\n${embedClientIdMarker(clientId)}\n${embedUrlMarker(url)}`
}

export function buildFeedbackTitle(message: string): string {
  const trimmed = message.trim()
  if (!trimmed) return 'Zgłoszenie ze strony'
  return trimmed.length > 80 ? `${trimmed.slice(0, 77)}...` : trimmed
}
