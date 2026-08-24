import type { NotifyEvent } from './notifyConfig'

/**
 * Treść powiadomienia: jedna linia do dzwonka i tekst maila.
 *
 * Czyste funkcje, bez bazy i bez poczty, bo to jest tekst, który wychodzi do
 * klienta, a najtaniej sprawdzić go testem.
 *
 * ZASADA: powiadomienie NIE ZASTĘPUJE TREŚCI. Mail mówi, że jest odpowiedź, i
 * daje link do zadania. Nie wkleja komentarza, bo poczta idzie przez cudze
 * serwery i bywa przekazywana dalej, a korespondencja z klientem ma zostać w
 * portalu, za logowaniem. Dzwonek pokazuje krótki wycinek, bo tam treść nie
 * opuszcza portalu.
 */

export type NotifyTextInput = {
  event: NotifyEvent
  taskName: string
  portalName: string
  taskUrl: string
  author?: string | null
  excerpt?: string | null
  fromStatus?: string | null
  toStatus?: string | null
}

/** Wycinek do dzwonka: jedna linia, więc twardy limit i znak urwania. */
const EXCERPT_LIMIT = 160

function shorten(text: string): string {
  const czysty = text.replace(/\s+/g, ' ').trim()
  return czysty.length <= EXCERPT_LIMIT ? czysty : `${czysty.slice(0, EXCERPT_LIMIT - 1).trimEnd()}…`
}

/**
 * Zawartość kolumny `payload`. Dzwonek renderuje z niej opis zdarzenia, więc
 * kształt musi odpowiadać temu, czego szuka `NotificationBell`:
 * `{ author, excerpt }` dla odpowiedzi i `{ from, to }` dla statusu.
 *
 * Pola bez wartości NIE WCHODZĄ do obiektu. `{ from: undefined }` zapisuje się
 * w jsonb jako brak klucza i tak, ale w logach i testach wygląda jak dane,
 * których nie ma.
 */
export function bellPayload(input: NotifyTextInput): Record<string, unknown> {
  const payload: Record<string, unknown> = {}

  if (input.event === 'comment') {
    if (input.author) payload.author = input.author
    if (input.excerpt?.trim()) payload.excerpt = shorten(input.excerpt)
    return payload
  }

  if (input.event === 'status') {
    if (input.fromStatus) payload.from = input.fromStatus
    if (input.toStatus) payload.to = input.toStatus
    return payload
  }

  return payload
}

export type MailText = {
  subject: string
  preview: string
  greeting: string
  paragraphs: string[]
  buttonLabel: string
  buttonUrl: string
  notes: string[]
}

export function mailText(input: NotifyTextInput): MailText {
  const wspolne = {
    greeting: 'Dzień dobry,',
    buttonLabel: 'Otwórz zadanie',
    buttonUrl: input.taskUrl,
    notes: [
      'Ten mail wysłał portal klienta important.is. Powiadomienia dla tego projektu ustawia Twój opiekun.',
    ],
  }

  switch (input.event) {
    case 'comment': {
      const kto = input.author?.trim() ? input.author.trim() : 'Zespół'
      return {
        ...wspolne,
        subject: `Nowa odpowiedź: ${input.taskName}`,
        preview: `${kto} odpowiedział w zadaniu ${input.taskName}`,
        paragraphs: [
          `${kto} odpowiedział na Twoje zgłoszenie „${input.taskName}” w projekcie ${input.portalName}.`,
          'Treść odpowiedzi jest w portalu, razem z całą historią tej sprawy.',
        ],
      }
    }

    case 'created':
      return {
        ...wspolne,
        subject: `Nowe zadanie: ${input.taskName}`,
        preview: `W projekcie ${input.portalName} pojawiło się nowe zadanie`,
        paragraphs: [
          `W projekcie ${input.portalName} pojawiło się nowe zadanie „${input.taskName}”.`,
          'Szczegóły i postęp prac widzisz w portalu.',
        ],
      }

    case 'closed':
      return {
        ...wspolne,
        subject: `Sprawa zamknięta: ${input.taskName}`,
        preview: `Zadanie ${input.taskName} zostało zamknięte`,
        paragraphs: [
          `Zadanie „${input.taskName}” w projekcie ${input.portalName} zostało zamknięte.`,
          'Jeśli sprawa nie jest dla Ciebie skończona, odpisz w portalu, a wrócimy do niej.',
        ],
      }

    case 'status': {
      // Statusu może nie być w zdarzeniu (ClickUp nie zawsze go niesie), więc
      // zdanie musi działać także bez niego, zamiast zostawiać dziurę.
      const zmiana =
        input.fromStatus && input.toStatus
          ? `Status zmienił się z „${input.fromStatus}” na „${input.toStatus}”.`
          : input.toStatus
            ? `Nowy status: „${input.toStatus}”.`
            : 'Status tego zadania się zmienił.'
      return {
        ...wspolne,
        subject: `Zmiana statusu: ${input.taskName}`,
        preview: `Zadanie ${input.taskName} zmieniło status`,
        paragraphs: [`Zadanie „${input.taskName}” w projekcie ${input.portalName}. ${zmiana}`],
      }
    }
  }
}
