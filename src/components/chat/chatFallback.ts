import { claimsTaskCreated } from '@/lib/aiTranscript'

/**
 * KIEDY CZAT MA ODDAĆ SPRAWĘ FORMULARZOWI.
 *
 * PO CO (11.09). Serwer od tego dnia ratuje porzucone zgłoszenie do kolejki
 * (lib/aiRescue.ts), ale klient nadal siedzi przed zdaniem „Gotowe, zadanie
 * zostało zgłoszone" i nie wie, że stało się coś nie tak. To jest ta sama
 * cicha strata, tylko z siatką pod spodem. Tutaj rozpoznajemy ten układ
 * PO STRONIE PRZEGLĄDARKI, żeby powiedzieć klientowi prawdę i dać mu drogę,
 * na której nie ma modelu.
 *
 * Czysty moduł, bez Reacta: reguła daje się sprawdzić bez renderowania okna.
 */

/** Kształt wiadomości z `useChat`, zawężony do tego, co nas tu obchodzi. */
export type WiadomoscCzatu = {
  role: string
  parts: Array<{ type?: string; text?: string; output?: { taskId?: string | null } }>
}

/** Cały tekst wiadomości, sklejony z części tekstowych. */
export function tekstWiadomosci(m: WiadomoscCzatu): string {
  return (m.parts ?? [])
    .filter(p => p?.type === 'text' && typeof p.text === 'string')
    .map(p => p.text as string)
    .join('')
    .trim()
}

/** Czy w tej rozmowie narzędzie tworzenia zadania w ogóle zostało wywołane. */
export function bylowywolanieNarzedzia(messages: readonly WiadomoscCzatu[]): boolean {
  return messages.some(m =>
    (m.parts ?? []).some(p => typeof p?.type === 'string' && p.type.startsWith('tool-'))
  )
}

/**
 * Czy asystent OBIECAŁ zgłoszenie, którego nie założył.
 *
 * Sprawdzamy dopiero po zakończeniu odpowiedzi (`zajety === false`): w trakcie
 * strumienia zdanie „zgłaszam" bywa początkiem tury, po którym narzędzie
 * dopiero leci, i ostrzeżenie mrugałoby przy każdym udanym zgłoszeniu.
 */
export function asystentObiecalBezZapisu(
  messages: readonly WiadomoscCzatu[],
  zajety: boolean
): boolean {
  if (zajety) return false
  if (bylowywolanieNarzedzia(messages)) return false
  return messages.some(m => m.role === 'assistant' && claimsTaskCreated(tekstWiadomosci(m)))
}

/**
 * Treść do wstawienia w formularz, złożona z tego, co klient już napisał.
 *
 * Bierzemy WYŁĄCZNIE wypowiedzi klienta. Podpowiedzi asystenta bywają właśnie
 * tym, co zawiodło, a poza tym klient ma w formularzu zobaczyć swoje słowa,
 * nie cudze streszczenie.
 */
export function trescDoFormularza(messages: readonly WiadomoscCzatu[]): { nazwa: string; opis: string } {
  const wypowiedzi = messages
    .filter(m => m.role === 'user')
    .map(tekstWiadomosci)
    .filter(Boolean)

  if (wypowiedzi.length === 0) return { nazwa: '', opis: '' }

  // Pierwsze zdanie pierwszej wypowiedzi jako nazwa: tak właśnie klient
  // zaczyna, od tego, czego sprawa dotyczy.
  const pierwsze = wypowiedzi[0]
  const koniecZdania = pierwsze.search(/[.!?\n]/)
  const nazwa = (koniecZdania > 10 ? pierwsze.slice(0, koniecZdania) : pierwsze).trim().slice(0, 200)

  return { nazwa, opis: wypowiedzi.join('\n\n') }
}
