import { claimsTaskCreated, type TranscriptTurn } from './aiTranscript'

/**
 * RATUNEK ZGŁOSZENIA, KTÓREGO ASYSTENT OBIECAŁ I NIE ZAŁOŻYŁ.
 *
 * PO CO TO POWSTAŁO (11.09). Klientka Onyxa napisała 4 września przez czat
 * w portalu, potwierdziła poziom słowem „tak", a asystent odpisał: „Gotowe!
 * Zadanie »Optymalizacja i kompresja wideo pod stronę« zostało zgłoszone jako
 * P3. Za chwilę powinno pojawić się na tablicy." — i NIE wywołał narzędzia
 * `createTask`. W bazie została rozmowa z wynikiem `podejrzane`, w ClickUpie
 * nie ma nic, w kolejce nie ma nic, w historii projektu nie ma `task_created`.
 * Klientka czekała tydzień i upomniała się na WhatsAppie.
 *
 * Wykrywanie tego przypadku istniało od 30.08 (`transcriptOutcome`), ale było
 * BIERNE: wpis w panelu i ostrzeżenie w logach kontenera. Nikt na to nie
 * patrzył, bo nikt nie siedzi w logach kontenera, a panel ogląda się wtedy,
 * gdy już wiadomo, że coś zginęło. Sygnał, na który nikt nie reaguje, nie jest
 * zabezpieczeniem.
 *
 * Ten moduł zamienia wykrycie w działanie: z samego zapisu rozmowy, BEZ
 * pytania modelu o cokolwiek, składa zadanie i oddaje je kolejce
 * `pending_reports`. Model już raz zawiódł w tej rozmowie, więc powierzanie mu
 * poprawki byłoby budowaniem bezpiecznika z tego samego materiału, który pękł.
 *
 * Moduł jest CZYSTY (bez bazy, bez SDK, bez sieci), tak samo jak
 * `aiTranscript.ts` — zapis do kolejki robi trasa czatu.
 */

/**
 * Górna granica nazwy zadania. ClickUp przyjmuje więcej, ale nazwa jedzie na
 * kanban klienta, gdzie karta ma jeden wiersz; dłuższa i tak zostaje ucięta,
 * tyle że bez naszej kontroli nad miejscem cięcia.
 */
export const MAX_NAZWA_CHARS = 80

/** Zadanie odtworzone z rozmowy. */
export type PlanRatunkowy = {
  name: string
  description: string
}

/**
 * Nazwa zadania, którą asystent wypowiedział klientowi.
 *
 * Szukamy w cudzysłowie, bo tak brzmi obietnica: „Zadanie »X« zostało
 * zgłoszone". To jest nazwa, którą klient PRZECZYTAŁ, więc pod nią będzie
 * szukał sprawy na tablicy. Każda inna, choćby trafniejsza, wygląda dla niego
 * jak inne zgłoszenie.
 */
function nazwaZObietnicy(text: string): string | null {
  const wzory = [/[„"»]([^„""»«]{3,200})[""«"]/, /'([^']{3,200})'/]
  for (const wzor of wzory) {
    const trafienie = text.match(wzor)
    if (trafienie?.[1]?.trim()) return trafienie[1].trim()
  }
  return null
}

/** Skraca do limitu po granicy słowa, z wielokropkiem zamiast urwanego wyrazu. */
function przytnij(text: string): string {
  const jednaLinia = text.replace(/\s+/g, ' ').trim()
  if (jednaLinia.length <= MAX_NAZWA_CHARS) return jednaLinia
  const ciete = jednaLinia.slice(0, MAX_NAZWA_CHARS - 1)
  const spacja = ciete.lastIndexOf(' ')
  return `${(spacja > MAX_NAZWA_CHARS / 2 ? ciete.slice(0, spacja) : ciete).trimEnd()}…`
}

/** Rozmowa przepisana do Markdownu, rola po roli. */
function zapisRozmowy(turns: readonly TranscriptTurn[]): string {
  const etykieta: Record<TranscriptTurn['role'], string> = {
    user: 'Klient',
    assistant: 'Asystent',
    tool: 'System',
  }
  return turns
    .map(turn => {
      if (turn.role === 'tool') return `**System:** wywołanie narzędzia ${turn.tool?.name ?? 'nieznane'}`
      const text = (turn.text ?? '').trim()
      return text ? `**${etykieta[turn.role]}:** ${text}` : ''
    })
    .filter(Boolean)
    .join('\n\n')
}

/**
 * Czy w tej rozmowie narzędzie w ogóle zostało tknięte.
 *
 * Jedno wywołanie wystarczy, żeby ratunek odpadł — także wywołanie NIEUDANE.
 * Nieudane oznacza, że sprawa jest już w kolejce `pending_reports` (trasa
 * czatu odkłada ją tam sama), a drugie zadanie z tej samej rozmowy to
 * duplikat na tablicy klienta.
 */
function tknietoNarzedzie(turns: readonly TranscriptTurn[]): boolean {
  return turns.some(t => t.role === 'tool')
}

/**
 * Zadanie odtworzone z porzuconej rozmowy albo `null`, gdy nie ma czego ratować.
 *
 * `null` jest odpowiedzią poprawną i najczęstszą: zwykłe dopytywanie, udane
 * zgłoszenie i zgłoszenie w kolejce po awarii ClickUpa nie wymagają niczego.
 * Ratujemy WYŁĄCZNIE ten jeden układ: obietnica wypowiedziana klientowi
 * i nietknięte narzędzie.
 */
export function planRatunkowy(turns: readonly TranscriptTurn[] | undefined | null): PlanRatunkowy | null {
  if (!Array.isArray(turns) || turns.length === 0) return null
  if (tknietoNarzedzie(turns)) return null

  const obietnice = turns.filter(t => t.role === 'assistant' && claimsTaskCreated(t.text))
  if (obietnice.length === 0) return null

  const wypowiedziKlienta = turns.filter(t => t.role === 'user' && (t.text ?? '').trim())
  if (wypowiedziKlienta.length === 0) return null

  const ostatniaObietnica = obietnice[obietnice.length - 1].text ?? ''
  const name = przytnij(nazwaZObietnicy(ostatniaObietnica) ?? wypowiedziKlienta[0].text!)

  const description = [
    '## Cel zadania',
    'Zgłoszenie odtworzone z rozmowy klienta z asystentem w portalu. Asystent',
    'potwierdził klientowi przyjęcie zgłoszenia, ale nie zapisał go w systemie,',
    'więc treść pochodzi wprost z rozmowy, bez opracowania.',
    '',
    '## Poziom',
    'Do ustalenia przez zespół. Poziom, o którym mowa w rozmowie, nie został',
    'zapisany w zadaniu, więc traktujcie go jako propozycję, nie ustalenie.',
    '',
    '## Przebieg rozmowy',
    zapisRozmowy(turns),
  ].join('\n')

  return { name, description }
}
