import 'server-only'

/**
 * Szybkość ładowania strony z PageSpeed Insights.
 *
 * DLACZEGO OSOBNE ŹRÓDŁO, a nie czas odpowiedzi z monitora: to są dwie różne
 * liczby i mylenie ich kończy się rozmową, w której klient ma rację. Monitor
 * mierzy, jak szybko serwer odpowiada (u nas rzędu 200-400 ms). PageSpeed
 * mierzy, ile trwa złożenie strony w przeglądarce, razem z obrazkami,
 * skryptami i czcionkami, i potrafi pokazać kilka sekund na tej samej stronie.
 * Kafel „Szybkość" pokazuje to drugie, bo o to pyta człowiek.
 *
 * WYMAGA WŁASNEGO KLUCZA. Bez klucza Google dzieli limit między wszystkich i
 * odpowiada `429` (sprawdzone 28.08). Klucz z AI Studio nie zadziała: ma
 * zablokowaną tę usługę (`403`). Trzeba klucza z projektu Google Cloud
 * z włączonym „PageSpeed Insights API", w `PAGESPEED_API_KEY`.
 *
 * Bez klucza moduł zwraca `null`, a kafel mówi wprost, że pomiaru nie ma.
 * To jest lepsze niż pokazanie czasu odpowiedzi serwera pod nazwą „szybkość
 * ładowania”.
 */

const TIMEOUT_MS = 25_000

export interface SpeedView {
  /** 0-100, wynik wydajności Lighthouse dla telefonu. */
  score: number
  /** Największy element widoczny na ekranie, w milisekundach. */
  lcpMs: number | null
  measuredAt: string
  url: string
}

export function isPagespeedConfigured(): boolean {
  return Boolean(process.env.PAGESPEED_API_KEY)
}

export async function fetchSpeed(url: string): Promise<SpeedView | null> {
  const key = process.env.PAGESPEED_API_KEY
  if (!key) return null

  const kontroler = new AbortController()
  const stoper = setTimeout(() => kontroler.abort(), TIMEOUT_MS)
  try {
    const params = new URLSearchParams({
      url,
      strategy: 'mobile',
      category: 'performance',
      key,
    })
    const res = await fetch(`https://www.googleapis.com/pagespeedonline/v5/runPagespeed?${params}`, {
      signal: kontroler.signal,
      cache: 'no-store',
    })
    if (!res.ok) {
      console.error(`[monitoring] PageSpeed zwrócił ${res.status} dla ${url}`)
      return null
    }
    const data = (await res.json()) as {
      lighthouseResult?: {
        categories?: { performance?: { score?: number } }
        audits?: { 'largest-contentful-paint'?: { numericValue?: number } }
        fetchTime?: string
      }
    }
    const lr = data.lighthouseResult
    const score = lr?.categories?.performance?.score
    if (typeof score !== 'number') return null

    return {
      score: Math.round(score * 100),
      lcpMs: Math.round(lr?.audits?.['largest-contentful-paint']?.numericValue ?? 0) || null,
      measuredAt: lr?.fetchTime ?? new Date().toISOString(),
      url,
    }
  } catch (error) {
    console.error(`[monitoring] PageSpeed nie odpowiedział dla ${url}:`, error)
    return null
  } finally {
    clearTimeout(stoper)
  }
}
