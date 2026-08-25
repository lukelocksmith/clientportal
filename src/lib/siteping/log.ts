import { lt } from 'drizzle-orm'
import { db } from '@/lib/db'
import { sitepingLog } from '@/lib/db/schema'
import { checkRateLimit } from './rateLimit'

/**
 * Log diagnostyczny SitePinga.
 *
 * Powod istnienia: gdy klient mowi „zgloszenia nie dochodza", dzis nie ma
 * czego obejrzec. Odrzucony `Origin` i przekroczony limit koncza sie w trasie
 * `return`-em bez sladu, a udane zgloszenie widac dopiero w ClickUpie, wiec
 * pytanie „czy w ogole doszlo do nas zadanie" nie mialo odpowiedzi poza
 * wejsciem po SSH w logi kontenera.
 *
 * ZAPIS JEST BEST-EFFORT. Awaria logowania NIE MOZE zablokowac przyjecia
 * zgloszenia od klienta: log jest po to, zeby diagnozowac usluge, a nie po to,
 * zeby stac sie kolejnym powodem jej awarii. Stad `try/catch` wokol calosci
 * i blad wylacznie do konsoli.
 */

export type SitepingOutcome =
  | 'ok'
  | 'origin_not_allowed'
  | 'rate_limited'
  | 'invalid_payload'
  | 'misconfigured'
  | 'error'

/** Ile znakow `Origin` i `detail` trafia do bazy. Oba przychodza z zewnatrz. */
const MAX_ORIGIN = 200
const MAX_DETAIL = 500

/**
 * Ile wierszy na minute z jednego (projekt, prefiks IP, metoda, wynik).
 *
 * Endpoint jest PUBLICZNY i odmowy nic nie kosztuja nadawce: zadanie z obcej domeny
 * odbija sie od bramy przed limitem czestotliwosci, wiec bot walacy tysiac
 * razy na sekunde wstawialby tysiac wierszy na sekunde. Bez tego zapora
 * chroniaca ClickUpa bylaby jednoczesnie droga do zapisu w naszej bazie.
 *
 * Wartosc rowna budzetowi POST-ow (10/min): uczciwy ruch miesci sie w calosci,
 * bo zostal juz wczesniej przyciety tym samym progiem, a przycinane jest
 * wylacznie to, co i tak zostalo odrzucone.
 */
const MAX_ROWS_PER_MINUTE = 10

/**
 * Adres IP skrocony do prefiksu — albo null, gdy nie da sie go rozpoznac.
 *
 * Skracamy, a nie hashujemy: prefiks ma byc CZYTELNY przy diagnozie („to ten
 * sam operator co wczoraj"), a hash odpowiadalby tylko na pytanie o rownosc,
 * bedac przy tym dalej danymi osobowymi w rozumieniu praktycznym.
 *
 * Wszystko, co nie wyglada na adres, daje null: naglowek `x-forwarded-for`
 * jest sterowany przez nadawce i nie moze wstawiac dowolnego tekstu do bazy.
 */
export function shortenIp(raw: string | null | undefined): string | null {
  const value = raw?.trim()
  if (!value || value === 'unknown') return null

  // IPv6 ma wiecej niz jeden dwukropek; przy jednym to IPv4 z portem.
  const ipv6 = value.split(':').length > 2
  if (ipv6) {
    const grupy = value.split(':').slice(0, 3)
    return grupy.every(g => /^[0-9a-fA-F]{0,4}$/.test(g)) ? grupy.join(':') : null
  }

  const oktety = value.split(':')[0].split('.')
  if (oktety.length !== 4) return null
  if (!oktety.every(o => /^\d{1,3}$/.test(o) && Number(o) <= 255)) return null
  return oktety.slice(0, 3).join('.')
}

/**
 * Nazwa wyniku dla kodu odpowiedzi.
 *
 * Kod nieprzewidziany daje `error`, a nie najblizsza pasujaca etykiete: log ma
 * powiedziec „cos jest nie tak, obejrzyj", a nie zgadywac co.
 */
export function outcomeForStatus(status: number): SitepingOutcome {
  if (status < 400) return 'ok'
  switch (status) {
    case 400:
      return 'invalid_payload'
    case 403:
      return 'origin_not_allowed'
    case 404:
      return 'misconfigured'
    case 429:
      return 'rate_limited'
    default:
      return 'error'
  }
}

/** Wartosc gotowa do kolumny tekstowej: przycieta i bez pustych napisow. */
export function trimForLog(value: string | null | undefined, max: number): string | null {
  const v = value?.trim()
  if (!v) return null
  return v.length > max ? v.slice(0, max) : v
}

export interface SitepingLogEntry {
  portalId: string
  method: string
  status: number
  outcome: SitepingOutcome
  /** Surowy naglowek `Origin` (albo `Referer`, gdy `Origin` nie przyszedl). */
  origin?: string | null
  /** PELNY adres IP — skrocenie robi ta funkcja, nie wolajacy. */
  ip?: string | null
  durationMs?: number
  clickupTaskId?: string | null
  detail?: string | null
}

export async function logSitepingRequest(entry: SitepingLogEntry): Promise<void> {
  try {
    const ipPrefix = shortenIp(entry.ip)
    const klucz = `siteping-log:${entry.portalId}:${ipPrefix ?? 'brak'}:${entry.method}:${entry.outcome}`
    if (!checkRateLimit(klucz, { max: MAX_ROWS_PER_MINUTE, windowMs: 60_000 })) return

    await db.insert(sitepingLog).values({
      portalId: entry.portalId,
      method: entry.method,
      status: entry.status,
      outcome: entry.outcome,
      origin: trimForLog(entry.origin, MAX_ORIGIN),
      ipPrefix,
      durationMs: entry.durationMs ?? null,
      clickupTaskId: entry.clickupTaskId ?? null,
      detail: trimForLog(entry.detail, MAX_DETAIL),
    })
  } catch (error) {
    // Swiadomie w gore NIE leci nic: zgloszenie klienta jest wazniejsze niz
    // wpis o nim.
    console.error('[siteping] nie udało się zapisać wpisu do logu diagnostycznego:', error)
  }
}

/**
 * Retencja: kasuje wpisy starsze niz `days`.
 *
 * 30 dni, bo log odpowiada na pytanie „czemu TERAZ nie dziala". Starsze wiersze
 * niosa dane z cudzych stron (adresy, prefiksy IP) i nie sluza juz niczemu.
 *
 * Wolane z `GET /api/cron/task-index` — jedynego dziennego przebiegu, jaki mamy.
 * Osobny wpis w crontabie na serwerze to kolejna rzecz do pamietania przy
 * odtwarzaniu maszyny, a kasowanie starych wierszy nie potrzebuje wlasnego
 * harmonogramu.
 */
export async function purgeOldSitepingLog(days = 30): Promise<number> {
  const cutoff = new Date(Date.now() - days * 24 * 60 * 60 * 1000)
  const gone = await db
    .delete(sitepingLog)
    .where(lt(sitepingLog.createdAt, cutoff))
    .returning({ id: sitepingLog.id })
  return gone.length
}
