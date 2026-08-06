# Powiadomienia i profil użytkownika

**Data:** 2026-08-06
**Status:** zaakceptowany projekt, przed planem wdrożenia

## Problem

Portal ma jeden kanał wyjścia do klienta: mail przy zaproszeniu i resecie hasła oraz alarm na Discorda. Nie powiadamia o niczym, co dzieje się w zadaniach, więc klient musi sam wejść i sprawdzić, czy zespół odpisał. Przy planie opieki z czasami reakcji zapisanymi w ofercie to obciąża obie strony.

Nie ma też strony profilu. Użytkownik nie może zmienić imienia ani hasła (dziś robi to admin przez token API), nie ma zdjęcia, a po dołożeniu powiadomień nie miałby gdzie ustawić ich częstotliwości.

## Zakres

Dwa powiązane kawałki, jeden spec, bo profil jest nośnikiem ustawień powiadomień i bez niego silnik ma martwy przełącznik.

**A. Profil** `/[slug]/profil`: imię, zdjęcie, zmiana hasła, ustawienia powiadomień.
**B. Powiadomienia**: dzwonek w portalu, maile natychmiastowe i zbiorcze.

Poza zakresem: powiadomienia push, SMS, obserwowanie cudzych zadań, powiadomienia dla zespołu agencji (zespół pracuje w ClickUpie i ma jego własne).

## Decyzja: budujemy, nie migrujemy

