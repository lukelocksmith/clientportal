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
/**
 * Rodzaj zgloszenia z widgetu.
 *
 * Te cztery wartosci narzuca `@siteping/adapter-prisma` — walidacja odrzuca
 * cokolwiek innego, wiec lista jest zamknieta nie z naszego wyboru.
 */
export type FeedbackKind = 'bug' | 'change' | 'question' | 'other'

/**
 * Etykieta do OPISU zadania i nazwa TAGU w ClickUpie.
 *
 * Po polsku, bo opis czyta zespol i klient, a nie maszyna. `tag` jest osobny
 * od `label`, bo tagi w ClickUpie sa wspolne dla calej przestrzeni klientow
 * i lepiej, zeby mialy krotka, jednoznaczna postac.
 *
 * PULAPKA CLICKUPA, ktora juz nas kosztowala: tag NIEISTNIEJACY w przestrzeni
 * jest po cichu POMIJANY przy tworzeniu zadania — bez bledu, bez sladu.
 * Znaczy to, ze te cztery tagi trzeba zalozyc w przestrzeni klienta RECZNIE,
 * zanim wlaczy sie mu SitePinga. Dlatego rodzaj trafia TAKZE do opisu, ktory
 * dziala zawsze: opis jest zrodlem prawdy, tag jest wygoda przy filtrowaniu.
 */
const RODZAJE: Record<FeedbackKind, { label: string; tag: string }> = {
  bug: { label: '🐞 Błąd', tag: 'błąd' },
  change: { label: '✏️ Zmiana', tag: 'zmiana' },
  question: { label: '❓ Pytanie', tag: 'pytanie' },
  other: { label: '💬 Inne', tag: 'inne' },
}

/** Nieznana wartosc traktujemy jak `other`, zamiast gubic zgloszenie. */
function rodzaj(kind: string | null | undefined): { label: string; tag: string } {
  return RODZAJE[(kind ?? '') as FeedbackKind] ?? RODZAJE.other
}

/** Etykieta rodzaju do opisu zadania. */
export function feedbackKindLabel(kind: string | null | undefined): string {
  return rodzaj(kind).label
}

/**
 * Tag ClickUpa dla rodzaju zgloszenia, ZAWSZE razem z tagiem `siteping`.
 *
 * Dwa tagi, nie jeden: `siteping` odpowiada na pytanie „skad to przyszlo",
 * rodzaj na „czego dotyczy". Filtrowanie po obu naraz jest tym, po co zespol
 * w ogole siega do tagow.
 */
export function feedbackKindTags(kind: string | null | undefined): string[] {
  return ['siteping', rodzaj(kind).tag]
}

export function buildFeedbackDescription(input: {
  clientId: string
  url: string
  message: string
  annotation: AnnotationLike | null
  siteOrigin?: string | null
  feedbackId?: string | null
  /** `bug` | `change` | `question` | `other`. Nieznane traktujemy jak `other`. */
  kind?: string | null
}): string {
  // TRESC KLIENTA ZOSTAJE W PIERWSZEJ LINII. Rodzaj wchodzi nizej, do bloku
  // „gdzie i co", razem z linkiem i elementem. Do skanowania listy zadan sluzy
  // TAG, ktory ClickUp pokazuje przy nazwie — opis czyta sie dopiero po wejsciu.
  const lines = [input.message.trim(), '', `**Rodzaj:** ${feedbackKindLabel(input.kind)}`]

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
