/**
 * Wysyłka SMS przez własną bramkę SMSGate (`sms.important.is`): serwer w
 * Coolify plus telefon firmowy z kartą SIM, który łączy się do niego
 * wychodząco. Jedno miejsce na wysyłkę, tak jak `mailer.ts` dla poczty.
 *
 * Dlaczego portal woła bramkę WPROST, a nie przez n8n: sekrety i tak są już w
 * modelu „zmienna środowiskowa w kontenerze", a każde ogniwo po drodze to
 * kolejne miejsce, w którym alarm może zginąć po cichu.
 *
 * Brak konfiguracji NIE jest błędem: lokalnie zmiennych nie ma, więc `sendSms`
 * zwraca `{ sent: false, reason: 'not-configured' }`. Dzięki temu wciśnięcie
 * alarmu na dev nie budzi nikogo w środku nocy.
 *
 * Uwaga o ścieżce: prywatny serwer ma dodatkowe `/api` względem wszystkich
 * tutoriali dla trybu chmurowego (`/api/3rdparty/v1/...`, nie `/3rdparty/v1/...`).
 */

/** Bramka produkcyjna. Nadpisywalna zmienną SMSGATE_URL (np. na testową). */
const DEFAULT_BASE_URL = 'https://sms.important.is'

/**
 * Twardy limit czasu na odpowiedź bramki. Alarm czeka na tę odpowiedź, a klient
 * czeka na alarm: lepiej zapisać nieudaną próbę, niż trzymać otwarte żądanie,
 * dopóki nie zerwie go proxy.
 */
const SEND_TIMEOUT_MS = 10_000

/**
 * Jeden segment SMS w GSM-7. Powyżej wiadomość jest dzielona, a części
 * potrafią dojść w odwrotnej kolejności, co przy alarmie jest gorsze niż
 * ucięta treść.
 */
const SINGLE_SEGMENT_CHARS = 160

/** Domyślne okno dławika alarmowych SMS-ów, w minutach. */
export const PANIC_SMS_THROTTLE_MINUTES = 10

export type SmsResult =
  | { sent: true; messageId: string; state: string | null }
  | { sent: false; reason: 'not-configured' | 'invalid-number' | 'error'; detail?: string }

export type SmsKind = 'panic'

export function isSmsConfigured(): boolean {
  return Boolean(process.env.SMSGATE_API_USERNAME && process.env.SMSGATE_API_PASSWORD)
}

/**
 * Numer do formatu E.164 (`+48502931807`).
 *
 * Zgadujemy TYLKO jedną rzecz: dziewięć samych cyfr to numer polski. Wszystko
 * inne, czego nie da się jednoznacznie odczytać, jest odrzucane. Zgadywanie
 * przy numerach kończy się SMS-em do przypadkowej osoby, a przy alarmie
 * dodatkowo ciszą u właściwej.
 */
export function normalizePhone(raw: string | null | undefined): string | null {
  if (!raw) return null
  const cleaned = String(raw).trim().replace(/[\s()\-.]/g, '')
  if (!cleaned) return null

  const withPlus = cleaned.startsWith('00') ? `+${cleaned.slice(2)}` : cleaned

  if (withPlus.startsWith('+')) {
    return /^\+[1-9]\d{7,14}$/.test(withPlus) ? withPlus : null
  }
  if (!/^\d+$/.test(withPlus)) return null
  if (withPlus.length === 9) return `+48${withPlus}`
  if (withPlus.length === 11 && withPlus.startsWith('48')) return `+${withPlus}`
  return null
}

/**
 * Lista numerów ze zmiennej środowiskowej (`PANIC_SMS_TO`), po przecinku.
 *
 * Wpisy nie do odczytania są pomijane, a nie wysadzają całej listy: literówka
 * przy jednym numerze nie może uciszyć alarmu dla pozostałych osób.
 * Duplikaty znikają, żeby ta sama osoba nie dostała alarmu dwa razy.
 */
export function parsePhoneList(raw: string | null | undefined): string[] {
  if (!raw) return []
  const numery = raw
    .split(',')
    .map(s => normalizePhone(s))
    .filter((n): n is string => n !== null)
  return [...new Set(numery)]
}

