/**
 * Budowa opisu zadania ClickUp z danych SitePing, i odczyt z powrotem.
 *
 * Czysty modul: bez ClickUp, bez bazy, bez sieci. ClickUp jest jedynym
 * miejscem przechowywania — ten modul tylko koduje/dekoduje to, co trzeba
 * odnalezc bez dociagania zalacznika (clientId do dedupu, url do filtrowania
 * getFeedbacks), zeby findByClientId/getFeedbacks dzialaly na tym, co juz
 * zwraca lista zadan, bez zadania per-task fetcha.
 */

interface AnnotationLike {
  cssSelector: string
  xpath: string
  textSnippet: string
  elementTag: string
  elementId?: string | null
  textPrefix: string
  textSuffix: string
  fingerprint: string
  neighborText: string
  anchorKey?: string | null
  xPct: number
  yPct: number
  wPct: number
  hPct: number
  scrollX: number
  scrollY: number
  viewportW: number
  viewportH: number
  devicePixelRatio: number
}

const CLIENT_ID_MARKER = /<!--\s*siteping-client-id:([a-zA-Z0-9_-]+)\s*-->/
const URL_MARKER = /<!--\s*siteping-url:([^\s]+)\s*-->/

export function embedClientIdMarker(clientId: string): string {
  return `<!-- siteping-client-id:${clientId} -->`
}

export function extractClientIdFromDescription(description: string | null): string | null {
  if (!description) return null
  const match = description.match(CLIENT_ID_MARKER)
  return match ? match[1] : null
}

export function embedUrlMarker(url: string): string {
  return `<!-- siteping-url:${encodeURIComponent(url)} -->`
}

export function extractUrlFromDescription(description: string | null): string | null {
  if (!description) return null
  const match = description.match(URL_MARKER)
  return match ? decodeURIComponent(match[1]) : null
}

export function buildFeedbackDescription(input: {
  clientId: string
  url: string
  message: string
  annotation: AnnotationLike | null
}): string {
  const lines = [
    embedClientIdMarker(input.clientId),
    embedUrlMarker(input.url),
    '',
    `**Strona:** ${input.url}`,
  ]

  if (input.annotation) {
    const a = input.annotation
    const tag = a.elementTag.toLowerCase()
    lines.push(
      `**Element:** \`${tag}${a.elementId ? '#' + a.elementId : ''}\``,
      `**Selektor CSS:** \`${a.cssSelector}\``,
      `**XPath:** \`${a.xpath}\``,
      `**Pozycja na elemencie:** ${Math.round(a.xPct * 100)}%, ${Math.round(a.yPct * 100)}% ` +
        `(zaznaczenie ${Math.round(a.wPct * 100)}%×${Math.round(a.hPct * 100)}%)`
    )
    if (a.textSnippet) lines.push(`**Tekst elementu:** "${a.textSnippet}"`)
  }

  lines.push('', input.message.trim())

  return lines.join('\n')
}

export function buildFeedbackTitle(message: string): string {
  const trimmed = message.trim()
  if (!trimmed) return 'Zgłoszenie ze strony'
  return trimmed.length > 80 ? `${trimmed.slice(0, 77)}...` : trimmed
}
