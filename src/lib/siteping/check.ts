import { lokalny } from '../portalSite'

/**
 * Logika testu połączenia SitePinga — CZYSTA, bez sieci i bez bazy.
 *
 * Trasa `/api/admin/siteping/check` odpowiada za samo chodzenie po świecie
 * (ClickUp, strona klienta); wszystko, co decyduje o wyniku, siedzi tutaj,
 * żeby dało się to sprawdzić bez stawiania czegokolwiek.
 *
 * TRZY STANY, NIE DWA. Każde sprawdzenie zwraca `ok`, `fail` albo `unknown`.
 * `unknown` znaczy „nie udało się sprawdzić" (strona nie odpowiedziała, ClickUp
 * zwrócił błąd, minął czas) i w panelu jest myślnikiem, nigdy krzyżykiem.
 * Zlanie tych dwóch stanów wysyłałoby szukać nieistniejącego problemu, a to
 * gorsze niż brak testu.
 */
export type CheckState = 'ok' | 'fail' | 'unknown'

export type CheckRow = {
  /** Klucz do stabilnego renderu i do testów; nie pokazywany. */
  key: string
  label: string
  state: CheckState
  /** Zdanie po polsku: co konkretnie zobaczyliśmy. Zawsze wypełnione. */
  detail: string
}

/**
 * Tagi, które MUSZĄ istnieć w przestrzeni ClickUp klienta.
 *
 * PIĘĆ, nie jeden. Spec z 2026-08-10 wymieniał sam `siteping`, ale od tamtej
 * pory doszedł rodzaj zgłoszenia (`feedbackKindTags`) i każde zadanie dostaje
 * dwa tagi: `siteping` plus rodzaj. Pułapka ClickUpa jest ta sama dla obu —
 * nieistniejący tag jest po cichu POMIJANY przy tworzeniu zadania, bez błędu
 * i bez śladu — więc brak `zmiana` psuje filtrowanie dokładnie tak samo jak
 * brak `siteping`.
 *
 * Kolejność jest kolejnością wyświetlania: najpierw ten, bez którego nie
 * działa dedup, potem rodzaje.
 */
export const REQUIRED_TAGS = ['siteping', 'błąd', 'zmiana', 'pytanie', 'inne'] as const

/**
 * Których wymaganych tagów nie ma w przestrzeni.
 *
 * Porównanie po znormalizowanej nazwie: ClickUp zwraca nazwy tak, jak je ktoś
 * wpisał, a różnica wielkości liter albo spacja na końcu nie jest brakiem tagu.
 * Polskie znaki zostawiamy nietknięte — `błąd` i `blad` to DWA różne tagi
 * i tylko pierwszy z nich dostaje zadanie z `feedbackKindTags`.
 */
export function missingTags(existing: readonly string[]): string[] {
  const znane = new Set(existing.map(t => t.trim().toLowerCase()))
  return REQUIRED_TAGS.filter(t => !znane.has(t))
}

/**
 * Czy w pobranym HTML widać osadzony widget.
 *
 * Trzy niezależne ślady, bo osadzenie ma dziś dwie postacie (mu-plugin
 * generowany przez panel i ręczny snippet HTML), a strona może je wstrzykiwać
 * przez GTM albo bundlować adres skryptu inaczej, niż go wygenerowaliśmy.
 * Szukamy więc czegokolwiek, co jednoznacznie należy do SitePinga.
 *
 * Wielkość liter ignorowana dla ścieżki (serwery bywają case-insensitive),
 * ale `initSiteping` i `SitePing` szukamy tak samo bez rozróżnienia, bo tu
 * chodzi o wykrycie obecności, nie o poprawność kodu.
 */
export function detectWidget(html: string): boolean {
  const h = html.toLowerCase()
  return h.includes('siteping/widget.js') || h.includes('initsiteping') || h.includes('window.siteping')
}

