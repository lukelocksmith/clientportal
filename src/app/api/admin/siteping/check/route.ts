import { NextRequest, NextResponse } from 'next/server'
import { and, desc, eq, like } from 'drizzle-orm'
import { isAdminRequest } from '@/lib/admin-auth'
import { db } from '@/lib/db'
import { auditLog } from '@/lib/db/schema'
import { requireAdminPortal } from '@/lib/adminPortal'
import { EVENT_TASK_CREATED } from '@/lib/portalEvents'
import { getSpaceTags } from '@/lib/clickup'
import {
  missingTags,
  detectWidget,
  parseSiteDomains,
  checkUrl,
  isAllowedRedirect,
  widgetVerdict,
  describeFetchError,
  MAX_REDIRECTS,
  FETCH_TIMEOUT_MS,
  type CheckRow,
} from '@/lib/siteping/check'

/**
 * Test połączenia SitePinga: „czy u tego klienta to w ogóle działa".
 *
 * NA PRZYCISK, nie automatycznie przy otwarciu panelu. Sprawdzenie wychodzi na
 * zewnątrz — do ClickUpa i na stronę klienta — więc uruchamianie go przy każdym
 * wejściu w zakładkę generowałoby ruch na cudze serwery bez powodu i spowalniało
 * panel.
 *
 * JEDNO NIEUDANE SPRAWDZENIE NIE PRZERYWA POZOSTAŁYCH. Każde jest opakowane
 * osobno, a odpowiedź jest zawsze kompletna: niedostępny ClickUp nie może
 * ukryć informacji o tym, że domeny są puste.
 *
 * Cała logika oceny siedzi w `lib/siteping/check.ts` (czysty moduł); tutaj
 * zostaje wyłącznie chodzenie po świecie.
 */

/** Nasza wizytówka w logach klienta: żądanie ma dać się rozpoznać. */
const USER_AGENT = 'important.is-portal/siteping-check'

/** Górna granica czytanej treści. Nagłówek jest na początku, reszta to balast. */
const MAX_HTML_BYTES = 1_000_000

export async function GET(request: NextRequest) {
  if (!(await isAdminRequest(request))) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  const slug = request.nextUrl.searchParams.get('slug')
  if (!slug) return NextResponse.json({ error: 'Podaj slug' }, { status: 400 })

  const gate = await requireAdminPortal(slug)
  if (!gate.ok) return gate.response
  const portal = gate.portal

  const domeny = parseSiteDomains(portal.siteDomains)

  const rows: CheckRow[] = [
    {
      key: 'flaga',
      label: 'Funkcja włączona',
      state: portal.sitepingEnabled ? 'ok' : 'fail',
      detail: portal.sitepingEnabled
        ? 'zgłoszenia ze strony klienta są włączone'
        : 'przełącznik jest wyłączony, endpoint odrzuca wszystko',
    },
    {
      key: 'domeny',
      label: 'Domeny ustawione',
      state: domeny.length > 0 ? 'ok' : 'fail',
      detail:
        domeny.length > 0
          ? domeny.join(', ')
          : 'pusta lista — endpoint jest zamknięty niezależnie od przełącznika',
    },
    await sprawdzTagi(portal.clickupSpaceId),
    ...(await sprawdzWidget(portal.id, domeny)),
  ]

  return NextResponse.json({ rows })
}

/**
 * Czy w przestrzeni klienta istnieją tagi, których używa store.
 *
 * Błąd ClickUpa daje `unknown`, nie `fail`: „nie udało się zapytać" i „tagów
 * nie ma" to dwie różne odpowiedzi, a tylko druga wymaga pracy.
 */
async function sprawdzTagi(spaceId: string): Promise<CheckRow> {
  const wiersz = { key: 'tagi', label: 'Tagi w ClickUpie' }
  try {
    const brakuje = missingTags(await getSpaceTags(spaceId))
    return brakuje.length === 0
      ? { ...wiersz, state: 'ok', detail: 'wszystkie wymagane tagi istnieją w przestrzeni' }
      : {
          ...wiersz,
          state: 'fail',
          detail: `brakuje: ${brakuje.join(', ')} — ClickUp pominie je po cichu, zadanie powstanie bez oznaczenia`,
        }
  } catch (error) {
    return {
      ...wiersz,
      state: 'unknown',
      detail: `nie udało się odpytać ClickUpa (${describeFetchError(error)})`,
    }
  }
}

/**
 * Widget na stronie — osobny wiersz DLA KAŻDEJ domeny.
 *
 * Nie tylko dla pierwszej: projekt ma zwykle produkcję i staging, a widget
 * osadzony na jednej, brakujący na drugiej to typowy stan po wdrożeniu
 * i dokładnie to, co ten test ma wyłapywać.
 */
async function sprawdzWidget(portalId: string, domeny: string[]): Promise<CheckRow[]> {
  if (domeny.length === 0) return []

  const ostatnie = await ostatnieZgloszenie(portalId)

  return Promise.all(
    domeny.map(async (domena): Promise<CheckRow> => {
      const wynik = await pobierzStrone(domena, domeny)
      const { state, detail } = widgetVerdict({
        htmlHasWidget: wynik.html === null ? null : detectWidget(wynik.html),
        lastFeedbackAt: ostatnie,
        fetchError: wynik.error,
      })
      return { key: `widget:${domena}`, label: `Widget na ${domena}`, state, detail }
    })
  )
}