Rozważony [Novu](https://novu.co/) (MIT, self-host, in-app inbox, silnik digestów), czyli dokładnie ten przypadek użycia. Odrzucony ze względu na koszt wejścia: self-hosting wymaga MongoDB, dwóch klastrów Redis (queue z włączonym AOF), S3 min. 10 GB i trzech serwisów, minimum 4 vCPU i 8 GB RAM. Portal to jeden kontener Next.js i Postgres na współdzielonym Hetznerze. Dwa nowe silniki baz danych do utrzymania i backupu przy czterech typach zdarzeń i kilkunastu użytkownikach są nieproporcjonalne. Novu Cloud odpada, bo wysyłałby dane klientów na zewnątrz łańcucha kończącego się dziś na naszym mailcowie.

Zamiast tego składamy z klocków, które w projekcie już działają:

| Element | Skąd |
|---|---|
| Odbiór zdarzeń | webhook ClickUpa z HMAC, `api/webhooks/clickup` |
| Wysyłka i rejestr | `lib/mailer.ts`, tabela `mail_log` |
| Szablony | `@react-email/components`, `emails/EmailShell.tsx` |
| Cron | wzorzec `api/cron/*` |
| Awatar UI | `@radix-ui/react-avatar` |
| Kolejka digestów | Postgres, kolumna `email_sent_at` |

Jedyna nowa zależność: `react-easy-crop` do kadrowania zdjęcia.

## Model danych

Migracja `0015`.

### Tabela `notifications`

```
id              uuid pk
portal_id       uuid not null → portals(id) on delete cascade
user_id         uuid not null → portal_users(id) on delete cascade
kind            text not null   -- comment | status | closed | panic_ack
clickup_task_id text
task_name       text not null   -- zdenormalizowane: powiadomienie ma być
                                -- czytelne, gdy zadanie zniknie z ClickUpa
payload         jsonb not null default '{}'
created_at      timestamp not null default now()
read_at         timestamp       -- null = nieprzeczytane, zasila dzwonek
email_sent_at   timestamp       -- null = do wzięcia przez digest
```

Indeks na `(user_id, read_at, created_at desc)` pod dzwonek i na `(user_id, email_sent_at)` pod digest.

`payload` trzyma to, co jest potrzebne do treści i czego nie chcemy dociągać z ClickUpa przy wysyłce: dla `comment` fragment treści i autora, dla `status` stary i nowy status.

Kolejka digestów to `email_sent_at IS NULL`, nie osobna tabela ani Redis.

### Kolumny w `portal_users`

```
avatar_url        text    -- data URI, obraz 256×256 WebP
notify_important  text not null default 'instant'  -- instant | daily | never
notify_board      text not null default 'daily'    -- instant | daily | never
```

`notify_important` obejmuje komentarze `[P]` i potwierdzone alarmy, `notify_board` zmiany statusów i zamknięcia.

## Przepływ

### Powstawanie powiadomień

Webhook ClickUpa już dziś rozpoznaje portal po folderze zadania i indeksuje je do Historii. Dokładamy krok po indeksowaniu: utwórz wiersze `notifications`.

Krok jest odseparowany i opakowany w `try/catch`, tak jak dziś indeksowanie: awaria powiadomień nie może zwrócić błędu z webhooka, bo ClickUp zacząłby ponawiać albo wyłączyłby subskrypcję.

Mapowanie zdarzeń:

| Zdarzenie ClickUpa | `kind` | Warunek |
|---|---|---|
| `taskCommentPosted` | `comment` | tylko komentarze z tagiem `[P]`, reszta to korespondencja wewnętrzna |
| `taskStatusUpdated` | `status` lub `closed` | `closed`, gdy nowy status to `zamknięte` |

Potwierdzony alarm (`panic_ack`) nie pochodzi z ClickUpa: powstaje w trasie `api/panic/[id]/ack`, która już istnieje.

### Kto dostaje

- **Mail**: autor zgłoszenia. Atrybucja istnieje od migracji `0013`.
- **Dzwonek**: wszyscy aktywni użytkownicy portalu.
- **Zadania założone przez agencję**, czyli bez autora z portalu: mail do wszystkich aktywnych. Inaczej ta kategoria nie powiadamiałaby nigdy nikogo.
- **Nieaktywni** (`is_active = false`): nic.
- **Potwierdzony alarm** (`panic_ack`): mail wyłącznie do osoby, która alarm wcisnęła. `panic_alerts.user_id` to zapisuje. Reszta portalu dostaje dzwonek. Alarm jest sprawą konkretnego człowieka, który czeka na reakcję, a nie ogłoszeniem dla całej firmy.

### Tłumienie własnej akcji

Komentarze i zmiany statusu z portalu lecą do ClickUpa przez **jedno konto serwisowe**, więc webhook wraca nierozróżnialny od działania zespołu. Bez tłumienia klient dostawałby powiadomienie o tym, co sam przed chwilą zrobił.

Dwa mechanizmy, różne, bo różnie da się to zrobić pewnie:

**Komentarze, deterministycznie.** `addComment` dostaje z ClickUpa `id` utworzonego komentarza. Portal zapisuje je przy wysyłce, a webhook pomija zdarzenie o tym identyfikatorze. Bez okien czasowych i bez zgadywania.

**Statusy, oknem.** Trasa `PATCH /api/clickup/tasks/[taskId]` loguje nowe zdarzenie `EVENT_STATUS_CHANGED` z autorem, zadaniem i docelowym statusem (dziś zmiana statusu przez klienta nie jest logowana nigdzie, więc to dokładamy). Webhook pomija autora, jeśli w ostatnich dwóch minutach ten sam użytkownik ustawił na tym zadaniu **ten sam status**.

Porównanie wartości statusu, nie samego faktu ruchu, jest tu istotne: samo okno czasowe zjadłoby powiadomienie o zmianie zespołu, gdyby trafiła zaraz po zmianie klienta. Kierunek „klient nie dowiedział się o działaniu zespołu" jest groźniejszy niż „klient zobaczył powiadomienie o sobie", więc tłumienie ma być wąskie.

### Maile natychmiastowe

Wysyłane w momencie tworzenia powiadomienia, jeśli użytkownik ma dla danej grupy `instant`. Idą przez `sendMail`, więc trafiają do `mail_log` i są widoczne w panelu.

### Maile zbiorcze

Nowa trasa `GET /api/cron/notification-digest`, autoryzowana tokenem w query, jak dwie istniejące trasy cronowe.

1. Weź `notifications` z `email_sent_at IS NULL`, których odbiorca ma dla danej grupy `daily`.
2. Pogrupuj po użytkowniku.
3. Wyślij jeden mail: liczba zdarzeń, lista zadań z tym, co się w nich stało, link do portalu.
4. Ostempluj `email_sent_at`.

Krok 4 pilnuje, żeby powiadomienie wysłane natychmiast nie wróciło w digeście i żeby powtórne uruchomienie crona nie wysłało tego samego drugi raz.

Godzina: 17:00 Europe/Warsaw, ta sama strefa co w raportach. Wpis w crontabie na Hetznerze obok Track Time. To jedyna zmiana poza kodem repozytorium.

Pusty zestaw nie wysyła maila.

### Retencja

Cron digestu przy okazji kasuje **przeczytane** powiadomienia starsze niż 90 dni. Bez tego tabela rośnie w nieskończoność.

Nieprzeczytane zostają bez względu na wiek. Kasowanie ich znaczyłoby, że sprawa, której klient nie widział, znika mu z dzwonka po cichu, a to gorsze niż kilka zbędnych wierszy w bazie.

## Interfejs

### Dzwonek

Ikona z licznikiem nieprzeczytanych w `PortalHeader`. Kliknięcie otwiera listę (Radix dropdown, już w zależnościach): zdarzenie, nazwa zadania, kiedy. Kliknięcie pozycji prowadzi do zadania i oznacza jako przeczytane.

Licznik odświeżany przy nawigacji i pollingiem co 60 sekund. Bez WebSocketów: przy tej skali byłby to drugi kanał transportu do utrzymania bez zysku.

### Awatar

Zapis jako data URI w kolumnie, ale **nie w payloadach**. Osobna trasa `GET /api/avatar/[userId]` zwraca obraz z `Cache-Control` i `ETag`, a odpowiedzi API niosą tylko odnośnik. Inaczej lista komentarzy ciągnęłaby dziesiątki kilobajtów przy każdym otwarciu szuflady.

Kadrowanie i skalowanie do 256×256 WebP po stronie przeglądarki (`react-easy-crop` plus canvas), więc serwer dostaje gotowy, mały obraz. Limit przyjmowanego ładunku po stronie trasy mimo to, bo klient nie jest granicą bezpieczeństwa.

### Profil

`/[slug]/profil`, za tą samą bramą sesji co pozostałe zakładki:

- **Imię** — zapis do `portal_users.name`.
- **Zdjęcie** — wgranie, kadrowanie, usunięcie.
- **Hasło** — stare plus dwa razy nowe. Wymóg starego hasła, bo przejęta sesja nie może przejąć konta. Po zmianie leci istniejący `PasswordChangedEmail`.
- **Powiadomienia** — dwie grupy, każda `od razu` / `raz dziennie` / `nigdy`. Pod spodem zdanie, że dzwonek działa zawsze.

W stopce maili powiadomień link „wyłącz powiadomienia" prowadzący do profilu.

## Testy

Jednostkowe, bo tu błąd oznacza ciszę albo spam:

- wybór odbiorców: autor dostaje mail, reszta sam dzwonek, nieaktywni nic, brak autora oznacza mail do wszystkich
- tłumienie: komentarz z portalu nie powiadamia autora, komentarz zespołu powiadamia; zmiana statusu przez klienta nie powiadamia jego, zmiana zespołu na inny status w tym samym oknie powiadamia
- rozdzielenie grup: `notify_board = never` nie blokuje komentarzy
- treść digestu: grupowanie po użytkowniku, liczebniki po polsku (istnieje `lib/plural.ts`)

Integracyjne, na `cp-test-pg`:

- digest nie wysyła dwa razy tego samego
- powiadomienie wysłane natychmiast nie wraca w digeście
- pusty zestaw nie wysyła maila
- retencja kasuje tylko przeczytane starsze niż 90 dni

## Kolejność budowy

1. Migracja `0015` i model.
2. Strona profilu z ustawieniami (bez awatara), zmiana hasła.
3. Tworzenie powiadomień w webhooku, tłumienie, dzwonek.
4. Maile natychmiastowe.
5. Cron digestu i retencja.
6. Awatar.

Awatar jest ostatni, bo jako jedyny nie wpływa na to, czy klient dowie się o odpowiedzi zespołu.

## Ryzyka

- **Webhook to pojedynczy punkt.** Gdy ClickUp nie doręczy zdarzenia, powiadomienia po prostu nie będzie; Historia ma na to tygodniowy przebieg z `force=1`, powiadomienia z natury nie mają czego nadrobić. Akceptujemy: powiadomienie jest wygodą, źródłem prawdy pozostaje tablica.
- **Mail od `portal@important.is` może trafiać do spamu** przy większym wolumenie. DKIM jest ustawiony, ale wolumen rośnie z jednego maila na zaproszenie do kilku dziennie na osobę.
- **Zdarzeń statusów bywa dużo** przy porządkowaniu tablicy. Domyślne `daily` dla tej grupy jest właśnie po to; zmiana domyślnej na `instant` przełożyłaby ten hałas na skrzynki klientów.