/**
 * Wpisy z pola „Domeny strony klienta", oczyszczone.
 *
 * Zwracamy wpis W CAŁOŚCI, razem z portem: adres bez portu prowadzi donikąd
 * przy testach lokalnych (`localhost:5500`), a to jedyny sposób sprawdzenia
 * czegokolwiek przed wdrożeniem u klienta.
 */
export function parseSiteDomains(raw: string | null | undefined): string[] {
  return (raw ?? '')
    .split(',')
    .map(d => d.trim().replace(/^https?:\/\//i, '').replace(/\/.*$/, '').toLowerCase())
    .filter(d => d.length > 0)
}

/**
 * Adres, pod którym sprawdzamy obecność widgetu.
 *
 * Z PARAMETREM `?siteping=1`, i to jest sedno: mu-plugin generowany przez
 * panel osadza widget WARUNKOWO, tylko gdy parametr jest w adresie (inaczej
 * przycisk zgłaszania widziałby każdy odwiedzający stronę firmową). Pobranie
 * gołej strony dałoby więc „nie ma widgetu" u KAŻDEGO poprawnie
 * skonfigurowanego klienta — czyli fałszywy alarm zamiast testu.
 *
 * Token tożsamości do adresu NIE trafia: nikt tu nikogo nie zgłasza, a token
 * w żądaniu wychodzącym na cudzy serwer zostawiałby ślad w jego logach.
 */
export function checkUrl(entry: string): string {
  return `${lokalny(entry) ? 'http' : 'https'}://${entry}/?siteping=1`
}

/**
 * Czy wolno pójść za przekierowaniem.
 *
 * Test wychodzi na cudzą infrastrukturę, więc trzyma się listy domen z panelu:
 * przekierowanie poza nią kończy sprawdzenie zamiast prowadzić nas dalej.
 * `www.` po obu stronach jest tolerowane, bo `domena.pl` → `www.domena.pl` to
 * najczęstsze przekierowanie w internecie i traktowanie go jak wyjścia poza
 * allowlistę uczyniłoby test bezużytecznym dla większości stron.
 *
 * Schemat może się zmienić (http → https): to jest przekierowanie, po które
 * tu przyszliśmy, a hosta ono nie zmienia.
 */
export function isAllowedRedirect(location: string, entries: readonly string[]): boolean {
  let host: string
  try {
    host = new URL(location).hostname.toLowerCase()
  } catch {
    return false
  }
  const bezWww = (h: string) => h.replace(/^www\./, '')
  return entries.some(e => bezWww(e.split(':')[0]) === bezWww(host))
}

/** Ile przeskoków przez `Location` przechodzimy, zanim uznamy to za pętlę. */
export const MAX_REDIRECTS = 3

/** Ile czekamy na odpowiedź strony klienta. Po tym czasie wynik to `unknown`. */
export const FETCH_TIMEOUT_MS = 5_000

/**
 * Wynik sprawdzenia jednej domeny — POŁĄCZENIE dwóch sygnałów.
 *
 * Samo pobranie HTML kłamie w obie strony: strona budowana w przeglądarce,
 * CDN z cache albo skrypt wstrzykiwany przez GTM dadzą fałszywe „nie ma".
 * Sama historia zgłoszeń nic nie powie o świeżo skonfigurowanym kliencie,
 * u którego nikt jeszcze nic nie zgłosił, czyli akurat wtedy, gdy pytanie
 * jest najpilniejsze.
 *
 * Razem dają odpowiedź, którą da się przeczytać, i dlatego to jest jedna
 * funkcja, a nie dwa niezależne wiersze w tabeli.
 */
export function widgetVerdict(input: {
  /** `null`, gdy strony nie udało się pobrać. */
  htmlHasWidget: boolean | null
  /** Kiedy ostatnio przyszło zgłoszenie z tego portalu; `null` = nigdy. */
  lastFeedbackAt: Date | null
  /** Powód nieudanego pobrania, do treści komunikatu. */
  fetchError?: string | null
  now?: Date
}): { state: CheckState; detail: string } {
  const { htmlHasWidget, lastFeedbackAt, fetchError, now = new Date() } = input
  const kiedys = lastFeedbackAt
    ? `zgłoszenia z tego projektu przychodziły (ostatnie ${dni(lastFeedbackAt, now)})`
    : null

  if (htmlHasWidget === true) {
    return {
      state: 'ok',
      detail: kiedys ? `skrypt widoczny na stronie, ${kiedys}` : 'skrypt widoczny na stronie',
    }
  }

  if (htmlHasWidget === null) {
    // Nie udało się pobrać: to NIE jest „nie ma widgetu". Historia zgłoszeń
    // zostaje wtedy jedynym sygnałem i jest wart pokazania.
    const powod = fetchError ? `nie udało się pobrać strony (${fetchError})` : 'nie udało się pobrać strony'
    return { state: 'unknown', detail: kiedys ? `${powod}, ale ${kiedys}` : powod }
  }

  // HTML pobrany, skryptu nie ma. Historia zgłoszeń decyduje, czy to awaria,
  // czy tylko granica metody: jeśli zgłoszenia przychodziły, widget gdzieś
  // jest (GTM, wstrzyknięcie po stronie przeglądarki), tylko go nie widać.
  if (lastFeedbackAt) {
    return {
      state: 'unknown',
      detail: `nie widzę skryptu w kodzie strony, ale ${kiedys} — prawdopodobnie wstrzykiwany po stronie przeglądarki`,
    }
  }

  return {
    state: 'fail',
    detail: 'nie widzę skryptu w kodzie strony i nie było jeszcze żadnego zgłoszenia',
  }
}

/**
 * Przyczyny nieudanego połączenia, nazwane po ludzku.
 *
 * `fetch` w Node zwraca dla WSZYSTKICH z nich to samo zdanie: „fetch failed".
 * Prawdziwy powód siedzi w `error.cause.code` i to on decyduje, co robić dalej:
 * wygasły certyfikat naprawia klient, literówka w domenie my, a odrzucone
 * połączenie znaczy zwykle, że serwer po prostu nie chodzi.
 */
const PRZYCZYNY: Record<string, string> = {
  ECONNREFUSED: 'serwer odrzucił połączenie',
  ENOTFOUND: 'domena nie istnieje w DNS',
  EAI_AGAIN: 'DNS nie odpowiedział',
  ETIMEDOUT: 'przekroczony czas połączenia',
  ECONNRESET: 'połączenie zerwane',
  CERT_HAS_EXPIRED: 'wygasł certyfikat strony',
  DEPTH_ZERO_SELF_SIGNED_CERT: 'certyfikat strony jest niezaufany',
  UNABLE_TO_VERIFY_LEAF_SIGNATURE: 'nie da się zweryfikować certyfikatu strony',
  ERR_TLS_CERT_ALTNAME_INVALID: 'certyfikat wystawiony na inną domenę',
}

/**
 * Powód błędu w jednym zdaniu, do pokazania w panelu.
 *
 * Przerwanie po czasie nazywamy wprost: „TimeoutError" nic nie mówi osobie,
 * która patrzy na wynik i ma zdecydować, co dalej.
 */
export function describeFetchError(error: unknown, timeoutMs = FETCH_TIMEOUT_MS): string {
  if (!(error instanceof Error)) return 'nieznany błąd'

  if (error.name === 'TimeoutError' || error.name === 'AbortError') {
    return `brak odpowiedzi w ${timeoutMs / 1000} s`
  }

  const kod = (error.cause as { code?: string } | undefined)?.code
  if (kod) return PRZYCZYNY[kod] ?? kod

  return error.message.slice(0, 120)
}

/**
 * „3 dni temu" zamiast daty: przy tym pytaniu liczy się rząd wielkości,
 * a nie dokładny znacznik czasu.
 */
function dni(kiedy: Date, now: Date): string {
  const d = Math.floor((now.getTime() - kiedy.getTime()) / 86_400_000)
  if (d < 1) return 'dzisiaj'
  if (d < 2) return 'wczoraj'
  return `${d} dni temu`
}
