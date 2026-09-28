import { computeVisibleIds, hasPortalTag } from './portalVisibility'

/**
 * Plan kroku 1 wdrożenia tagu `portal`: które zadania otagować, żeby po
 * włączeniu `portalTagOnly` klient widział to samo co dziś, minus zadania
 * wewnętrzne. CZYSTA funkcja, wykonanie jest w scripts/otaguj-zadania-portal.ts.
 *
 * Tagujemy wyłącznie KORZENIE (zadania bez rodzica w zbiorze). Podzadania
 * dziedziczą widoczność (lib/portalVisibility.ts), więc tagowanie ich byłoby
 * setkami zbędnych wywołań ClickUpa i szumem w ClickUpie.
 *
 * Z tego samego powodu wykluczenie PODZADANIA pod korzeniem, który będzie
 * otagowany, NIE DZIAŁA: odziedziczy widoczność po rodzicu. Plan zgłasza to
 * jako konflikt, zamiast udawać, że je ukrył. Takie podzadanie trzeba
 * przenieść, albo nie tagować rodzica.
 */
export type TaggingTask = {
  id: string
  name: string
  parent: string | null
  tags?: ReadonlyArray<{ name?: string | null }> | null
}

export type TaggingPlan = {
  /** Korzenie bez tagu, do otagowania. */
  toTag: TaggingTask[]
  /** Korzenie, które już mają tag `portal`. */
  alreadyTagged: TaggingTask[]
  /** Wykluczone korzenie: zostaną ukryte razem z nieoznaczonymi podzadaniami. */
  excluded: TaggingTask[]
  /** Wykluczone zadania, które i tak będą widoczne, bo przodek jest/będzie otagowany. */
  conflicts: Array<{ task: TaggingTask; visibleVia: string }>
  /** Wykluczenia wskazujące zadania spoza zbioru (literówka albo inny portal). */
  unknownExclusions: string[]
  /** Ile zadań (z podzadaniami) klient zobaczy po włączeniu flagi. */
  visibleAfter: number
  /** Ile zadań widzi dziś. */
  visibleToday: number
}

export function planPortalTagging(
  tasks: readonly TaggingTask[],
  excludedIds: ReadonlySet<string>
): TaggingPlan {
  const ids = new Set(tasks.map(t => t.id))
  const isRoot = (t: TaggingTask) => !t.parent || !ids.has(t.parent)

  const toTag: TaggingTask[] = []
  const alreadyTagged: TaggingTask[] = []
  const excluded: TaggingTask[] = []

  for (const t of tasks) {
    if (!isRoot(t)) continue
    if (excludedIds.has(t.id)) {
      // Wykluczony korzeń Z tagiem: tag trzeba zdjąć ręcznie, skrypt tagów
      // nie zdejmuje. Zgłaszamy to niżej jako konflikt.
      excluded.push(t)
      continue
    }
    if (hasPortalTag(t)) alreadyTagged.push(t)
    else toTag.push(t)
  }

  const willHaveTag = new Set([...toTag, ...alreadyTagged].map(t => t.id))
  const nodes = tasks.map(t => ({
    id: t.id,
    parentId: t.parent && ids.has(t.parent) ? t.parent : null,
    hasTag: willHaveTag.has(t.id) || hasPortalTag(t),
  }))
  const visible = computeVisibleIds(nodes)

  const byId = new Map(tasks.map(t => [t.id, t]))
  const conflicts: TaggingPlan['conflicts'] = []
  for (const id of excludedIds) {
    const task = byId.get(id)
    if (!task || !visible.has(id)) continue
    // Szukamy najbliższego przodka (albo samego zadania), który ma tag.
    let via: TaggingTask | undefined = task
    while (via && !(willHaveTag.has(via.id) || hasPortalTag(via))) {
      via = via.parent ? byId.get(via.parent) : undefined
    }
    conflicts.push({ task, visibleVia: via?.id ?? id })
  }

  return {
    toTag,
    alreadyTagged,
    excluded,
    conflicts,
    unknownExclusions: [...excludedIds].filter(id => !ids.has(id)),
    visibleAfter: visible.size,
    visibleToday: tasks.length,
  }
}