/**
 * Kiedy z tego portalu przyszło ostatnie zgłoszenie z widgetu.
 *
 * Drugi sygnał obok pobrania HTML. `audit_log` trzyma `meta` jako tekst JSON,
 * stąd dopasowanie wzorcem zamiast operatora po polu — kolumna jest `text`,
 * nie `jsonb`, a przerabianie jej tylko dla tego zapytania byłoby migracją
 * całej tabeli dla jednej diagnostyki.
 *
 * Błąd bazy zwraca `null`, czyli „nie było zgłoszeń". Wynik jest wtedy co
 * najwyżej ostrożniejszy, a nie fałszywie zielony.
 */
async function ostatnieZgloszenie(portalId: string): Promise<Date | null> {
  try {
    const [wiersz] = await db
      .select({ createdAt: auditLog.createdAt })
      .from(auditLog)
      .where(
        and(
          eq(auditLog.portalId, portalId),
          eq(auditLog.action, EVENT_TASK_CREATED),
          like(auditLog.meta, '%"source":"siteping"%')
        )
      )
      .orderBy(desc(auditLog.createdAt))
      .limit(1)
    return wiersz?.createdAt ?? null
  } catch (error) {
    console.error('[siteping/check] nie udało się odczytać historii zgłoszeń:', error)
    return null
  }
}

/**
 * Pobranie strony klienta, z ręczną obsługą przekierowań.
 *
 * `redirect: 'manual'` zamiast `'follow'`, bo przekierowanie trzeba sprawdzić
 * PRZED pójściem za nim: to jedyny moment, w którym da się nie wyjść poza listę
 * domen z panelu. `'follow'` wykonałoby żądanie na obcy host, zanim mielibyśmy
 * cokolwiek do sprawdzenia.
 *
 * Przeskok http → https i dopisanie `www.` są typowe, więc pętla jest tu
 * konieczna — pojedyncze żądanie kończyłoby się `unknown` na większości stron.
 */
async function pobierzStrone(
  domena: string,
  dozwolone: string[]
): Promise<{ html: string | null; error: string | null }> {
  let url = checkUrl(domena)

  for (let skok = 0; skok <= MAX_REDIRECTS; skok++) {
    let res: Response
    try {
      res = await fetch(url, {
        redirect: 'manual',
        signal: AbortSignal.timeout(FETCH_TIMEOUT_MS),
        headers: { 'User-Agent': USER_AGENT, Accept: 'text/html' },
      })
    } catch (error) {
      return { html: null, error: describeFetchError(error) }
    }

    if (res.status >= 300 && res.status < 400) {
      const location = res.headers.get('location')
      if (!location) return { html: null, error: `przekierowanie ${res.status} bez adresu` }

      // Adres względny (`/pl/`) rozwijamy względem bieżącego, inaczej odpadłby
      // jako „poza allowlistą" mimo że nie opuszcza domeny.
      let nastepny: string
      try {
        nastepny = new URL(location, url).toString()
      } catch {
        return { html: null, error: 'przekierowanie pod nieczytelny adres' }
      }

      if (!isAllowedRedirect(nastepny, dozwolone)) {
        return {
          html: null,
          error: `przekierowanie poza listę domen (${new URL(nastepny).hostname})`,
        }
      }
      url = nastepny
      continue
    }

    if (!res.ok) return { html: null, error: `odpowiedź ${res.status}` }

    try {
      return { html: await czytajZLimitem(res), error: null }
    } catch (error) {
      return { html: null, error: describeFetchError(error) }
    }
  }

  return { html: null, error: 'za dużo przekierowań' }
}

/**
 * Treść odpowiedzi obcięta do `MAX_HTML_BYTES`.
 *
 * Osadzenie widgetu jest w `<head>` albo tuż przed `</body>`; przy stronie
 * z dużym HTML-em wciąganie całości do pamięci serwera portalu byłoby kosztem
 * bez zysku. Obcięcie może teoretycznie uciąć skrypt na samym końcu bardzo
 * dużej strony — wynikiem jest wtedy `unknown` albo `fail` z historią zgłoszeń,
 * czyli stan, który i tak każe sprawdzić ręcznie.
 */
async function czytajZLimitem(res: Response): Promise<string> {
  const reader = res.body?.getReader()
  if (!reader) return res.text()

  const kawalki: Uint8Array[] = []
  let razem = 0
  while (razem < MAX_HTML_BYTES) {
    const { done, value } = await reader.read()
    if (done) break
    kawalki.push(value)
    razem += value.length
  }
  await reader.cancel().catch(() => {})

  // Jedna alokacja na koniec zamiast sklejania w pętli: sklejanie kopiowałoby
  // narastający bufor przy każdym kawałku, czyli kwadratowo względem rozmiaru.
  const calosc = new Uint8Array(razem)
  let pozycja = 0
  for (const k of kawalki) {
    calosc.set(k, pozycja)
    pozycja += k.length
  }
  return new TextDecoder().decode(calosc)
}

