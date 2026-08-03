import type { ClickUpTask, ClickUpTimeEntry } from './types'

/**
 * Zakres portalu: KTÓRE listy z folderu klienta należą do jego portalu.
 *
 * CZYSTY moduł, bez importu bazy. Zapytanie jest w portalScopeStore.ts.
 *
 * PO CO TO ISTNIEJE. Panel przy zakładaniu projektu każe wybrać folder ORAZ
 * listę, więc obiecuje, że portal pokaże wybraną listę. Ta obietnica nie była
 * dotrzymywana: tabela `portal_lists` służyła WYŁĄCZNIE do wskazania, gdzie
 * tworzyć nowe zadania, a wszystkie odczyty brały CAŁY folder.
 *
 * Nie było tego widać, bo foldery Onyxu, WDF i testowy mają po jednej liście.
 * Wyszło na EFF, gdzie folder ma dwie: klient widział 62 zadania, z czego
 * 55 z listy „EFF SEO", która nigdy nie została do portalu wybrana.
 *
 * Dotyczyło to sześciu miejsc, nie jednego: tablicy, trasy listy zadań,
 * RAPORTU CZASU PRACY (czyli liczb, które klient porównuje z fakturą),
 * indeksu Historii, zamrażania godzin przez cron i sprawdzania uprawnień do
 * pojedynczego zadania.
 *
 * PUSTY ZAKRES ZNACZY „CAŁY FOLDER". To celowa zgodność w tył: portal bez
 * skonfigurowanych list działał do tej pory na całym folderze i nagłe pokazanie
 * mu pustej tablicy byłoby gorsze od błędu, który naprawiamy.
 */
export type PortalScope = readonly string[]

/** Czy zakres w ogóle zawęża. Pusty oznacza brak zawężenia. */
export function scopeLimits(scope: PortalScope): boolean {
  return scope.length > 0
}

export function isListInScope(listId: string | null | undefined, scope: PortalScope): boolean {
  if (!scopeLimits(scope)) return true
  return typeof listId === 'string' && scope.includes(listId)
}

/**
 * Zadania należące do zakresu.
 *
 * Podzadanie dziedziczy listę po rodzicu, więc wystarczy patrzeć na `list.id`
 * każdego zadania. Zadanie BEZ informacji o liście odrzucamy przy zawężonym
 * zakresie: nie da się potwierdzić, że należy do portalu, a przy danych
 * widocznych dla klienta brak potwierdzenia traktujemy jak odmowę.
 */
export function filterTasksToScope<T extends Pick<ClickUpTask, 'list'>>(
  tasks: T[],
  scope: PortalScope
): T[] {
  if (!scopeLimits(scope)) return tasks
  return tasks.filter(t => isListInScope(t.list?.id, scope))
}

/**
 * Wpisy czasu należące do zakresu.
 *
 * `task_location.list_id` przychodzi z ClickUpa razem z wpisem, więc filtrujemy
 * u siebie i nie potrzebujemy dodatkowych wywołań API.
 *
 * Stoper odpalony poza zadaniem ma `list_id` równe null. Taki wpis NIE wchodzi
 * do raportu klienta przy zawężonym zakresie, bo nie ma jak stwierdzić, że
 * dotyczy jego pracy, a raport czasu jest podstawą rozliczenia.
 */
export function filterTimeEntriesToScope(
  entries: ClickUpTimeEntry[],
  scope: PortalScope
): ClickUpTimeEntry[] {
  if (!scopeLimits(scope)) return entries
  return entries.filter(e => isListInScope(e.task_location?.list_id, scope))
}

/**
 * Stabilny opis zakresu, do klucza cache'u. Kolejność list w konfiguracji nie
 * może zmieniać klucza, bo ten sam zestaw dałby dwa różne wpisy.
 */
export function scopeCacheKey(scope: PortalScope): string {
  return scopeLimits(scope) ? [...scope].sort().join(',') : 'caly-folder'
}
