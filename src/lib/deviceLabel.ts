/**
 * Skrót User-Agenta do postaci czytelnej dla człowieka: „Chrome, iPhone".
 *
 * Wyjęte z komponentu okna historii, bo to czysta funkcja na wyrażeniach
 * regularnych, czyli dokładnie ten rodzaj kodu, który psuje się cicho. Zła
 * kolejność dopasowań pokazuje każdą przeglądarkę jako Safari i nikt tego nie
 * zauważy, bo napis wygląda sensownie.
 *
 * Świadomie NIE jest to pełna biblioteka rozpoznająca przeglądarki. Jedyne
 * pytanie, na które ma odpowiadać, brzmi „czy to jest to samo urządzenie, co
 * poprzednio", więc nie potrzebujemy wersji ani rozróżniania botów.
 */

/**
 * Kolejność ma znaczenie i jest odwrotna do intuicji.
 *
 * Chrome na macOS wysyła `... Chrome/141 Safari/537.36`, a Edge wysyła
 * `... Chrome/141 Safari/537.36 Edg/141`. Czyli każda z nich zawiera napis
 * „Safari", a Edge zawiera też „Chrome". Sprawdzamy więc od najbardziej
 * szczegółowej: Edge, potem Chrome, a Safari na końcu, jako to, co zostało.
 */
const BROWSERS: ReadonlyArray<[RegExp, string]> = [
  [/\bEdg[A-Z]?\//, 'Edge'],
  [/\bOPR\//, 'Opera'],
  [/\bFirefox\//, 'Firefox'],
  [/\bChrome\//, 'Chrome'],
  [/\bSafari\//, 'Safari'],
]

const SYSTEMS: ReadonlyArray<[RegExp, string]> = [
  [/\biPhone\b/, 'iPhone'],
  [/\biPad\b/, 'iPad'],
  [/\bAndroid\b/, 'Android'],
  [/\bMacintosh\b|\bMac OS X\b/, 'Mac'],
  [/\bWindows\b/, 'Windows'],
  [/\bLinux\b/, 'Linux'],
]

export function deviceLabel(userAgent: string | null | undefined): string {
  if (!userAgent || userAgent.trim().length === 0) return 'nieznane urządzenie'

  const browser = BROWSERS.find(([re]) => re.test(userAgent))?.[1] ?? null
  const system = SYSTEMS.find(([re]) => re.test(userAgent))?.[1] ?? null

  if (browser && system) return `${browser}, ${system}`
  if (browser) return browser
  if (system) return system

  /**
   * Nic nie rozpoznaliśmy. Zwracamy PRZYCIĘTY początek nagłówka, a nie napis
   * „nieznane": przy wejściu z narzędzia (curl, skrypt, monitoring) właśnie ta
   * surowa wartość jest odpowiedzią na pytanie, kto to był. Przycinamy, bo
   * pełny User-Agent rozwaliłby układ wiersza w tabeli.
   */
  const skrot = userAgent.trim().slice(0, 40)
  return skrot.length < userAgent.trim().length ? `${skrot}…` : skrot
}
