/**
 * Kto dostaje zadanie założone Z PORTALU.
 *
 * CZYSTA funkcja, bo to jest reguła, nie dostęp do danych — a regułę taniej
 * sprawdzić testem niż zakładaniem zadań w ClickUpie.
 *
 * Trzy poziomy, od najmocniejszego:
 *
 *   1. **Ustawienie projektu** (`defaultAssigneeId` w panelu). Tu wpisuje się
 *      wyjątek: WDF i EFF idą do Filipa, nie do zapasu.
 *   2. **Zapas agencji** (`CLICKUP_DEFAULT_ASSIGNEE_ID`), czyli osoba, która
 *      bierze wszystko, czego nikt nie przypisał. Dziś Paulina.
 *   3. **Nikt.** Zadanie powstaje bez przypisania, zamiast nie powstać wcale.
 *
 * Punkt 3 jest tu najważniejszy i celowy: zgłoszenie klienta ma trafić do
 * ClickUpa ZAWSZE. Nieprzypisane zadanie widać na tablicy i da się je podjąć,
 * a zgłoszenie odrzucone z powodu braku konfiguracji ginie bez śladu.
 */

/**
 * Zmienna środowiskowa z zapasową osobą agencji.
 *
 * Czytana przy każdym wywołaniu, nie raz do stałej modułowej: inaczej zmiana
 * w Coolify wymagałaby przebudowania obrazu, a nie samego restartu.
 */
export function agencyFallbackAssignee(): number | null {
  return parseAssigneeId(process.env['CLICKUP_DEFAULT_ASSIGNEE_ID'])
}

/**
 * Id osoby z dowolnego wejścia (env, JSON, formularz) albo `null`.
 *
 * ClickUp odrzuca CAŁE żądanie utworzenia zadania, gdy dostanie id spoza
 * workspace albo śmieć, więc wszystko, czego nie rozumiemy, zamieniamy na
 * „brak przypisania". Zero jest odrzucane celowo: to nie jest id żadnego
 * użytkownika, a bywa wynikiem `Number('')`.
 */
export function parseAssigneeId(raw: unknown): number | null {
  if (raw === null || raw === undefined || raw === '') return null
  const n = typeof raw === 'number' ? raw : Number(String(raw).trim())
  if (!Number.isInteger(n) || n <= 0) return null
  return n
}

/**
 * Komu przypisać zadanie z portalu: ustawienie projektu, a w zapasie agencja.
 */
export function assigneeForPortal(portalAssigneeId: number | null | undefined): number | null {
  return parseAssigneeId(portalAssigneeId) ?? agencyFallbackAssignee()
}

/**
 * Pole `assignees` do `createTask`, gotowe do rozwinięcia w obiekcie.
 *
 * Zwraca PUSTY obiekt, gdy nie ma kogo przypisać, zamiast `assignees: []`.
 * To nie jest kosmetyka: pusta tablica jest dla ClickUpa jawnym poleceniem
 * „bez przypisanych" i potrafi zdjąć automatyczne przypisanie ustawione po
 * ich stronie, a brak pola zostawia tamtą regułę w spokoju.
 */
export function assigneesField(portalAssigneeId: number | null | undefined): { assignees?: number[] } {
  const kto = assigneeForPortal(portalAssigneeId)
  return kto === null ? {} : { assignees: [kto] }
}
