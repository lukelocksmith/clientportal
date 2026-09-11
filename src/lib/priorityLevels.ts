import { AWARIA_TAG } from '@/lib/utils'

/**
 * Skala poziomów zgłoszenia. JEDNO ŹRÓDŁO dla promptu asystenta i dla
 * formularza, który klient wypełnia ręcznie.
 *
 * Wydzielone z `taskPrompt.ts` 11.09, gdy poziomy stały się potrzebne
 * w komponencie klienckim (formularz awaryjny). Import samego `taskPrompt`
 * wciągnąłby do paczki przeglądarki CAŁĄ treść promptu asystenta, czyli
 * oddałby klientowi nasze instrukcje do przeczytania w źródle strony.
 *
 * Skala pochodzi z planu opieki i jest częścią zobowiązania wobec klienta:
 * od poziomu zależy czas pierwszej reakcji. Zmiana definicji tutaj zmienia
 * znaczenie tabeli w ofercie, więc nie jest kosmetyką.
 */

/** Poziom skali. `clickup` to wartość pola priority w ClickUpie. */
export type PriorityLevel = {
  code: 'P0' | 'P1' | 'P2' | 'P3'
  /** Nazwa poziomu językiem klienta, taka jak w ofercie. */
  label: string
  /** Kiedy tak klasyfikujemy. Skrót definicji z oferty. */
  when: string
  /**
   * Pole priority w ClickUpie: 1 = Urgent, 2 = High, 3 = Normal, 4 = Low.
   *
   * `null` dla awarii, bo awaria NIE MA odpowiednika w polu priority. Idzie
   * osobnym kanałem (przycisk Alarm), a zadanie z nią związane rozpoznaje się
   * po tagu AWARIA_TAG, nie po priorytecie. Wcześniej awaria zajmowała
   * `urgent` i przez to nie dało się jej odróżnić od zwykłej P1.
   */
  clickup: 1 | 2 | 3 | null
  /**
   * Czy czat pokazuje ten poziom klientowi do wyboru.
   *
   * P0 nie. Alarm ma w portalu własny czerwony przycisk, który idzie od razu na
   * Discorda i mailem, i to on uruchamia zegar. Gdyby czat oferował P0 jako
   * jedną z opcji na liście, zgłoszenie awarii wyglądałoby na obsłużone, a
   * powiadomienie nigdzie by nie poszło. Priorytet 1 nadaje więc system, gdy
   * opis odpowiada awarii, a nie klient wybierając z listy.
   */
  offeredInChat: boolean
}

export const PRIORITY_LEVELS: readonly PriorityLevel[] = [
  {
    code: 'P0',
    label: 'alarm',
    when: 'sklep nie działa albo nie da się złożyć zamówienia, utrata danych, podejrzenie włamania',
    clickup: null,
    offeredInChat: false,
  },
  {
    code: 'P1',
    label: 'istotna usterka',
    when: 'sprzedaż idzie, ale kluczowa funkcja nie działa: metoda płatności, synchronizacja z systemem zewnętrznym, maile transakcyjne',
    clickup: 1,
    offeredInChat: true,
  },
  {
    code: 'P2',
    label: 'usterka drobna',
    when: 'coś działa lub wyświetla się niepoprawnie, ale nie blokuje sprzedaży ani obsługi zamówień',
    clickup: 2,
    offeredInChat: true,
  },
  {
    code: 'P3',
    label: 'zmiana planowana',
    when: 'zmiany treści, banery, drobne modyfikacje, konsultacja',
    clickup: 3,
    offeredInChat: true,
  },
]

/**
 * Odwrotne odwzorowanie, do opisów i weryfikacji.
 *
 * `undefined` dla 4 (Low): ClickUp ma ten poziom, skala z umowy nie. Zadanie
 * z Low jest w porządku, po prostu nie ma poziomu umownego i czasu reakcji.
 * Awaria też nie wpadnie tutaj nigdy, bo jej `clickup` jest `null`, a `null`
 * odpada na porównaniu z liczbą.
 */
export function levelByClickupPriority(value: number): PriorityLevel | undefined {
  return PRIORITY_LEVELS.find(l => l.clickup === value)
}

/** Poziomy, które czat pokazuje klientowi. Bez P0, ten idzie przyciskiem Alarm. */
export const CHAT_LEVELS = PRIORITY_LEVELS.filter(l => l.offeredInChat)

/** Poziom awarii. Nadaje go system po opisie, nie klient z listy. */
export const ALARM_LEVEL = PRIORITY_LEVELS.find(l => !l.offeredInChat)!
