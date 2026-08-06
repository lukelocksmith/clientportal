import { NextResponse } from 'next/server'
import { getPortalForSession } from './portalSession'
import { getPortalScope } from './portalScopeStore'
import { verifyTaskBelongsToFolder } from './clickup'
import type { portals } from './db/schema'
import type { Session } from './types'

type PortalRow = typeof portals.$inferSelect

/**
 * Brama tras API portalu klienta: sesja plus rekord portalu, jednym wywołaniem.
 *
 * Strony miały już jedno wejście (`getPortalForSession`), trasy API nie. Ta sama
 * reguła była w nich rozpisana w PIĘCIU wariantach: `!session`, `!session ||
 * portalSlug !== slug`, osobne 401 i 403, raz portal doczytywany po
 * `session.portalId`, raz po `portals.slug` z adresu (z `slug!`). Wszystkie
 * wypadały bezpiecznie tylko dlatego, że `getSession(slug)` samo zawęża sesję
 * klienta do jego portalu. Bezpieczeństwo opierało się więc na jednej linijce
 * w innym pliku, a każdy z pięciu wariantów wyglądał, jakby sprawdzał to sam.
 *
 * `slug` jest WYMAGANY. Nie jest to zaostrzenie na wyrost: obejście admina w
 * `getSession` działa wyłącznie, gdy żądanie nazywa portal. Trasa przyjmująca
 * żądanie bez sluga po cichu odcinała admina od danych, które miał widzieć.
 *
 * Portal bierzemy po `session.portalId`, nigdy po slugu z adresu. To ta sama
 * zasada, którą opisuje `portalSession.ts`: tożsamość pochodzi z sesji.
 */
export type PortalApiSession =
  | { ok: true; session: Session; portal: PortalRow }
  | { ok: false; response: NextResponse }

export async function requirePortalApi(
  slug: string | null | undefined
): Promise<PortalApiSession> {
  if (!slug) {
    return { ok: false, response: NextResponse.json({ error: 'Missing slug' }, { status: 400 }) }
  }

  const result = await getPortalForSession(slug)
  if (!result.ok) {
    // NIEISTNIEJĄCY projekt kończy się kodem 401, nie 404, i tak ma być: nie da
    // się tą trasą sprawdzać, które projekty istnieją. Wynika to z tego, że
    // zanim jest sesja, portal jest już potwierdzony — dla klienta przez JOIN
    // w `getSession`, dla admina przez jego własne wyszukanie portalu po slugu.
    //
    // Gałąź 404 zostaje na wąski wyścig: portal skasowany MIĘDZY sprawdzeniem
    // sesji a odczytem rekordu. Wtedy sesja jest prawidłowa, a zasobu nie ma,
    // więc 401 byłoby kłamstwem. Zmierzone testem integracyjnym, nie założone.
    return result.reason === 'no-portal'
      ? { ok: false, response: NextResponse.json({ error: 'Not found' }, { status: 404 }) }
      : { ok: false, response: NextResponse.json({ error: 'Unauthorized' }, { status: 401 }) }
  }

  return { ok: true, session: result.session, portal: result.portal }
}

/**
 * Czy zadanie należy do tego projektu. Zwraca gotową odpowiedź 403, gdy nie.
 *
 * Folder ORAZ zakres list: folder klienta może zawierać listy, których do
 * portalu nie wybraliśmy. Bez tego klient, znając identyfikator zadania,
 * odczytałby jego opis, komentarze i załączniki z listy, której mu nie
 * udostępniliśmy.
 *
 * Ten blok był skopiowany w czterech trasach. Sprawdzenie IDOR-a to nie jest
 * rzecz, która ma żyć w kopiach.
 */
export type TaskScopeCheck = { ok: true } | { ok: false; response: NextResponse }

export async function requireTaskInPortal(
  taskId: string,
  portal: PortalRow
): Promise<TaskScopeCheck> {
  const scope = await getPortalScope(portal.id)
  const belongs = await verifyTaskBelongsToFolder(taskId, portal.clickupFolderId, scope)
  if (!belongs) {
    return { ok: false, response: NextResponse.json({ error: 'Forbidden' }, { status: 403 }) }
  }
  return { ok: true }
}
