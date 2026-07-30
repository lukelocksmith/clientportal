/**
 * Kolor marki i logo projektu. Czysta logika, bez zależności od Next i bazy,
 * sprawdzana skryptem (scripts/check-branding.ts).
 */

/** Fioletowy portalu, używany gdy projekt nie ma własnego koloru. */
export const DEFAULT_BRAND_COLOR = '#6d28d9'

/**
 * Sprowadza kolor do postaci `#rrggbb` albo zwraca null.
 * Przyjmuje `#abc`, `abc`, `#AABBCC`, `aabbcc`.
 *
 * Null jest odpowiedzią prawidłową, nie błędem: wołający ma wtedy użyć
 * DEFAULT_BRAND_COLOR. Kolor wpisany z ręki w panelu admina nie może wysadzić
 * portalu klienta ani, po interpolacji do atrybutu `style`, wstrzyknąć CSS-u,
 * dlatego wpuszczamy WYŁĄCZNIE cyfry szesnastkowe.
 */
export function normalizeHexColor(input: string | null | undefined): string | null {
  if (!input) return null
  const value = input.trim().replace(/^#/, '')
  if (!/^[0-9a-fA-F]{3}$/.test(value) && !/^[0-9a-fA-F]{6}$/.test(value)) return null
  const full =
    value.length === 3
      ? value.split('').map(ch => ch + ch).join('')
      : value
  return `#${full.toLowerCase()}`
}

/** Względna luminancja wg WCAG 2.1, potrzebna do wyboru czytelnego tekstu. */
function relativeLuminance(hex: string): number {
  const channels = [1, 3, 5].map(i => parseInt(hex.slice(i, i + 2), 16) / 255)
  const [r, g, b] = channels.map(c => (c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4))
  return 0.2126 * r + 0.7152 * g + 0.0722 * b
}

/**
 * Czytelny kolor tekstu na tle danego koloru marki.
 *
 * To nie jest ozdoba, to warunek użyteczności. Brandy klientów bywają jasne
 * (żółty, limonka, cyjan) i biały tekst na takim tle jest nieczytelny.
 * Zamiast zgadywać po jasności składowych, liczymy kontrast wg WCAG wobec
 * czerni i wobec bieli i wybieramy lepszy.
 */
export function readableForeground(hex: string): string {
  const luminance = relativeLuminance(hex)
  const contrastWithWhite = 1.05 / (luminance + 0.05)
  const contrastWithBlack = (luminance + 0.05) / 0.05
  return contrastWithWhite >= contrastWithBlack ? '#ffffff' : '#111111'
}

/**
 * Czy adres logo wolno wstawić do `src`.
 *
 * Wpuszczamy https, http i wbudowane obrazki `data:image/...`. Reszta odpada,
 * w szczególności `javascript:` — dzisiejsze przeglądarki nie wykonają go w
 * atrybucie `src` obrazka, ale to wartość wpisywana w panelu i renderowana na
 * stronie klienta, więc filtrujemy po schemacie, a nie po wierze w przeglądarkę.
 */
export function isSafeLogoUrl(url: string | null | undefined): boolean {
  if (!url) return false
  const value = url.trim()
  if (value.length === 0) return false
  if (/^data:image\/(png|jpeg|jpg|gif|webp|svg\+xml);base64,[a-zA-Z0-9+/=]+$/.test(value)) return true
  try {
    const parsed = new URL(value)
    return parsed.protocol === 'https:' || parsed.protocol === 'http:'
  } catch {
    return false
  }
}

export type PortalBranding = {
  /** Zawsze poprawny `#rrggbb`. */
  brandColor: string
  /** Czytelny tekst na tle brandColor. */
  brandForeground: string
  /** Adres logo albo null, gdy brak lub niebezpieczny. */
  logoUrl: string | null
}

/** Składa gotowe do renderowania wartości z tego, co jest w bazie. */
export function resolveBranding(portal: {
  brandColor?: string | null
  logoUrl?: string | null
}): PortalBranding {
  const brandColor = normalizeHexColor(portal.brandColor) ?? DEFAULT_BRAND_COLOR
  return {
    brandColor,
    brandForeground: readableForeground(brandColor),
    logoUrl: isSafeLogoUrl(portal.logoUrl) ? portal.logoUrl!.trim() : null,
  }
}
