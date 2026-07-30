import { z } from 'zod'

/**
 * Parametry adresu zakładki Historia. Osobny plik, bo korzysta z nich i strona
 * (parsowanie), i pasek filtrów (budowanie linków), a wpisanie tych nazw
 * dwa razy z ręki to gotowy rozjazd.
 *
 * Każde pole ma `.catch()`, tak samo jak w raportach: cokolwiek popsutego w
 * adresie cicho wraca do wartości domyślnej, zamiast zwracać 404. Link z
 * filtrami wysłany klientowi nigdy nie ma umrzeć.
 */
export type HistoryScope = 'wszystkie' | 'otwarte' | 'zamkniete'

export const historySearchSchema = z.object({
  q: z.string().max(200).optional().catch(undefined),
  status: z.string().max(60).optional().catch(undefined),
  priorytet: z.enum(['urgent', 'high', 'normal', 'low']).optional().catch(undefined),
  zakres: z.enum(['wszystkie', 'otwarte', 'zamkniete']).catch('wszystkie'),
  /** Kursor `${dateCreated}_${clickupTaskId}` z poprzedniej strony. */
  kursor: z.string().max(80).optional().catch(undefined),
})

export type HistoryParams = z.infer<typeof historySearchSchema>

/** Pierwsza wartość, gdy Next poda parametr wielokrotnie (`?q=a&q=b`). */
export function firstParam(value: string | string[] | undefined): string | undefined {
  return Array.isArray(value) ? value[0] : value
}

export function parseHistoryParams(raw: Record<string, string | string[] | undefined>): HistoryParams {
  return historySearchSchema.parse({
    q: firstParam(raw.q),
    status: firstParam(raw.status),
    priorytet: firstParam(raw.priorytet),
    zakres: firstParam(raw.zakres),
    kursor: firstParam(raw.kursor),
  })
}

/** Tłumaczy zakres na parę flag zrozumiałą dla queryHistory. */
export function scopeToFilters(scope: HistoryScope): { onlyOpen?: boolean; onlyClosed?: boolean } {
  if (scope === 'otwarte') return { onlyOpen: true }
  if (scope === 'zamkniete') return { onlyClosed: true }
  return {}
}

/** Buduje adres kolejnej strony, zachowując filtry. */
export function nextPageHref(slug: string, params: HistoryParams, cursor: string): string {
  const search = new URLSearchParams()
  if (params.q) search.set('q', params.q)
  if (params.status) search.set('status', params.status)
  if (params.priorytet) search.set('priorytet', params.priorytet)
  if (params.zakres !== 'wszystkie') search.set('zakres', params.zakres)
  search.set('kursor', cursor)
  return `/${slug}/historia?${search.toString()}`
}
