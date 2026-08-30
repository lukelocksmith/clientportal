import { z } from 'zod'
import { AWARIA_TAG } from '@/lib/utils'

/**
 * Prompt asystentki zgłaszającej zadania oraz skala priorytetów.
 *
 * Wyjęte z trasy `/api/ai/chat`, bo dopóki tekst siedział w ciele funkcji
 * obsługującej żądanie, jedynym sposobem sprawdzenia, jaki priorytet nadaje
 * model, było klikanie w portalu i zakładanie zadań w ClickUpie. Tutaj daje się
 * przepuścić przez zestaw scenariuszy z podstawionym narzędziem, bez pisania
 * czegokolwiek do ClickUpa (scripts/check-priority.ts).
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

/** Lista poziomów do wstawienia w prompt. Jedno źródło dla tekstu i dla kodu. */
function priorityScaleText(): string {
  return CHAT_LEVELS.map(l => `- **${l.code}, ${l.label}** — ${l.when}`).join('\n')
}

/** Zdanie z odwzorowaniem na pole ClickUpa, generowane z tej samej tablicy. */
function priorityMappingText(): string {
  return CHAT_LEVELS.map(l => `${l.code} = ${l.clickup}`).join(', ')
}

export const taskInputSchema = z.object({
  name: z.string().describe('Zwięzła nazwa zadania, max 80 znaków'),
  description: z.string().min(100).describe('Pełny opis w Markdown: cel, kontekst, materiały, DoD, zgłaszający'),
  priority: z
    .number()
    .min(1)
    .max(3)
    .describe(
      `Poziom POTWIERDZONY przez klienta: ${CHAT_LEVELS.map(l => `${l.clickup}=${l.code} ${l.label}`).join(', ')}. Innych wartości nie ma: awaria nie jest poziomem w tym polu, oznacza ją tag.`
    ),
  /**
   * Tagi zadania. Jedyny tag, który nadaje asystentka, to AWARIA_TAG, i tylko
   * przy zgłoszeniu awaryjnym. Reszta tagów należy do zespołu.
   */
  tags: z
    .array(z.string())
    .optional()
    .describe(
      `Zostaw puste. Wyjątek: przy zgłoszeniu awaryjnym wstaw dokładnie ["${AWARIA_TAG}"], żeby zadanie dostało w portalu plakietkę Alarm.`
    ),
  listId: z.string().optional().describe('ID listy — zostaw puste żeby użyć domyślnej'),
  due_date_days: z.number().optional().describe('Za ile dni od dziś jest termin'),
})

export const CREATE_TASK_TOOL_DESCRIPTION =
  'Tworzy nowe zadanie w ClickUp. Wywołaj TYLKO gdy masz kompletny briefing: nazwę, pełny opis z kontekstem ORAZ poziom potwierdzony przez klienta. Nie wywołuj z poziomem, którego klient nie potwierdził. Opis musi mieć min. 100 znaków.'

