import { and, gte, sql } from 'drizzle-orm'
import { db } from './db'
import { appErrors } from './db/schema'
import { sendOpsAlert } from './cronRuns'
import { wolnoAlarmowac } from './alertThrottle'

/**
 * BŁĄD SERWERA STAJE SIĘ CZYIMŚ PROBLEMEM, a nie linią w logu kontenera.
 *
 * PO CO (14.09). Do dziś wyjątek w trasie klienta kończył się kodem 500 u niego
 * i wpisem w logu, do którego nikt nie zagląda bez powodu. Klient widział, że
 * coś nie działa, my nie widzieliśmy nic. To ten sam układ, który przy
 * zgubionym zgłoszeniu Onyxa kosztował tydzień.
 *
 * Nic tutaj nie ma prawa przewrócić obsługi żądania: to jest ścieżka awaryjna,
 * wołana wtedy, gdy coś już poszło źle.
 */

/** Ile znaków stosu zapisujemy. Pierwsze ramki mówią wszystko, reszta to hałas. */
const MAX_STACK = 4_000

/** Ile znaków komunikatu. Długie komunikaty bywają zrzutem cudzej odpowiedzi. */
const MAX_MESSAGE = 1_000

type Kontekst = {
  path: string
  method: string
  routeType?: string | null
  digest?: string | null
}

/**
 * Ścieżka bez parametrów zapytania.
 *
 * Parametry potrafią nieść dane klienta (token, adres, identyfikator sprawy),
 * a rejestr awarii nie jest miejscem, w którym mają leżeć. Zostaje sama trasa,
 * czyli to, co potrzebne do znalezienia błędu.
 */
export function sciezkaBezZapytania(path: string): string {
  const i = path.indexOf('?')
  return i === -1 ? path : path.slice(0, i)
}

/**
 * Klucz dławienia: ten sam błąd w tej samej trasie to jeden problem.
 *
 * Bierzemy skrót od Next, gdy jest, bo grupuje warianty tego samego wyjątku.
 * Gdy go nie ma, wystarczy trasa i początek komunikatu.
 */
export function kluczBledu(k: Kontekst, message: string): string {
  return k.digest ? `blad:${k.digest}` : `blad:${k.method} ${sciezkaBezZapytania(k.path)}:${message.slice(0, 80)}`
}

/**
 * Zapisuje błąd i, jeśli dławienie pozwala, budzi zespół.
 *
 * Zwraca, czy alarm poszedł — do testów i do kolumny `alerted`, żeby dało się
 * później odpowiedzieć na pytanie „wiedzieliśmy o tym?".
 */
export async function zapiszBladSerwera(
  error: Error & { digest?: string },
  k: Kontekst
): Promise<{ zapisane: boolean; zaalarmowano: boolean }> {
  const message = (error?.message ?? String(error)).slice(0, MAX_MESSAGE)
  const path = sciezkaBezZapytania(k.path)
  const zaalarmowano = wolnoAlarmowac(kluczBledu({ ...k, digest: error?.digest ?? k.digest }, message))

  let zapisane = false
  try {
    await db.insert(appErrors).values({
      path,
      method: k.method,
      routeType: k.routeType ?? null,
      message,
      digest: error?.digest ?? k.digest ?? null,
      stack: error?.stack?.slice(0, MAX_STACK) ?? null,
      alerted: zaalarmowano,
    })
    zapisane = true
  } catch (e) {
    // Padnięta baza to najczęstsza przyczyna serii błędów 5xx, więc zapis
    // MUSI móc się nie udać bez uciszania alarmu.
    console.error('[appErrors] nie udało się zapisać błędu:', e)
  }

  if (zaalarmowano) {
    try {
      await sendOpsAlert(
        [
          '🔥 Błąd serwera w portalu.',
          `${k.method} ${path}${k.routeType ? ` (${k.routeType})` : ''}`,
          message,
          zapisane
            ? 'Zapisany w tabeli `app_errors`. Kolejne takie same przez pół godziny będą ciche.'
            : 'NIE UDAŁO SIĘ GO ZAPISAĆ — sprawdź, czy baza portalu odpowiada.',
        ].join('\n')
      )
    } catch (e) {
      console.error('[appErrors] nie udało się wysłać alarmu:', e)
    }
  }

  return { zapisane, zaalarmowano }
}

/** Ile błędów serwera w ostatniej dobie. Do endpointu zdrowia. */
export async function bledyZDoby(teraz: Date = new Date()): Promise<number> {
  const od = new Date(teraz.getTime() - 24 * 60 * 60 * 1000)
  const [wiersz] = await db
    .select({ ile: sql<number>`count(*)::int` })
    .from(appErrors)
    .where(and(gte(appErrors.createdAt, od)))
  return wiersz?.ile ?? 0
}
