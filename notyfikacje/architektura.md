# Powiadomienia — architektura

## Podział na pliki i powód tego podziału

| Plik | Odpowiada za | Zależności |
|---|---|---|
| `src/lib/notifications.ts` | **decyzje**: kto ma dostać i czym | żadnych — czysty |
| `src/lib/notificationStore.ts` | **zapis i odczyt** z bazy | `db`, drizzle |
| `src/app/api/notifications/route.ts` | trasa HTTP: GET, POST, DELETE | brama sesji, store |
| `src/components/NotificationBell.tsx` | dzwonek w nagłówku portalu | fetch, Radix |
| `src/lib/relativeTime.ts` | „5 minut temu" po polsku | żadnych — czysty |

Rozdział `notifications.ts` od `notificationStore.ts` jest celowy i opisany
w nagłówku pierwszego pliku: **cała logika decyzyjna jest czysta**, bez bazy
i bez poczty, bo to jedyny sposób, żeby ją naprawdę sprawdzić. Błąd w regułach
ma dwa objawy i oba są kosztowne — cisza (klient nie wie, że zespół odpisał)
albo zalew (klient wyłącza powiadomienia i wracamy do punktu wyjścia).

## Model danych

Tabela `notifications` (`src/lib/db/schema.ts`):

| Kolumna | Znaczenie |
|---|---|
| `portal_id`, `user_id` | do kogo należy; oba `on delete cascade` |
| `kind` | `comment` \| `status` \| `closed` \| `panic_ack` |
| `clickup_task_id` | może być null (powiadomienie bez zadania) |
| `task_name` | **zdenormalizowana**, żeby powiadomienie przeżyło zniknięcie zadania |
| `payload` | jsonb: autor, wycinek treści, stary i nowy status |
| `read_at` | null = nieprzeczytane |
| `email_sent_at` | null = czeka na zbiorczy mail |

Dwa indeksy: `(user_id, read_at, created_at)` pod licznik i listę oraz
`(user_id, email_sent_at)` pod digest.

Ustawienia użytkownika są w `portal_users`:

- `notify_important` — domyślnie `instant`
- `notify_board` — domyślnie `daily`

## Dwie grupy zdarzeń

`groupOf(kind)` w `notifications.ts` dzieli rodzaje na dwie grupy o różnej
pilności, bo tak ustawia je klient w profilu:

- **`important`** — `comment` i `panic_ack`: rzeczy, na które ktoś czeka
- **`board`** — `status` i `closed`: ruch na tablicy, który przy porządkach
  potrafi lecieć seriami i którego domyślnie nie wysyłamy natychmiast

To rozróżnienie jest powodem, dla którego są dwie kolumny ustawień, a nie
jedna.

## Trasa HTTP

`/api/notifications`, wszystkie metody przez `requirePortalApi` (brama sesji
opisana w `src/lib/apiSession.ts`):

| Metoda | Co robi |
|---|---|
| `GET ?slug=` | lista + licznik nieprzeczytanych |
| `POST` | oznacza przeczytane; `ids` opcjonalne (brak = wszystkie moje) |
| `DELETE` | kasuje wskazane; `ids` **wymagane i niepuste** |

**Dlaczego DELETE jest osobną metodą, a nie flagą w POST:** kasowanie jest
nieodwracalne, więc ma mieć własne wejście, a nie chować się za polem
w żądaniu, które na co dzień tylko oznacza przeczytane.

**Dlaczego `ids` przy kasowaniu jest wymagane:** `markRead` bez `ids` znaczy
„wszystkie moje", ale przy kasowaniu ta sama wygoda oznaczałaby, że jedno
przeoczone `undefined` czyści klientowi całą historię.

### Granica bezpieczeństwa

`markRead` i `deleteForUser` wiążą warunek z `userId` **zawsze**, także gdy
podano `ids`. Identyfikator przychodzi z przeglądarki, więc nie może sam
decydować, czyj wiersz ruszamy. Jest na to test wprost: klient A zna
identyfikator powiadomienia klienta B, kasuje, i nie ginie nic.

### Admin

Sesja admina przeglądającego cudzy portal ma `userId: 'admin'`, czyli nie UUID,
a `notifications.user_id` wskazuje na `portal_users`. Admin nie ma więc i nie
może mieć własnych powiadomień. Trasa zwraca mu `{ adminPreview: true }`
i pustą listę zamiast błędu — podgląd portalu ma działać, tylko dzwonek jest
wtedy pusty.

## Dzwonek

- Odświeżanie **pollingiem co 60 sekund** i przy każdej zmianie adresu.
  Świadomie bez WebSocketów: przy tej skali byłby to drugi kanał transportu do
  utrzymania, a minuta opóźnienia na powiadomieniu, które i tak dubluje maila,
  nikomu nie szkodzi.
- Kliknięcie w pozycję oznacza **tę jedną** jako przeczytaną. Stan lokalny
  zmieniamy od razu, przed odpowiedzią serwera, bo pozycja jest linkiem
  i klient zaraz opuszcza stronę.
- Każda pozycja ma przycisk kasowania, widoczny pod kursorem i przy fokusie
  z klawiatury.
- Pozycja prowadzi na `/{slug}?task={id}`, a kanban otwiera na tym zadaniu
  szufladę.

### Pułapka Radiksa, nie powtarzaj tego błędu

Pozycje listy **muszą** być `DropdownMenuItem` z `asChild`, a nie zwykłym
`<Link>` w `<li>`. Radix zarządza wskaźnikiem i fokusem wewnątrz menu, więc
link postawiony obok tego mechanizmu wygląda na klikalny, ale kliknięcie do
niego nie dochodzi. Zgłoszone przez Łukasza 2026-08-06 jako „nie klikają się
linki".

Z tego samego powodu przycisk kasowania stoi **poza** `DropdownMenuItem`:
Radix traktuje pozycję menu jako jeden cel, więc przycisk zagnieżdżony w niej
wyglądałby na klikalny, a kliknięcie i tak wybrałoby całą pozycję i przeniosło
do zadania. Dodatkowo `preventDefault` na `pointerdown` blokuje domyślne
zamknięcie menu — bez tego pierwsze kasowanie zamykałoby dzwonek.

## Testy

| Plik | Zakres |
|---|---|
| `src/lib/notifications.test.ts` | reguły wyboru odbiorców, czysto |
| `tests/integration/notificationStore.test.ts` | zapis i odczyt na prawdziwym Postgresie |
| `tests/integration/notifications.test.ts` | reguły na prawdziwych danych |
| `tests/integration/routes.portal.test.ts` | trasa: GET, POST, DELETE, izolacja klientów |
| `src/lib/relativeTime.test.ts` | polska odmiana liczebników |

Testy komponentu `NotificationBell` **nie istnieją** — to jedna z dziur
wymienionych w `docs/testing.md`.
