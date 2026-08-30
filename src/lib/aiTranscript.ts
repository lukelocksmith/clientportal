/**
 * Zapis rozmowy z asystentem AI do weryfikacji przez człowieka.
 *
 * PO CO TO POWSTAŁO (30.08). Łukasz zgłosił przez asystenta zadanie w portalu
 * testowym i nie pojawiło się ono na tablicy. Dochodzenie pokazało, że:
 * rozmowa się odbyła (6 wywołań modelu w `ai_usage`), zadania w ClickUpie nie
 * ma, wpisu `task_created` w historii projektu nie ma. Czyli narzędzie
 * `createTask` nigdy się nie wykonało. DLACZEGO — nie dało się ustalić, bo
 * z rozmowy nie zostawało NIC poza liczbą tokenów.
 *
 * Bez treści rozmowy nie da się odróżnić trzech zupełnie różnych awarii:
 *   - model w ogóle nie wywołał narzędzia (i mimo to napisał „dodane"),
 *   - narzędzie poleciało wyjątkiem z ClickUpa (SDK zjada go po cichu i
 *     oddaje modelowi jako wynik, w logach kontenera nie ma śladu),
 *   - klient sam nie potwierdził i rozmowa skończyła się pytaniem.
 *
 * Ten moduł jest CZYSTY (bez bazy i bez SDK), żeby dało się go testować bez
 * sieci; zapis do bazy robi trasa czatu.
 */

/** Jedna tura rozmowy albo jedno użycie narzędzia. */
export type TranscriptTurn = {
  role: 'user' | 'assistant' | 'tool'
  /** Treść wypowiedzi. Przy turze narzędzia puste. */
  text?: string
  /** Wywołanie narzędzia: co model chciał zrobić i co dostał z powrotem. */
  tool?: {
    name: string
    input: unknown
    output?: unknown
    /** Wypełnione, gdy `execute` poleciało wyjątkiem albo oddało `{ error }`. */
    error?: string
  }
}

export type TranscriptOutcome = 'zadanie' | 'rozmowa' | 'blad' | 'podejrzane'

/**
 * Dłuższa wypowiedź jest ucinana, nie odrzucana. Rozmowa o zgłoszeniu to
 * kilka zdań; wszystko powyżej to albo wklejony log, albo nadużycie, a i tak
 * do weryfikacji wystarczy początek.
 */
export const MAX_TEXT_CHARS = 4_000

/** Górny limit tur w jednym zapisie. Trasa czatu i tak przyjmuje max 60 wiadomości. */
export const MAX_TURNS = 140

/**
 * Zdania, którymi asystent OBIECUJE, że zgłoszenie istnieje.
 *
 * Po co osobna lista: brak zadania jest zły, ale brak zadania POŁĄCZONY ze
 * zdaniem „zgłoszenie zapisane" jest gorszy. Klient, który to przeczytał,
 * zamyka okno i czeka. Nikt nie czeka na coś, o czym wie, że nie zostało
 * zgłoszone. Dokładnie to zdarzenie zaczęło całą tę robotę (30.08).
 *
 * Czas teraźniejszy („zapisuję to jako zadanie") jest tak samo wiążący jak
 * przeszły: dla czytającego to jest deklaracja, że sprawa poszła dalej.
 */
const OBIETNICE_ZGLOSZENIA: readonly RegExp[] = [
  // Granica słowa jako `\p{L}`, nie `\b`: polskie „ę" na końcu wyrazu nie jest
  // dla `\b` znakiem słowa, więc /\bzapisuję\b/ NIE łapie „zapisuję to".
  /(?<!\p{L})(zgłaszam|zgłosiłem|zgłosiłam|zgłoszone)(?!\p{L})/u,
  /(?<!\p{L})(dodałem|dodałam|dodaję|utworzyłem|utworzyłam|zapisałem|zapisałam|zapisuję)(?!\p{L})/u,
  /zadanie\s+(zostało|jest|już)\s+(dodane|zapisane|utworzone|zgłoszone|na tablicy)/,
  /zgłoszenie\s+(zostało|jest|już)\s+(zapisane|przyjęte|dodane|utworzone)/,
  /(pojawi się|pojawia się|jest już|są już|trafiło|trafi)[^.!?]{0,40}na tablicy/,
]

/**
 * Czy w tej wypowiedzi asystent twierdzi, że zadanie powstało.
 *
 * Pytania odpadają: „mam to zgłosić?" jest prośbą o zgodę, nie obietnicą.
 * Dlatego patrzymy zdaniami, a nie na cały tekst naraz — jedno pytanie na
 * końcu wypowiedzi nie może unieważnić twierdzenia z jej środka ani odwrotnie.
 */
export function claimsTaskCreated(text: string | null | undefined): boolean {
  if (typeof text !== 'string' || !text.trim()) return false
  const zdania = text.toLowerCase().split(/(?<=[.!?\n])/)
  return zdania.some(zdanie => {
    if (zdanie.trimEnd().endsWith('?')) return false
    return OBIETNICE_ZGLOSZENIA.some(wzor => wzor.test(zdanie))
  })
}

function truncate(text: string): string {
  return text.length <= MAX_TEXT_CHARS ? text : `${text.slice(0, MAX_TEXT_CHARS)}… [ucięte]`
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null
}

