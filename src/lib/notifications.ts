/**
 * Kto dostaje powiadomienie i czym.
 *
 * Cała logika decyzyjna jest tutaj, jako czyste funkcje bez bazy i bez poczty,
 * bo to jedyny sposób, żeby ją naprawdę sprawdzić. Błąd w tym pliku ma dwa
 * możliwe objawy i oba są kosztowne: cisza, czyli klient nie dowiaduje się, że
 * zespół odpisał, albo zalew, czyli klient wyłącza powiadomienia i wracamy do
 * punktu wyjścia.
 *
 * Zapis do bazy i wysyłka siedzą w warstwie wyżej (trasy), tutaj są same
 * decyzje.
 */

import { TASK_STATUS_CLOSED } from './utils'

/**
 * Rodzaj zdarzenia. Odpowiada kolumnie `kind` w tabeli notifications.
 *
 * `created` doszlo 2026-08-24 razem z macierzą per projekt: nowe zadanie
 * założone przez agencję jest dla klienta informacją, że coś się pojawiło.
 * `panic_ack` nie jest w tej macierzy, bo alarm ma własną, twardą regułę
 * (mail wyłącznie do osoby, która go wcisnęła) i nie podlega konfiguracji.
 */
export type NotifyKind = 'comment' | 'created' | 'status' | 'closed' | 'panic_ack'

/** Ustawienie użytkownika dla grupy zdarzeń. */
export type NotifyMode = 'instant' | 'daily' | 'never'

/**
 * Dwie grupy o różnej pilności, bo tak to ustawia klient w profilu.
 *
 * `important` to rzeczy, na które ktoś czeka: odpowiedź zespołu i podjęty
 * alarm. `board` to ruch na tablicy, który przy porządkach potrafi lecieć
 * seriami i którego domyślnie nie wysyłamy natychmiast.
 */
export type NotifyGroup = 'important' | 'board'

export function groupOf(kind: NotifyKind): NotifyGroup {
  return kind === 'comment' || kind === 'panic_ack' ? 'important' : 'board'
}

/** Użytkownik portalu w zakresie, który jest tu potrzebny. */
export type NotifyUser = {
  id: string
  isActive: boolean
  notifyImportant: string
  notifyBoard: string
}

/**
 * Ustawienie użytkownika dla danego zdarzenia.
 *
 * Nieznana wartość w kolumnie (wiersz sprzed migracji, ręczna edycja w bazie)
 * daje `daily`, nie `instant`. Przy niepewności wybieramy ciszę zamiast
 * wysyłki: mail wysłany przez pomyłkę jest nieodwracalny, opóźniony nie.
 */
export function modeFor(user: NotifyUser, kind: NotifyKind): NotifyMode {
  const raw = groupOf(kind) === 'important' ? user.notifyImportant : user.notifyBoard
  return raw === 'instant' || raw === 'daily' || raw === 'never' ? raw : 'daily'
}

export type Recipient = {
  userId: string
  /**
   * Tryb maila dla tej osoby, albo `null` gdy mail jej nie dotyczy.
   *
   * `null` NIE znaczy „nie powiadamiaj": wiersz w notifications i tak
   * powstaje, więc dzwonek się zapali. Znaczy tylko „bez poczty".
   */
  mail: Exclude<NotifyMode, 'never'> | null
}

export type ChooseInput = {
  /** Wszyscy użytkownicy portalu, także nieaktywni. Filtrujemy tutaj. */
  users: NotifyUser[]
  kind: NotifyKind
  /**
   * Kto wywołał zdarzenie z poziomu portalu. Nie dostaje nic, bo właśnie to
   * zrobił. `null`, gdy zdarzenie przyszło od zespołu w ClickUpie.
   */
  actorUserId?: string | null
  /**
   * Czyja to sprawa: autor zgłoszenia, a przy alarmie osoba, która go
   * wcisnęła. Tylko ta osoba dostaje maila.
   *
   * `null` znaczy „zadanie założone przez agencję, nie ma autora po stronie
   * klienta". Wtedy mail idzie do WSZYSTKICH aktywnych, bo inaczej ta
   * kategoria nie powiadomiłaby nigdy nikogo.
   */
  ownerUserId?: string | null
  /**
   * Kto DODATKOWO obserwuje to zadanie. Ci dostają maila niezależnie od tego,
   * kto sprawę zgłosił.
   *
   * Powód istnienia: do 28.08 poczta chodziła wyłącznie do autora zgłoszenia,
   * więc osoba dopisana do sprawy (szef, druga osoba z zespołu klienta,
   * ktokolwiek zainteresowany) nie miała jak się dowiedzieć o odpowiedzi bez
   * wchodzenia do portalu. Obserwator to jawny wybór człowieka przy konkretnym
   * zadaniu, nie globalna preferencja, więc stoi obok `ownerUserId`, a nie
   * zamiast niego.
   *
   * Własne preferencje obserwatora nadal obowiązują: `never` znaczy „nie
   * chcę poczty" i obserwowanie tego nie przełamuje.
   */
  watcherUserIds?: readonly string[]
}

/**
 * Lista odbiorców powiadomienia.
 *
 * Każdy zwrócony wiersz oznacza wpis w tabeli notifications, czyli zapalony
 * dzwonek. Pole `mail` mówi dodatkowo, czy i jak szybko idzie poczta.
 */
export function chooseRecipients(input: ChooseInput): Recipient[] {
  const { users, kind, actorUserId = null, ownerUserId = null, watcherUserIds = [] } = input
  const watchers = new Set(watcherUserIds)

  const audience = users.filter(u => u.isActive && u.id !== actorUserId)

  // Czy autor sprawy w ogóle jest w gronie odbiorców. Gdy zgłaszający jest
  // nieaktywny albo to on wywołał zdarzenie, nie ma komu wysłać maila
  // imiennie, a wtedy NIE rozlewamy go na wszystkich: sprawa ma właściciela,
  // tylko akurat nie trzeba go teraz zawiadamiać.
  const ownerIsAudience = ownerUserId != null && audience.some(u => u.id === ownerUserId)
  const mailToEveryone = ownerUserId == null

  return audience.map(user => {
    // Obserwator dostaje pocztę OBOK zwykłej reguły, nie zamiast niej. Aktor
    // nadal nic nie dostaje: odfiltrowany jest wyżej, przy `audience`, więc
    // dopisanie siebie do obserwowanych nie zaczyna wysyłać maili o własnych
    // ruchach.
    const wantsMail =
      mailToEveryone || (ownerIsAudience && user.id === ownerUserId) || watchers.has(user.id)
    if (!wantsMail) return { userId: user.id, mail: null }

    const mode = modeFor(user, kind)
    return { userId: user.id, mail: mode === 'never' ? null : mode }
  })
}

/**
 * Czy zdarzenie zmiany statusu jest zamknięciem sprawy.
 *
 * Osobny `kind`, bo zamknięcie dostaje inną treść niż zwykły ruch na tablicy:
 * dla klienta to koniec sprawy, a nie kolejny krok. Nie wysyłamy przy tym
 * dwóch powiadomień, tylko jedno, wyraźniejsze.
 */
export function statusKind(newStatus: string): Extract<NotifyKind, 'status' | 'closed'> {
  return newStatus.trim().toLowerCase() === TASK_STATUS_CLOSED ? 'closed' : 'status'
}
