import { getTaskComments } from './clickup'
import { isPublicComment, publicCommentBlocks, stripPublicPrefix } from './publicComments'
import { blocksToText } from './commentBlocks'
import { statusKind } from './notifications'
import { produceNotifications, type ProduceResult } from './notifyProducer'
import type { ParsedStatusChange } from './clickupHistoryItems'
import { sortOldestFirst } from './utils'

/**
 * Przekład zdarzenia z webhooka ClickUpa na powiadomienie.
 *
 * Osobny moduł, bo trasa webhooka ma już swoje zadania (rozpoznanie portalu,
 * indeks Historii, historia statusów), a to jest czwarte i najbardziej podatne
 * na zmiany: to tutaj rozstrzyga się, CO jest zdarzeniem wartym powiadomienia.
 *
 * `notifyProducer` nie zna ClickUpa i ma tak zostać: przyjmuje gotowe dane i
 * decyduje, komu i czym. Tu jest cała wiedza o kształcie zdarzeń ClickUpa.
 */

/**
 * Komentarz z ClickUpa.
 *
 * Treść bierzemy z API, NIE z payloadu webhooka. Payload `taskCommentPosted`
 * niesie komentarz w `history_items`, ale w kształcie, którego nigdy nie
 * widzieliśmy na żywo (subskrypcji webhooka dla portalu nie było do 2026-08-24),
 * a zgadywanie kształtu cudzego payloadu kończy się cichym brakiem powiadomień.
 * Jedno dodatkowe zapytanie jest tego warte, bo kształt odpowiedzi API mamy
 * zmierzony na 404 prawdziwych komentarzach.
 */
export async function notifyOnComment(input: {
  portalId: string
  taskId: string
  taskName: string
}): Promise<ProduceResult> {
  let comments
  try {
    comments = await getTaskComments(input.taskId)
  } catch (e) {
    // Nie w górę. Błąd zwrócony z trasy webhooka sprawia, że ClickUp ponawia
    // zdarzenie, a po serii nieudanych prób WYŁĄCZA subskrypcję i zabiera przy
    // okazji indeksowanie Historii. Brak powiadomienia jest zły, martwy webhook
    // gorszy.
    console.error(`[notify] nie udało się pobrać komentarzy zadania ${input.taskId}:`, e)
    return { bell: 0, mailed: 0, reason: 'error' }
  }
  const najnowszy = sortOldestFirst(comments).at(-1)

  // Komentarz bez znacznika `[P]` to korespondencja wewnątrz zespołu: klient
  // go nie widzi w portalu, więc powiadomienie o nim byłoby powiadomieniem o
  // treści, do której nie ma dostępu.
  if (!najnowszy || !isPublicComment(najnowszy.comment_text)) {
    return { bell: 0, mailed: 0, reason: 'channel-off' }
  }

  /**
   * Wycinek liczymy TĄ SAMĄ ścieżką, którą widzi klient w portalu:
   * `publicCommentBlocks` plus `blocksToText`. Surowy `comment_text` od
   * ClickUpa zawiera to, co z widoku usuwamy, więc w dzwonku wychodziło
   * „@Paulina Andrzejewska Duplikat rozmiaru…", czyli oznaczenie osoby
   * usunięte z treści tego samego dnia (złapane przy sprawdzaniu na żywo
   * 2026-08-24). Powiadomienie nie może pokazywać czegoś innego niż portal.
   */
  const text = blocksToText(publicCommentBlocks(najnowszy))

  /**
   * AUTOR liczony tą samą ścieżką co w wątku, a NIE z konta ClickUpa.
   *
   * `user.username` to imię i nazwisko osoby z zespołu, która akurat odpisała,
   * i tak właśnie w dzwonku klienta wyszło „Łukasz Slusarski: test2"
   * (zgłoszone 24.08). `stripPublicPrefix` daje to, co klient widzi nad
   * komentarzem: własne imię, gdy pisał ktoś od klienta, albo zespół, gdy
   * odpisała agencja.
   */
  const { sender } = stripPublicPrefix(najnowszy.comment_text ?? '')

  return produceNotifications({
    portalId: input.portalId,
    event: 'comment',
    taskId: input.taskId,
    taskName: input.taskName,
    author: sender,
    excerpt: text,
    clickupCommentId: najnowszy.id,
  })
}

/** Zmiana statusu. Zamknięcie sprawy dostaje własne zdarzenie, nie „status". */
export function notifyOnStatusChange(input: {
  portalId: string
  taskId: string
  taskName: string
  change: ParsedStatusChange
}): Promise<ProduceResult> {
  return produceNotifications({
    portalId: input.portalId,
    event: statusKind(input.change.toStatus),
    taskId: input.taskId,
    taskName: input.taskName,
    fromStatus: input.change.fromStatus,
    toStatus: input.change.toStatus,
    // Czas Z CLICKUPA, nie nasz: to on odróżnia powtórzone dostarczenie tego
    // samego zdarzenia od prawdziwej drugiej zmiany na ten sam status.
    eventAt: input.change.changedAt,
  })
}

/** Nowe zadanie. Sensowne głównie wtedy, gdy założyła je agencja. */
export function notifyOnTaskCreated(input: {
  portalId: string
  taskId: string
  taskName: string
}): Promise<ProduceResult> {
  return produceNotifications({
    portalId: input.portalId,
    event: 'created',
    taskId: input.taskId,
    taskName: input.taskName,
  })
}