/**
 * Tekst z wiadomości interfejsu (`UIMessage`). Części inne niż tekstowe
 * (załączniki, wywołania narzędzi po stronie klienta) pomijamy: transkrypt ma
 * odtworzyć ROZMOWĘ, a nie strukturę protokołu.
 */
export function textFromParts(parts: unknown): string {
  if (!Array.isArray(parts)) return ''
  const chunks: string[] = []
  for (const part of parts) {
    if (typeof part === 'string') {
      chunks.push(part)
      continue
    }
    if (isRecord(part) && part.type === 'text' && typeof part.text === 'string') {
      chunks.push(part.text)
    }
  }
  return chunks.join('\n').trim()
}

/**
 * Tury rozmowy z tego, co przyszło od klienta. Bierzemy TYLKO wiadomości
 * użytkownika: odpowiedzi asystenta z poprzednich tur i tak są w zapisach
 * z tamtych żądań, a powtarzanie ich rosłoby kwadratowo z długością rozmowy.
 */
export function userTurns(uiMessages: unknown): TranscriptTurn[] {
  if (!Array.isArray(uiMessages)) return []
  const turns: TranscriptTurn[] = []
  for (const message of uiMessages) {
    if (!isRecord(message) || message.role !== 'user') continue
    const text = textFromParts(message.parts)
    if (text) turns.push({ role: 'user', text: truncate(text) })
  }
  return turns
}

/** Czy wynik narzędzia jest odmową („nie udało się"), a nie sukcesem. */
function errorFromOutput(output: unknown): string | undefined {
  if (!isRecord(output)) return undefined
  if (typeof output.error === 'string') return output.error
  return undefined
}

type StepLike = {
  text?: string
  toolCalls?: Array<{ toolName?: string; input?: unknown; toolCallId?: string }>
  toolResults?: Array<{ toolName?: string; output?: unknown; toolCallId?: string; error?: unknown }>
}

/**
 * Tury z kroków modelu. Jeden krok to jedno wywołanie modelu: może mieć tekst,
 * wywołania narzędzi i ich wyniki.
 */
export function stepTurns(steps: unknown): TranscriptTurn[] {
  if (!Array.isArray(steps)) return []
  const turns: TranscriptTurn[] = []

  for (const raw of steps) {
    if (!isRecord(raw)) continue
    const step = raw as StepLike

    const text = typeof step.text === 'string' ? step.text.trim() : ''
    if (text) turns.push({ role: 'assistant', text: truncate(text) })

    const results = Array.isArray(step.toolResults) ? step.toolResults : []
    for (const call of Array.isArray(step.toolCalls) ? step.toolCalls : []) {
      if (!isRecord(call)) continue
      const result = results.find(r => isRecord(r) && r.toolCallId === call.toolCallId)
      const output = result?.output
      // Wyjątek z `execute` SDK oddaje jako wynik narzędzia, nie jako awarię
      // strumienia. Bez tego rozgałęzienia awaria ClickUpa wyglądałaby
      // w zapisie identycznie jak udane utworzenie zadania.
      const error =
        (result && typeof result.error === 'string' ? result.error : undefined) ??
        errorFromOutput(output)
      turns.push({
        role: 'tool',
        tool: {
          name: typeof call.toolName === 'string' ? call.toolName : 'nieznane',
          input: call.input ?? null,
          ...(output !== undefined ? { output } : {}),
          ...(error ? { error } : {}),
        },
      })
    }
  }

  return turns
}

/** Pełny zapis rozmowy: co napisał klient, co odpisał model, co zrobiło narzędzie. */
export function buildTranscript(uiMessages: unknown, steps: unknown): TranscriptTurn[] {
  return [...userTurns(uiMessages), ...stepTurns(steps)].slice(-MAX_TURNS)
}

/**
 * Wynik rozmowy jednym słowem, do kolumny w panelu.
 *
 * „rozmowa" nie jest awarią: klient mógł tylko dopytać. Awarią jest „blad"
 * (narzędzie wywołane i nieudane) oraz „podejrzane": model NIE tknął
 * narzędzia, a klientowi napisał, że zgłoszenie jest zapisane. To ostatnie
 * jest najgorszym z wyników, bo klient odchodzi od ekranu przekonany, że
 * sprawa poszła dalej.
 */
export function transcriptOutcome(turns: readonly TranscriptTurn[]): {
  outcome: TranscriptOutcome
  taskId: string | null
  taskName: string | null
} {
  let outcome: TranscriptOutcome = 'rozmowa'
  let taskId: string | null = null
  let taskName: string | null = null
  let uzytoNarzedzia = false

  for (const turn of turns) {
    if (turn.role !== 'tool' || !turn.tool) continue
    uzytoNarzedzia = true
    if (turn.tool.error) {
      outcome = 'blad'
      continue
    }
    const output = turn.tool.output
    if (isRecord(output) && output.success === true) {
      outcome = 'zadanie'
      if (typeof output.taskId === 'string') taskId = output.taskId
      if (typeof output.taskName === 'string') taskName = output.taskName
    }
  }

  // Rozmowa, w której model NIE tknął narzędzia, ale napisał klientowi, że
  // zgłoszenie jest zapisane. To nie jest „rozmowa", to jest cicha strata
  // zgłoszenia i ma się rzucać w oczy w panelu.
  if (!uzytoNarzedzia && turns.some(t => t.role === 'assistant' && claimsTaskCreated(t.text))) {
    outcome = 'podejrzane'
  }

  return { outcome, taskId, taskName }
}
