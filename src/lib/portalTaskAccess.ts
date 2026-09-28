import type { ClickUpTask } from './types'
import { hasPortalTag, isTaskVisibleInPortal, MAX_ANCESTOR_DEPTH } from './portalVisibility'

/**
 * Czy JUŻ POBRANE zadanie jest widoczne w portalu, z dociągnięciem przodków,
 * gdy samo nie ma tagu `portal`. Reguła jest w `portalVisibility.ts`, tutaj
 * tylko pobranie.
 *
 * Koszt: zero dodatkowych wywołań przy wyłączonej fladze i przy zadaniu
 * z własnym tagiem; po jednym `getTask` na poziom w górę w pozostałych
 * przypadkach, najwyżej `MAX_ANCESTOR_DEPTH`.
 *
 * `fetchTask` jest parametrem, a nie importem, żeby regułę dało się sprawdzić
 * testem bez sieci i żeby moduł nie ciągnął klienta ClickUpa tam, gdzie go
 * nie trzeba. Błąd pobrania przodka kończy się ODMOWĄ, nie przepuszczeniem.
 */
export async function taskVisibleWithAncestors(
  task: Pick<ClickUpTask, 'tags' | 'parent'>,
  tagOnly: boolean,
  fetchTask: (id: string) => Promise<Pick<ClickUpTask, 'tags' | 'parent'>>
): Promise<boolean> {
  if (!tagOnly || hasPortalTag(task)) return true

  const ancestors: Array<Pick<ClickUpTask, 'tags' | 'parent'>> = []
  let parentId = task.parent
  const seen = new Set<string>()
  while (parentId && ancestors.length < MAX_ANCESTOR_DEPTH && !seen.has(parentId)) {
    seen.add(parentId)
    try {
      const parent = await fetchTask(parentId)
      ancestors.push(parent)
      if (hasPortalTag(parent)) break
      parentId = parent.parent
    } catch {
      return false
    }
  }
  return isTaskVisibleInPortal(task, ancestors, tagOnly)
}