/** Znaki, których NFD nie rozłoży, bo nie są literą z diakrytykiem. */
const HAND_MAPPED: Record<string, string> = { ł: 'l', Ł: 'L', ø: 'o', Ø: 'O', đ: 'd', Đ: 'D' }

/**
 * Tekst do postaci, która zmieści się w GSM-7.
 *
 * Powód jest arytmetyczny, nie estetyczny: JEDEN znak spoza GSM-7 (polski
 * ogonek, emoji, typograficzny cudzysłów) przełącza CAŁĄ wiadomość na UCS-2,
 * gdzie segment ma 70 znaków zamiast 160. Alarm z emoji i polskimi znakami
 * rozpada się na trzy SMS-y, a więcej segmentów to więcej okazji, żeby jeden
 * z nich nie doszedł.
 */
export function toGsmSafe(text: string): string {
  return text
    .replace(/[łŁøØđĐ]/g, c => HAND_MAPPED[c] ?? c)
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    // eslint-disable-next-line no-control-regex
    .replace(/[^\x20-\x7E]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
}

/** Ucina tekst do limitu, zaznaczając cięcie wielokropkiem z trzech kropek. */
function truncate(text: string, max: number): string {
  if (text.length <= max) return text
  if (max <= 3) return text.slice(0, max)
  return `${text.slice(0, max - 3).trimEnd()}...`
}

/**
 * Treść alarmowego SMS-a.
 *
 * SMS jest budzikiem, nie raportem: ma powiedzieć KTÓRY klient, CO się dzieje
 * i KTO to zgłosił, żeby dało się oddzwonić bez otwierania komputera.
 * Świadomie NIE ma tu linku potwierdzającego — składa się z identyfikatora i
 * 64-znakowego tokenu, więc sam zająłby więcej niż cała reszta wiadomości.
 * Link jest w mailu, który idzie w tej samej chwili.
 */
export function buildPanicSmsText(input: {
  portalName: string
  message: string
  who: string
}): string {
  const portal = truncate(toGsmSafe(input.portalName), 40)
  const who = truncate(toGsmSafe(input.who), 30)
  const prefix = `ALARM ${portal}: `
  const suffix = ` | zglasza ${who} | szczegoly w mailu`

  const budget = SINGLE_SEGMENT_CHARS - prefix.length - suffix.length
  const message = truncate(toGsmSafe(input.message), Math.max(budget, 0))

  return `${prefix}${message}${suffix}`.slice(0, SINGLE_SEGMENT_CHARS)
}

/**
 * Czy poprzedni alarm jest na tyle świeży, że kolejnego SMS-a nie wysyłamy.
 *
 * Klient w panice wciska czerwony przycisk kilka razy, a karta w bramce jest
 * abonamentem konsumenckim, nie kanałem masowym. Dławik dotyczy WYŁĄCZNIE
 * SMS-a: mail, Discord i zadanie w ClickUpie lecą przy każdym wciśnięciu.
 */
export function isWithinThrottleWindow(
  previousAt: Date | null | undefined,
  now: Date,
  windowMinutes: number = PANIC_SMS_THROTTLE_MINUTES
): boolean {
  if (!previousAt) return false
  return now.getTime() - previousAt.getTime() < windowMinutes * 60_000
}

export async function sendSms(options: {
  to: string
  text: string
  /** Rodzaj wiadomości, do rejestru. Dziś jest jeden: alarm. */
  kind?: SmsKind
  /** Projekt, którego dotyczy. Null dla wiadomości spoza projektu. */
  portalId?: string | null
}): Promise<SmsResult> {
  const phone = normalizePhone(options.to)
  if (!phone) {
    // Do rejestru idzie SUROWA wartość, bo tylko na niej widać literówkę.
    await logSms({ ...options, recipient: options.to }, false, 'Numer nie do odczytania', null, null)
    return { sent: false, reason: 'invalid-number', detail: 'Numer nie do odczytania' }
  }

  if (!isSmsConfigured()) {
    await logSms({ ...options, recipient: phone }, false, 'Bramka SMS nie jest skonfigurowana', null, null)
    return { sent: false, reason: 'not-configured' }
  }

  const baseUrl = (process.env.SMSGATE_URL ?? DEFAULT_BASE_URL).replace(/\/+$/, '')
  const auth = Buffer.from(
    `${process.env.SMSGATE_API_USERNAME}:${process.env.SMSGATE_API_PASSWORD}`
  ).toString('base64')

  try {
    const res = await fetch(`${baseUrl}/api/3rdparty/v1/messages`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Basic ${auth}`,
      },
      // `textMessage.text` to format API od wersji 1.4x (bramka stoi na 1.46).
      // Starsze poradniki podają płaskie pole `message`, które ten serwer
      // przyjmie i zignoruje, czyli odpowie sukcesem bez wysłania treści.
      body: JSON.stringify({ phoneNumbers: [phone], textMessage: { text: options.text } }),
      signal: AbortSignal.timeout(SEND_TIMEOUT_MS),
    })

    if (!res.ok) {
      const body = await res.text().catch(() => '')
      const detail = `HTTP ${res.status} ${body.slice(0, 200)}`.trim()
      await logSms({ ...options, recipient: phone }, false, detail, null, null)
      return { sent: false, reason: 'error', detail }
    }

    const data = (await res.json().catch(() => null)) as { id?: string; state?: string } | null

    // Bez identyfikatora nie da się później zapytać bramki o stan, a `Failed`
    // jest w niej stanem KOŃCOWYM bez ponawiania. Odpowiedź, której nie da się
    // zweryfikować, jest tu traktowana jak porażka, a nie jak cichy sukces.
    if (!data?.id) {
      const detail = 'Bramka nie zwrocila id wiadomosci'
      await logSms({ ...options, recipient: phone }, false, detail, null, data?.state ?? null)
      return { sent: false, reason: 'error', detail }
    }

    const state = data.state ?? null
    await logSms({ ...options, recipient: phone }, true, null, data.id, state)
    return { sent: true, messageId: data.id, state }
  } catch (e) {
    const detail = e instanceof Error ? e.message : String(e)
    console.error('[sms] wysyłka nieudana:', detail)
    await logSms({ ...options, recipient: phone }, false, detail, null, null)
    return { sent: false, reason: 'error', detail }
  }
}

/**
 * Wysyłka do wielu odbiorców. Osobne wywołanie na numer, nie jedno z listą:
 * chcemy wiedzieć, do KOGO dotarło, a nie tylko, że „coś wyszło".
 * `allSettled`, bo jeden zepsuty numer nie może zablokować pozostałych.
 */
export async function sendSmsToMany(options: {
  to: string[]
  text: string
  kind?: SmsKind
  portalId?: string | null
}): Promise<SmsResult[]> {
  const wyniki = await Promise.allSettled(
    options.to.map(to => sendSms({ to, text: options.text, kind: options.kind, portalId: options.portalId }))
  )
  return wyniki.map(r =>
    r.status === 'fulfilled'
      ? r.value
      : { sent: false as const, reason: 'error' as const, detail: String(r.reason) }
  )
}

/**
 * Zapis do rejestru. NIGDY nie rzuca wyjątkiem i nigdy nie zmienia wyniku
 * wysyłki, tak jak w `mailer.ts`. Logujemy tutaj, a nie u wołających, żeby nie
 * dało się o tym zapomnieć przy dodaniu kolejnego rodzaju wiadomości.
 */
async function logSms(
  options: { recipient: string; text: string; kind?: SmsKind; portalId?: string | null },
  ok: boolean,
  detail: string | null,
  providerMessageId: string | null,
  state: string | null
): Promise<void> {
  try {
    const { db } = await import('./db')
    const { smsLog } = await import('./db/schema')
    await db.insert(smsLog).values({
      portalId: options.portalId ?? null,
      recipient: options.recipient,
      kind: options.kind ?? 'panic',
      text: options.text,
      ok,
      detail,
      providerMessageId,
      state,
    })
  } catch (e) {
    console.error('[sms] nie udało się zapisać SMS-a do rejestru:', e)
  }
}
