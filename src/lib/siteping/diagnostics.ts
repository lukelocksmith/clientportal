/**
 * Ślad techniczny z chwili zgłoszenia: konsola i nieudane żądania.
 *
 * Widget zbiera to, gdy ma włączone `captureDiagnostics`. Powstało pod
 * zgłoszenia w rodzaju „strona nie działa", które nie niosą żadnych
 * szczegółów — a ślad błędu z konsoli i status 500 mówią zespołowi więcej niż
 * opis, którego klient nie umie napisać.
 *
 * CZYSTY moduł, bez sieci i bez bazy: formatowanie tekstu da się sprawdzić
 * testem, a wyjście trafia do ClickUpa, więc rozmiar i kształt mają znaczenie.
 *
 * ⚠️ PRYWATNOŚĆ. Konsola strony klienta może zawierać COKOLWIEK, co ta strona
 * loguje, łącznie z danymi jego użytkowników. Adresy nieudanych żądań niosą
 * pełny query string. Zanim włączysz zbieranie na produkcji klienta, powiedz
 * mu o tym — to jego dane, nie nasze. Treści odpowiedzi widget NIE zbiera.
 */

export type ConsoleEntry = {
  level: string
  timestamp: string
  message: string
}

export type NetworkEntry = {
  url: string
  method: string
  /** 0 znaczy, że żądanie nigdy nie doszło do serwera. */
  status: number
  durationMs: number
  timestamp: string
}

export type Diagnostics = {
  console?: ConsoleEntry[] | null
  network?: NetworkEntry[] | null
}

/**
 * Ile wpisów pokazujemy w komentarzu.
 *
 * Widget zbiera domyślnie 50 konsoli i 20 sieci. Wszystkie w komentarzu dałyby
 * ścianę tekstu, przez którą nikt nie przebrnie, a komentarz ma być czytany.
 * Pełny komplet i tak zostaje w załączniku JSON zadania, więc nic nie ginie.
 */
const MAX_KONSOLA = 15
const MAX_SIEC = 10

/** Ucięcie pojedynczej linii: jeden `console.log` potrafi mieć kilobajty. */
const MAX_DLUGOSC_LINII = 300

const WAZNE_POZIOMY = new Set(['error', 'warn'])

function skroc(text: string, max = MAX_DLUGOSC_LINII): string {
  const jedna = text.replace(/\s+/g, ' ').trim()
  return jedna.length > max ? `${jedna.slice(0, max - 1)}…` : jedna
}

function godzina(iso: string): string {
  const d = new Date(iso)
  return Number.isNaN(d.getTime())
    ? '--:--:--'
    : d.toLocaleTimeString('pl-PL', { hour: '2-digit', minute: '2-digit', second: '2-digit' })
}

/**
 * Czy jest cokolwiek warte pokazania.
 *
 * Pusty ślad NIE zasługuje na komentarz: zadanie z komentarzem „brak danych"
 * wygląda jak awaria zbierania, a jest zwykłą ciszą w konsoli.
 */
export function hasDiagnostics(d: Diagnostics | null | undefined): boolean {
  if (!d) return false
  return (d.console?.length ?? 0) > 0 || (d.network?.length ?? 0) > 0
}

/**
 * Komentarz do zadania ze śladem technicznym, albo null.
 *
 * KOMENTARZ, nie opis: opis ma zostać czytelny dla klienta i dla zespołu
 * skanującego listę, a to jest materiał do wejścia w szczegóły. Bez prefiksu
 * `[P]`, więc zostaje wewnętrzny — klient w portalu tego nie zobaczy, i dobrze,
 * bo to jego własne błędy techniczne, których nie musi oglądać w naszym opisie.
 *
 * BŁĘDY I OSTRZEŻENIA IDĄ PIERWSZE. Przy piętnastu wpisach kolejność
 * chronologiczna zakopałaby jedyny wyjątek pod dziesięcioma `console.log`
 * z biblioteki analitycznej.
 */
export function buildDiagnosticsComment(d: Diagnostics | null | undefined): string | null {
  if (!hasDiagnostics(d)) return null

  const lines: string[] = ['🔍 **Ślad techniczny z chwili zgłoszenia**']

  const konsola = d!.console ?? []
  if (konsola.length > 0) {
    const wazne = konsola.filter(w => WAZNE_POZIOMY.has(w.level?.toLowerCase()))
    const reszta = konsola.filter(w => !WAZNE_POZIOMY.has(w.level?.toLowerCase()))
    const wybrane = [...wazne, ...reszta].slice(0, MAX_KONSOLA)

    lines.push('', `**Konsola** (${konsola.length}):`)
    for (const w of wybrane) {
      lines.push(`- \`${godzina(w.timestamp)}\` **${(w.level ?? '?').toUpperCase()}** ${skroc(w.message ?? '')}`)
    }
    if (konsola.length > wybrane.length) {
      lines.push(`_…i jeszcze ${konsola.length - wybrane.length}. Komplet w załączniku JSON._`)
    }
  }

  const siec = d!.network ?? []
  if (siec.length > 0) {
    lines.push('', `**Nieudane żądania** (${siec.length}):`)
    for (const z of siec.slice(0, MAX_SIEC)) {
      // Status 0 znaczy, ze zadanie nigdy nie doszlo do serwera — inna
      // przyczyna niz 500 i inna reakcja, wiec nazywamy to wprost.
      const status = z.status === 0 ? 'brak odpowiedzi' : String(z.status)
      lines.push(`- \`${status}\` ${z.method ?? '?'} ${skroc(z.url ?? '', 160)} _(${z.durationMs ?? 0} ms)_`)
    }
    if (siec.length > MAX_SIEC) {
      lines.push(`_…i jeszcze ${siec.length - MAX_SIEC}. Komplet w załączniku JSON._`)
    }
  }

  return lines.join('\n')
}
