import { z } from 'zod'

/**
 * Macierz powiadomień jednego projektu: które zdarzenie, którym kanałem.
 *
 * Ustawia ją ADMIN w konfiguracji projektu, nie klient w profilu. Kolumny
 * `notify_important` i `notify_board` na użytkowniku zostają w bazie i nadal
 * decydują, czy dana osoba w ogóle chce maila, ale o tym, CZY zdarzenie jest
 * wysyłane, rozstrzyga ta macierz.
 *
 * BRAK KONFIGURACJI ZNACZY CISZĘ. Portal, w którym nikt tego nie ustawił, nie
 * wysyła nic. To jest jednocześnie flaga wdrożenia: nowa funkcja jest domyślnie
 * wyłączona wszędzie i włącza się ją projekt po projekcie, bez osobnej kolumny
 * na przełącznik.
 *
 * SMS-a tu NIE MA celowo. W panelu kolumna jest widoczna i nieaktywna, ale
 * zapis go nie przyjmuje, bo producent go nie obsługuje: klient portalu nie ma
 * dziś nawet numeru telefonu w bazie. Zaznaczona kratka, która nic nie robi,
 * jest gorsza niż kratka wyraźnie wyłączona.
 */

/** Zdarzenia, o których powiadamiamy. Kolejność jest kolejnością w panelu. */
export const NOTIFY_EVENTS = ['comment', 'created', 'status', 'closed'] as const
export type NotifyEvent = (typeof NOTIFY_EVENTS)[number]

/** Kanały, które producent naprawdę obsługuje. */
export const NOTIFY_CHANNELS = ['bell', 'mail'] as const
export type NotifyChannel = (typeof NOTIFY_CHANNELS)[number]

/** Etykiety dla panelu, w jednym miejscu z definicją zdarzeń. */
export const NOTIFY_EVENT_LABELS: Record<NotifyEvent, string> = {
  comment: 'Zespół odpowiedział na zadanie',
  created: 'Nowe zadanie zostało utworzone',
  status: 'Zadanie zmieniło status',
  closed: 'Zadanie zostało zamknięte',
}

export type NotificationConfig = Partial<Record<NotifyEvent, Partial<Record<NotifyChannel, boolean>>>>

/**
 * Schemat zapisu. `catchall` odpada: nieznane zdarzenie albo nieznany kanał są
 * po cichu pomijane, nie wywalają całej konfiguracji. Kolumna w bazie może
 * pochodzić z ręcznej edycji albo ze starszej wersji kodu, a wtedy lepiej
 * stracić jedno ustawienie niż wszystkie.
 */
const channelsSchema = z
  .object({
    bell: z.boolean().optional(),
    mail: z.boolean().optional(),
  })
  .strip()

const configSchema = z
  .object({
    comment: channelsSchema.optional(),
    created: channelsSchema.optional(),
    status: channelsSchema.optional(),
    closed: channelsSchema.optional(),
  })
  .strip()

/**
 * Odczyt kolumny na obiekt do pytania. Wejściem może być cokolwiek: `null`,
 * napis, tablica, obiekt po ręcznej edycji w bazie. Każdy taki przypadek
 * kończy się pustą macierzą, czyli ciszą.
 */
export function parseNotificationConfig(raw: unknown): NotificationConfig {
  const value = typeof raw === 'string' ? safeJson(raw) : raw
  if (typeof value !== 'object' || value === null || Array.isArray(value)) return {}

  const parsed = configSchema.safeParse(value)
  if (!parsed.success) return {}

  // Zostawiamy tylko kratki faktycznie zaznaczone. Dzięki temu `notificationsOff`
  // odpowiada na pytanie „czy cokolwiek jest włączone" bez chodzenia po drzewie.
  const out: NotificationConfig = {}
  for (const event of NOTIFY_EVENTS) {
    const channels = parsed.data[event]
    if (!channels) continue
    const wlaczone: Partial<Record<NotifyChannel, boolean>> = {}
    for (const channel of NOTIFY_CHANNELS) {
      if (channels[channel] === true) wlaczone[channel] = true
    }
    if (Object.keys(wlaczone).length > 0) out[event] = wlaczone
  }
  return out
}

function safeJson(raw: string): unknown {
  try {
    return JSON.parse(raw)
  } catch {
    return null
  }
}

/** Zapis do kolumny. Pusta macierz to `null`, nie `{}`: jeden stan na ciszę. */
export function serializeNotificationConfig(config: NotificationConfig): NotificationConfig | null {
  return Object.keys(config).length > 0 ? config : null
}

export function channelEnabled(
  config: NotificationConfig,
  event: NotifyEvent,
  channel: NotifyChannel
): boolean {
  return config[event]?.[channel] === true
}

/** Czy projekt ma powiadomienia w ogóle wyłączone. Tania brama dla producenta. */
export function notificationsOff(config: NotificationConfig): boolean {
  return Object.keys(config).length === 0
}
