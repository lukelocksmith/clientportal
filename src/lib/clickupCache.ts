import { unstable_cache, revalidateTag } from 'next/cache'
import { getAllTasksForFolder } from './clickup'
import type { ClickUpTask } from './types'

/**
 * Cache zadań folderu klienta, wspólny dla wszystkich jego użytkowników.
 *
 * PO CO: strona kanbanu czyta ciasteczko sesji, więc jest renderowana
 * dynamicznie, a `export const revalidate = 60` na segmencie NIE MA W TYM
 * PRZYPADKU ŻADNEGO EFEKTU. Stało tam i wyglądało jak działające buforowanie,
 * a każde wejście na tablicę wykonywało od nowa całą serię wywołań ClickUpa:
 * jedno po listy folderu, potem po jednym na stronę zadań każdej listy.
 * Zmierzone na produkcji: 1279-1739 ms dla kanbanu wobec ok. 300 ms dla
 * pozostałych zakładek.
 *
 * Buforujemy DANE, nie stronę. Sesja zostaje poza zasięgiem cache'u, więc
 * wynik da się bezpiecznie dzielić: kluczem jest identyfikator folderu, a ten
 * pochodzi z rekordu portalu w bazie, nigdy z adresu. Dwóch klientów nie ma
 * jak trafić na wspólny wpis.
 *
 * Świadomie NIE włączamy flagi `cacheComponents` i dyrektywy `use cache`.
 * To zmienia semantykę renderowania w całej aplikacji, a mamy jedną wolną
 * stronę. `unstable_cache` jest drogą dokumentowaną dla projektów bez Cache
 * Components i dotyka wyłącznie tego jednego zapytania.
 */

/**
 * Czterdzieści pięć sekund, nie pięć minut. Klient patrzy na tablicę wtedy,
 * gdy coś się u niego dzieje, i porównuje ją z tym, co widzi w mailu albo słyszy
 * od nas przez telefon. Dłuższe okno oznaczałoby rozmowy „u mnie tego nie ma".
 */
export const FOLDER_TASKS_TTL_SECONDS = 45

/** Znacznik do unieważniania. Jeden folder to jeden klient. */
export function folderTasksTag(folderId: string): string {
  return `clickup-folder-tasks-${folderId}`
}

/**
 * Zadania folderu z cache'u. Do renderowania strony, gdzie liczy się czas
 * wejścia, a kilkudziesięciosekundowe opóźnienie jest niewidoczne.
 */
export function getCachedTasksForFolder(folderId: string): Promise<ClickUpTask[]> {
  return unstable_cache(
    () => getAllTasksForFolder(folderId),
    // Identyfikator folderu MUSI być częścią klucza, inaczej pierwszy klient,
    // który wejdzie na tablicę, obsadziłby cache dla wszystkich pozostałych.
    ['clickup-folder-tasks', folderId],
    { revalidate: FOLDER_TASKS_TTL_SECONDS, tags: [folderTasksTag(folderId)] }
  )()
}

/**
 * Unieważnia cache folderu. Wołać po KAŻDEJ zmianie, którą klient zobaczy:
 * utworzeniu zadania, zmianie statusu, edycji.
 *
 * Bez tego dodanie cache'u byłoby pogorszeniem, nie poprawą: klient
 * przeciągnąłby kartę albo zgłosił zadanie, odświeżył stronę i zobaczył stan
 * sprzed swojej własnej akcji. „Nie zapisało się" jest gorsze niż „wolno się
 * wczytuje".
 *
 * Nie rzuca wyjątkiem. Unieważnienie cache'u jest wtórne wobec operacji, która
 * już się udała, więc nie ma prawa jej przewrócić.
 */
export async function invalidateFolderTasks(folderId: string): Promise<void> {
  try {
    // `revalidateTag` w Next 16 wymaga DRUGIEGO argumentu, profilu. To zmiana
    // względem wcześniejszych wersji, w których wystarczał sam znacznik.
    //
    // `{ expire: 0 }`, nie zalecane w dokumentacji `'max'`: profile takie jak
    // `'max'` dają semantykę „oddaj stare, odśwież w tle", czyli klient, który
    // właśnie zgłosił zadanie, przy następnym wejściu dalej by go nie zobaczył.
    // `expire` oznacza „następne żądanie CZEKA na świeże dane", i to jest
    // dokładnie to, czego tu chcemy.
    revalidateTag(folderTasksTag(folderId), { expire: 0 })
  } catch (e) {
    console.error('[clickupCache] nie udało się unieważnić cache folderu:', e)
  }
}
