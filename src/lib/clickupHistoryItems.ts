/**
 * Odczyt zmiany statusu z payloadu webhooka ClickUpa.
 *
 * CZYSTY moduł, bez bazy i bez sieci, bo to jest zgadywanie kształtu CUDZYCH
 * danych i jedyne miejsce, w którym da się je sprawdzić bez wywoływania
 * prawdziwego zdarzenia w ClickUpie.
 *
 * ClickUp przysyła przy `taskStatusUpdated` tablicę `history_items`, a w niej
 * wpis z `field: 'status'` oraz obiektami `before` i `after`. Kształt NIE jest
 * gwarantowany umową: pakiet nie ma na to typów, dokumentacja bywa niepełna,
 * a pola potrafią przyjść jako null. Dlatego wszystko tutaj jest odporne na
 * brak i nigdy nie rzuca — brakująca wartość poprzednia jest odpowiedzią
 * prawidłową („nie wiemy"), a nie powodem do odrzucenia całego zdarzenia.
 */

/** Kształt, jakiego się spodziewamy — celowo cały opcjonalny. */
export type ClickUpHistoryItem = {
  field?: string | null
  date?: string | null
  before?: { status?: string | null } | null
  after?: { status?: string | null } | null
  user?: { username?: string | null; email?: string | null } | null
}

export type ParsedStatusChange = {
  fromStatus: string | null
  toStatus: string
  actorLabel: string | null
  changedAt: Date | null
}

function tekst(value: unknown): string | null {
  return typeof value === 'string' && value.trim().length > 0 ? value.trim() : null
}

/**
 * Pierwsza zmiana statusu z listy, albo null.
 *
 * Null znaczy „to zdarzenie nie niesie zmiany statusu" i jest normalne:
 * `taskUpdated` przychodzi także przy zmianie opisu czy priorytetu.
 *
 * Zmiana BEZ nowego statusu jest odrzucana. Wiersz historii z pustym `to`
 * nie mówiłby nic, a `to_status` jest w bazie kolumną wymaganą.
 */
export function parseStatusChange(
  items: ClickUpHistoryItem[] | undefined | null
): ParsedStatusChange | null {
  if (!Array.isArray(items)) return null

  const wpis = items.find(i => tekst(i?.field) === 'status')
  if (!wpis) return null

  const toStatus = tekst(wpis.after?.status)
  if (!toStatus) return null

  return {
    fromStatus: tekst(wpis.before?.status),
    toStatus,
    // Nazwa użytkownika, a w zapasie adres: przy koncie serwisowym agencji
    // `username` bywa pusty, a adres pozwala odróżnić, kto to był.
    actorLabel: tekst(wpis.user?.username) ?? tekst(wpis.user?.email),
    changedAt: parseClickUpDate(wpis.date),
  }
}

/**
 * Data ClickUpa: milisekundy jako NAPIS. Null przy czymkolwiek innym.
 *
 * Wołający ma wtedy użyć czasu bieżącego. Data z przyszłości albo sprzed epoki
 * to znak, że pole znaczy co innego, niż zakładamy — lepszy jest wtedy czas
 * odebrania webhooka niż wartość, która przestawi porządek historii.
 */
export function parseClickUpDate(raw: unknown): Date | null {
  const napis = tekst(raw)
  if (!napis) return null

  const ms = Number(napis)
  if (!Number.isFinite(ms) || ms <= 0) return null

  const data = new Date(ms)
  if (Number.isNaN(data.getTime())) return null

  // Rok 2000 jako dolna granica: portal nie istniał wcześniej, więc taka
  // wartość znaczy zły format, a nie stare zdarzenie.
  if (data.getFullYear() < 2000) return null

  return data
}
