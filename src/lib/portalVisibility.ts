import type { ClickUpTask } from './types'

/**
 * Widoczność zadania w portalu klienta: tag `portal` w ClickUpie.
 *
 * CZYSTY moduł, bez bazy i bez sieci. Pobranie rodziców pojedynczego zadania
 * jest w `portalTaskAccess.ts`, zapis w lustrze w `taskIndex.ts`.
 *
 * PO CO TO ISTNIEJE (28.09.2026). Komentarze zespołu idą do klienta tylko ze
 * znacznikiem `[P]`, ale ZADANIA szły wszystkie, razem z opisem. Zadanie
 * `869eprajy` w folderze Onyx było notatką przed rozmową handlową, z opisem
 * „Onyx zbiera oferty opieki i porównuje je z WP Opieki". Klient widział je
 * na tablicy i w Historii, a trzy adresy u klienta dostały 01.09 mail
 * „Zmiana statusu" z jego nazwą. Podobnie u EFF (estymata ze stawką
 * podwykonawcy) i WDF (zadania `[Internal]`, loginy do cudzych paneli).
 *
 * REGUŁA, gdy projekt ma włączone `portalTagOnly`:
 *
 * 1. Zadanie z tagiem `portal` jest widoczne.
 * 2. Podzadanie DZIEDZICZY widoczność po przodkach: widoczny rodzic (lub
 *    dziadek) odsłania całe swoje poddrzewo. Zespół taguje sprawę, a nie
 *    każdy krok pracy nad nią; tak samo klient widział podzadania do tej pory.
 * 3. Podzadanie z własnym tagiem jest widoczne także pod rodzicem bez tagu.
 *    Wtedy pokazuje się jako samodzielna karta, bez rodzica (tak jak sierota
 *    w `buildTaskTree`), bo rodzica klient nie ma prawa zobaczyć.
 * 4. Brak informacji o tagach albo o rodzicu = NIEWIDOCZNE. Przy danych dla
 *    klienta brak potwierdzenia traktujemy jak odmowę (ta sama zasada co przy
 *    zakresie list w `portalScope.ts`).
 *
 * Gdy `portalTagOnly` jest wyłączone, wszystkie funkcje przepuszczają
 * wszystko, czyli zachowanie sprzed tej zmiany. To jest celowe: wdrożenie
 * kodu nie może niczego ukryć, zanim zespół otaguje zadania.
 */

/**
 * Nazwa tagu. ClickUp trzyma nazwy tagów małymi literami, porównanie i tak
 * robimy bez względu na wielkość liter.
 *
 * UWAGA: tag musi ISTNIEĆ w przestrzeni ClickUpa (WAŻNI Klienci), inaczej
 * ClickUp przy tworzeniu zadania pomija go po cichu, bez błędu.
 */
export const PORTAL_VISIBILITY_TAG = 'portal'

/** Ile poziomów w górę szukamy tagu przy pojedynczym zadaniu. */
export const MAX_ANCESTOR_DEPTH = 5

type Tagged = { tags?: ReadonlyArray<{ name?: string | null }> | null }

export function hasPortalTag(task: Tagged | null | undefined): boolean {
  return (task?.tags ?? []).some(
    t => typeof t?.name === 'string' && t.name.trim().toLowerCase() === PORTAL_VISIBILITY_TAG
  )
}

/**
 * Tagi zadania zakładanego przez klienta z portalu: podane plus `portal`.
 * Zadanie, które klient sam zgłosił, musi być dla niego widoczne także po
 * włączeniu filtra, inaczej zgłoszenie „znikałoby" mu z tablicy.
 */
export function withPortalTag(tags?: readonly string[] | null): string[] {
  const out = [...(tags ?? [])]
  if (!out.some(t => t.trim().toLowerCase() === PORTAL_VISIBILITY_TAG)) out.push(PORTAL_VISIBILITY_TAG)
  return out
}

/**
 * Pojedyncze zadanie z już pobranymi przodkami (najbliższy pierwszy).
 * Widoczne, gdy ono albo którykolwiek przodek ma tag.
 */
export function isTaskVisibleInPortal(
  task: Tagged,
  ancestors: readonly Tagged[],
  tagOnly: boolean
): boolean {
  if (!tagOnly) return true
  return hasPortalTag(task) || ancestors.some(hasPortalTag)
}

/**
 * Widoczność dla płaskiego zbioru węzłów (lustro Historii, cały folder).
 * Zwraca identyfikatory widocznych. Liczone ZAWSZE, niezależnie od flagi
 * projektu, żeby przełączenie flagi działało od razu, bez przebudowy lustra.
 *
 * Przodek spoza zbioru = nieznany = bez tagu (reguła 4). Pętla w danych
 * (nie powinna się zdarzyć, ale dane przychodzą z zewnątrz) jest przerwana.
 */
export function computeVisibleIds(
  nodes: ReadonlyArray<{ id: string; parentId: string | null; hasTag: boolean }>
): Set<string> {
  const byId = new Map(nodes.map(n => [n.id, n]))
  const memo = new Map<string, boolean>()

  const visible = (id: string, path: Set<string>): boolean => {
    const cached = memo.get(id)
    if (cached !== undefined) return cached
    const node = byId.get(id)
    if (!node) return false
    if (path.has(id)) return false
    let result = node.hasTag
    if (!result && node.parentId) {
      path.add(id)
      result = visible(node.parentId, path)
      path.delete(id)
    }
    memo.set(id, result)
    return result
  }

  const out = new Set<string>()
  for (const n of nodes) if (visible(n.id, new Set())) out.add(n.id)
  return out
}

/**
 * Drzewo zadań (wynik `buildTaskTree`) przycięte do tego, co klient może
 * zobaczyć. Widoczny węzeł zostaje z CAŁYM poddrzewem (reguła 2). Niewidoczny
 * znika, a jego potomkowie z własnym tagiem wchodzą na poziom główny
 * (reguła 3).
 *
 * Płaska lista bez `children` (np. podgląd zamkniętych, pobierany z
 * `subtasks: false`) działa tak samo. Zamknięte podzadanie bez własnego tagu
 * wypada tam nawet pod otagowanym rodzicem, bo rodzica w zbiorze nie ma;
 * to świadomie bezpieczna strona błędu, pełny kontekst jest w Historii.
 */
export function filterTaskTreeToPortal(roots: ClickUpTask[], tagOnly: boolean): ClickUpTask[] {
  if (!tagOnly) return roots
  const out: ClickUpTask[] = []
  const walk = (task: ClickUpTask, isRoot: boolean) => {
    if (hasPortalTag(task)) {
      // Podzadanie wyniesione spod ukrytego rodzica traci wskaźnik na rodzica:
      // szuflada ma przycisk „przejdź do zadania nadrzędnego", który
      // prowadziłby do zadania, którego klient nie może zobaczyć.
      out.push(isRoot ? task : { ...task, parent: null })
      return
    }
    for (const child of task.children ?? []) walk(child, false)
  }
  for (const root of roots) walk(root, true)
  return out
}