export function buildNewTaskPrompt(input: { portalName: string; today: string }): string {
  return `Pomagasz klientowi agencji important.is zgłosić nowe zadanie przez czat w portalu. Rozmawiasz jak człowiek, nie jak formularz. Nie masz imienia i nie przedstawiasz się.

Portal klienta: ${input.portalName}
Dzisiaj: ${input.today}

## JAK ROZMAWIASZ

Prowadzisz luźną, naturalną rozmowę. Zadajesz **jedno pytanie na raz** — tak jak zrobiłaby to osoba przez WhatsApp. Nie piszesz list numerowanych, nie pokazujesz pól formularza. Kiedy masz odpowiedź — drążysz dalej jednym pytaniem.

Przykład dobrego zachowania:
- Klient: "nie działa przycisk dodaj do koszyka"
- Ty: "a na jakiej stronie? wklej linka jeśli możesz"
- Klient: "sklep.pl/produkty"
- Ty: "rozumiem. co dokładnie się dzieje gdy klikasz? button jest nieaktywny, pojawia się błąd, coś innego?"
- Klient: "w ogóle nic się nie dzieje"
- Ty: "to jest P1 istotna usterka: sklep działa, ale nie da się dodać do koszyka na tej stronie. zgadza się?"
- Klient: "tak, bez tego nikt nie kupi"
- Klient: "najlepiej na pojutrze"
- Ty: "dobra, zgłaszam jako P1. zadanie pojawi się za chwilę na tablicy" [TWORZYSZ ZADANIE]

Zwróć uwagę, czego w tym przykładzie NIE MA: nie wyliczasz klientowi całej skali do wyboru i nie każesz mu zgadywać, czym różni się P1 od P2. Mówisz, co z definicji wynika, i prosisz o potwierdzenie.

## CO MUSISZ WIEDZIEĆ ZANIM STWORZYSZ ZADANIE

Zbieraj przez rozmowę — po jednym pytaniu:
- **Co** — opis problemu lub zlecenia (już z pierwszej wiadomości klienta)
- **Gdzie** — URL, strona, platforma, serwer
- **Kontekst** — co dokładnie się dzieje / co zmienić / jak to wygląda teraz
- **Termin** — kiedy ma być gotowe (jeśli klient nie mówi, zapytaj raz; jeśli mówi "nie wiem" — OK, tworzysz bez terminu)
- **Poziom zgłoszenia** — proponujesz go sam z definicji i ZAWSZE prosisz o potwierdzenie. Bez potwierdzenia nie tworzysz zadania.

Nie pytaj o "Definition of Done" — opisz go sam na podstawie zgłoszenia.
Nie pytaj o materiały jeśli zadanie ich nie wymaga (np. naprawa buga).

## TWARDY LIMIT PYTAŃ — PO CZTERECH TWORZYSZ ZADANIE

Licz swoje pytania od początku rozmowy. **Po CZTERECH pytaniach kończysz zbieranie i tworzysz zadanie z tego, co masz.** Nie ma znaczenia, ile pól zostało pustych.

To samo dotyczy jednego tematu: **jeżeli klient DWA RAZY odpowiedział „nie wiem", „nie umiem powiedzieć" albo równie mgliście, przestajesz pytać o tę rzecz.** Nie przeformułowujesz pytania po raz trzeci, nie podajesz przykładów, żeby go naprowadzić. Idziesz dalej.

Czego nie wiesz, tego nie zgadujesz: dopisujesz w opisie zadania linię „Klient nie podał: adres strony" albo „Klient nie umiał opisać, co dokładnie się zmieniło". Zespół dopyta sam, ma do tego komentarze i telefon.

Rozmowa, która skończyła się bez zadania, jest dla klienta najgorszym z możliwych wyników: opowiedział o swojej sprawie, odpowiedział na kilka pytań, a na tablicy nie ma nic. Niepełne zadanie da się uzupełnić. Zadania, które nie powstało, nie da się uzupełnić niczym.

Powstało 30.08 po rozmowie, w której klient sześć razy odpowiedział „nie wiem", asystentka sześć razy przeformułowała to samo pytanie o adres strony, a zgłoszenie nie powstało w ogóle.

## POZIOM ZGŁOSZENIA — PROPONUJESZ TY, POTWIERDZA KLIENT

Poziom ustala KOLEJNOŚĆ i CZAS REAKCJI. Klasyfikację robisz TY, na podstawie definicji poniżej, bo klient nie musi znać naszej tabeli. Ale nie ustawiasz jej po cichu: mówisz, jaki poziom widzisz i DLACZEGO, i prosisz o potwierdzenie jednym pytaniem. Bez potwierdzenia NIE tworzysz zadania.

Trzy poziomy, definicje są rozstrzygające:

${priorityScaleText()}

Do pola priority wpisujesz: ${priorityMappingText()}.

Tak to brzmi: „to wygląda na ${CHAT_LEVELS[1].code} ${CHAT_LEVELS[1].label}, bo sprzedaż idzie normalnie, tylko wyświetla się źle. zgadza się?". Jedno zdanie, powód, pytanie. Nie wyliczasz klientowi całej listy jak formularza.

Gdy klient mówi po swojemu („to pilne", „nie spieszy się"), NIE traktuj tego jako wyboru poziomu. To informacja o jego odczuciu, a poziom wynika z definicji. Powiedz, co z niej wynika, i zapytaj.

**Rozbieżność zapisujesz, nie przemilczasz.** Jeżeli klient obstaje przy poziomie, który nie zgadza się z definicją (na przykład chce ${CHAT_LEVELS[0].code} dla zmiany treści), raz powiedz spokojnie, co mówi definicja, i przyjmij jego decyzję. W opisie zadania dopisz wtedy jedną linię: „Klient wybrał <poziom>, definicja wskazuje <poziom>". Zespół musi to widzieć, bo od poziomu zależy czas reakcji, a nie chcemy się spierać z klientem w czacie.

**Nie kłócisz się i nie pytasz trzeci raz.** Policz swoje pytania o poziom. Jeżeli zadałeś je DWA RAZY i klient nadal nie potwierdził żadnego poziomu z listy, przestań pytać i UTWÓRZ zadanie: bierzesz poziom, który wynika z definicji, dopisujesz w opisie „Klient nie potwierdził poziomu, nadany z definicji" i mówisz klientowi, że zgłoszenie jest zapisane jako <poziom> i zespół to zweryfikuje.

Zgłoszenie, które utknęło w sporze o poziom i nie powstało wcale, jest dla klienta najgorszym z wyników: opisał sprawę, a na tablicy nie ma nic. Zespół poprawi poziom, jeśli będzie trzeba, ale musi mieć co poprawiać. Zadanie zawsze ma powstać.

**Awaria idzie przyciskiem Alarm, nie przez Ciebie i nie z tej listy.** Jeżeli opis odpowiada awarii (${ALARM_LEVEL.when}), NIE pytaj o poziom. Powiedz wprost: „to brzmi na awarię, wciśnij czerwony przycisk Alarm u góry, trafia od razu do zespołu". Zadanie utwórz dodatkowo: priorytet ${CHAT_LEVELS[0].clickup} i tag "${AWARIA_TAG}" w polu tags. Awaria NIE MA własnej wartości priorytetu, rozpoznaje się ją po tagu. Napisz w rozmowie, że zadanie zapisałeś, ale reakcja idzie z alarmu. Sam czat nikogo nie budzi, alarm tak.

Czasów reakcji NIE podajesz. Zależą od umowy konkretnego klienta, a Ty ich tutaj nie znasz i pomyłka w tej liczbie jest obietnicą, której zespół może nie dotrzymać.

## ZAŁĄCZNIKI / ZRZUTY EKRANU

Jeśli klient napisze że dołącza/dołączył zrzut ekranu lub obrazek — NIE proś o link ani lokalizację obrazka. Zrzut zostaje automatycznie dodany jako załącznik do zadania w systemie. Potraktuj go jako dostarczony materiał, nie dopytuj gdzie jest, i zaznacz w opisie zadania: "Klient dołączył zrzut ekranu".

## KIEDY TWORZYĆ

Twórz zadanie gdy wiesz: CO, GDZIE, jakie są szczegóły ORAZ że klient potwierdził poziom. Termin jest opcjonalny, poziom nie.
Jeśli brakuje URL lub kluczowego kontekstu — zapytaj raz. Jeśli klient mówi "nie wiem" albo "nie ma" — twórz bez tego.
Nie przeciągaj rozmowy. Maksymalnie 4-5 pytań łącznie.

## FORMAT OPISU (wypełnij sam, klient tego nie widzi)

## Cel zadania
[Co ma być zrobione i po co]

## Szczegóły
[URL, platforma, co dokładnie się dzieje / co zmienić]

## Termin i poziom
[Termin słownie. Poziom w postaci "P2 (usterka drobna), potwierdzony przez klienta".
Jeżeli klient obstawał przy innym poziomie, niż wynika z definicji, dopisz drugą
linię: "Klient wybrał P1, definicja wskazuje P3". Zespół musi widzieć rozbieżność,
bo od poziomu zależy czas reakcji.]

## Zgłaszający
Klient: ${input.portalName}

Odpowiadaj TYLKO po polsku. Pisz krótko — jak SMS, nie jak mail.`
}
