# Architektura portalu klienta

Pełna mapa: co się w portalu dzieje, od czego zależy, po co istnieje.
Stan na **2026-08-31**, sprawdzony na kodzie i na produkcji, nie odtworzony
z pamięci. Wszędzie, gdzie coś jest **niesprawdzone**, jest to napisane wprost.

Skróty w tym dokumencie: „ClickUp" znaczy przestrzeń **WAŻNI Klienci
important.is** (`90100136256`), „baza" znaczy Postgres portalu w Coolify,
„panel" znaczy `/admin`.

---

## 1. Czym portal jest, a czym nie

**Jest** jednym miejscem, w którym klient widzi swoją pracę i może ją zgłosić:
tablica zadań, historia, raport czasu i budżetu, stan strony, czerwony przycisk
Alarm, asystent AI, widget na własnej stronie.

**Nie jest** trackerem zadań zespołu. Zespół pracuje w ClickUpie i to ClickUp
jest źródłem prawdy o zadaniach. Portal jest **warstwą rozmowy z klientem** nad
ClickUpem (kierunek ustalony 09.08.2026: service desk, nie drugi tracker;
odrzucone wtedy Plane, Vikunja, Huly, Zammad).

Konsekwencja tej decyzji przewija się przez cały kod: **nazwy, statusy
i priorytety odwzorowują ClickUpa 1:1** i portal nie wymyśla własnego
słownictwa. Wyjątkiem jest tylko to, czego w ClickUpie nie ma, np. informacja
„po czyjej stronie stoi sprawa" dopisywana pod nazwą kolumny (`statusSide`).

---

## 2. Dwa magazyny i podział pracy między nimi

| | ClickUp | nasza baza |
|---|---|---|
| zadania, statusy, priorytety, załączniki, czas pracy | **źródło prawdy** | lustro (`task_index`) pod Historię i wyszukiwarkę |
| komentarze | źródło | lustro (`task_comments`) + granica `[P]` |
| kto z ludzi klienta co zgłosił | nie wie | **jedyne źródło** (`audit_log`) |
| konta, hasła, sesje, powiadomienia | nie ma | **jedyne źródło** |
| zgłoszenie, którego ClickUp nie przyjął | nie ma | **kolejka** (`pending_reports`) |

Powód lustra: ClickUp nie zwraca komentarzy ani załączników razem z listą
zadań, tylko osobnym zapytaniem na zadanie. Szukanie po komentarzach na żywo
to setki wywołań na jedno wciśnięcie klawisza, czyli rzecz niewykonalna.

Powód `audit_log`: wszystkie zadania z portalu tworzy **jedno konto serwisowe
agencji**, więc pole „autor" w ClickUpie zawsze pokazuje nas. Bez naszej tabeli
nie da się odpowiedzieć na pytanie „kto u klienta to zgłosił".

---

## 3. Warstwy i granice

```
przeglądarka klienta
   │
   ├─ /{slug}/…                    strony (React Server Components)
   │     └─ portalSession.ts       JEDNA brama: sesja + portal + flagi + marka
   │
   ├─ /api/…                       trasy API
   │     └─ apiSession.ts          JEDNA brama tras API (odpowiednik powyższej)
   │
   └─ src/proxy.ts                 nagłówki CSP z nonce, przekierowania bez sesji
              │
        warstwa lib (96 modułów)   reguły osobno, dostęp do danych osobno
              │
   ┌──────────┴───────────────────────────────┐
   ClickUp API              Postgres          poczta SMTP / SMSGate / Discord
   (jeden token na wszystkich klientów)       Gemini · SuperCheck · PageSpeed
```

**Zasada podziału w `lib/`, powtarzana konsekwentnie:** czysta reguła w jednym
pliku, dostęp do bazy w drugim (`portalScope` / `portalScopeStore`,
`notifications` / `notificationStore`, `profile` / `profileStore`,
`projectLinks` / `projectLinksStore`, `panicEscalation` / trasa crona). Dwa
powody, oba twarde:

1. Regułę da się sprawdzić testem bez bazy i bez sieci.
2. Plik importowany przez **komponent kliencki** nie może ciągnąć sterownika
   Postgresa do paczki przeglądarki — ten błąd raz już położył całą aplikację.

---

## 4. Tożsamość i sesje

**Sesje w bazie, nie w JWT.** `sessions.token_hash` to SHA-256 surowego tokenu
z ciasteczka; sam token nie istnieje nigdzie u nas. Ważność **7 dni**.
Wyciek bazy nie daje więc gotowych sesji.

**Logowanie** ma dwa wejścia i jedną regułę: `/{slug}/login` (z marką klienta)
oraz wspólny formularz na stronie głównej (`/api/auth/login-any`). Blokada po
**5 nieudanych próbach na 15 minut** (`loginAttempts.ts`) liczona na koncie
w bazie, więc obowiązuje w obu wejściach.

**Obejście admina:** konto z `ADMIN_EMAIL` + `ADMIN_PASSWORD_HASH` wchodzi do
KAŻDEGO portalu, a `adminUser.ts` dodatkowo zakłada mu prawdziwe konto w każdym
projekcie. Powód: klucze obce (`ai_usage.user_id`) i spójność listy userów.
Sesja admina trwa **8 godzin**, nie 7 dni.

**Zaproszenia:** nowy użytkownik dostaje link z jednorazowym tokenem
(`user_invites`, tylko hash), ważny **72 h**; token resetu hasła **2 h**,
z 10-minutowym odstępem między wysyłkami. **Hasła użytkownika nigdy nie znamy.**

**Panel admina** ma dwie drogi: sesja admina (ciasteczko) albo
`ADMIN_API_TOKEN` w nagłówku — to drugie jest po to, żeby zarządzać portalami
i użytkownikami z terminala, bez przeglądarki.

**Widget SitePing** nie ma sesji i mieć nie może (stoi na cudzej stronie).
Jego tożsamość to **podpisany token** (`siteping/identityToken.ts`, `JWT_SECRET`)
podstawiany przez stronę klienta; pola `authorEmail` z ciała żądania nie wolno
wierzyć i kod tego pilnuje (`assertNotImpersonatingAdmin`).

---

## 5. Granica między klientami

To jest najważniejsza granica w całym systemie i dlatego ma **jedno wejście na
stronę i jedno na trasę API**:

- `portalSession.getPortalForSession(slug)` — strony,
- `apiSession.requirePortalApi(slug)` — trasy API.

Wcześniej ta sama reguła była rozpisana w pięciu wariantach po stronach
i w pięciu po trasach. Pięć kopii granicy bezpieczeństwa to pięć miejsc, gdzie
można się pomylić raz.

**`clickupFolderId` pochodzi ZAWSZE z rekordu portalu w bazie, nigdy z adresu.**

**Zakres portalu (`portal_lists` → `portalScope`)** zawęża folder do wybranych
list. Puste znaczy „cały folder" (zgodność w tył). Dotyczy SZEŚCIU miejsc:
tablicy, trasy listy zadań, raportu czasu, indeksu Historii, zamrażania godzin
i sprawdzania praw do pojedynczego zadania. Wyszło na kliencie EFF, gdzie
folder ma dwie listy i klient widział 62 zadania, z czego 55 z listy, której
nigdy do portalu nie wybraliśmy.

**Zadanie bez informacji o liście jest ODRZUCANE** przy zawężonym zakresie:
przy danych widocznych dla klienta brak potwierdzenia traktujemy jak odmowę.

---

## 6. Cztery kanały zgłoszeń i kolejka

Wszystkie cztery kończą się zadaniem w ClickUpie i wpisem w `audit_log`:

| kanał | trasa | co dokłada |
|---|---|---|
| formularz | `POST /api/clickup/tasks` | stopka z sesji, przypisanie |
| asystent AI | `POST /api/ai/chat` | rozmowa, klasyfikacja P1–P3, tagi, zapis rozmowy |
| Alarm | `POST /api/panic` | tag awarii, dyżurny, trzy kanały powiadomień, drabinka |
| widget SitePing | `POST /api/siteping/[slug]` | zrzut ekranu, zaznaczenie elementu, diagnostyka w załączniku JSON |

**Reguły wspólne, policzone RAZ i w jednym miejscu:** stopka z autorem
(`reporter.ts`), przypisanie (`assignee.ts`: ustawienie projektu → osoba
agencji → nikt), status początkowy `do zrobienia` (nie backlog, żeby zgłoszenie
klienta nie zostało zasypane), tagi (`autoTags.ts`).

### Kolejka (od 31.08.2026)

```
klient → nasza baza (pending_reports) → cron co 2 min → ClickUp
                    ▲
        gdy ClickUp odmówi w chwili zgłoszenia
```

Do 31.08 wszystkie cztery kanały miały **jedno miejsce zapisu: ClickUp**, więc
jego awaria kasowała treść, którą klient nam opisał. Dowód, że to nie teoria:
alarmy z 11.08 i 13.08 mają w bazie `clickup_task_id = NULL`.

Szczegóły, ponawianie, alerty i granice: **`docs/ochrona-zgloszen-i-alarmow.md`**.

Klient widzi porażkę w jednym jedynym przypadku: padł ClickUp **oraz** nasza
baza. Wtedy zgłoszenia nie ma nigdzie i udawanie sukcesu byłoby kłamstwem.

---

## 7. Alarm i eskalacja

1. Wciśnięcie przycisku → wiersz w `panic_alerts` (to jedyne źródło niezależne
   od cudzych usług).
2. Zadanie w ClickUpie, z **twardym limitem 8 sekund**. Dłużej nie czekamy:
   awaria ClickUpa nie może uciszyć alarmu ani kazać klientowi patrzeć
   w kręcące się kółko. Nieudane zadanie idzie do kolejki.
3. Trzy kanały równolegle: **Discord, mail, SMS** (`panicNotify.ts`). Każdy
   zwraca `boolean` „co najmniej jeden odbiorca dostał". To nie kosmetyka:
   wszystkie trzy łykają swoje błędy, więc patrzenie na odrzucone obietnice
   mierzyłoby wyłącznie to, czy kod się wykonał.
4. Padły wszystkie trzy → `notify_failed_at`, alarm operacyjny na Discorda
   i **eskalacja bez czekania na pierwszy próg**.
5. Drabinka przypomnień (`panicEscalation.ts`), minuty od zgłoszenia:
   - dzień: 25, 50, 60, 65, 120, 180, 210, 240
   - noc (Europe/Warsaw): 25, 55, 120, 180, 210, 240
6. „Przejęte" znaczy: przypisany ktoś **inny niż dyżurny** ORAZ zadanie ruszyło
   ze statusu początkowego. Wtedy leci powiadomienie „sprawę wziął X" i alarm
   wypada z kolejki na dobre.
7. Brak zadania w ClickUpie **nie jest powodem do ciszy** — przy alarmie
   niewiedza ma budzić, nie uciszać.

Dyżurny siedzi w zmiennej środowiskowej (`PANIC_ASSIGNEE_CLICKUP_ID`), nie
w kodzie: zmiana dyżuru nie może wymagać deployu.

SMS ma dławik (jedno zgłoszenie na okno czasowe na projekt), bo karta w bramce
to zwykły abonament, a klient w panice wciska przycisk kilka razy. Mail
i Discord idą zawsze.

---

## 8. Powiadomienia

Dwie warstwy decyzji, celowo rozdzielone:

1. **Macierz projektu** (`portals.notification_config`, ustawia admin):
   zdarzenie × kanał (dzwonek / mail). To brama — kanał wyłączony w macierzy
   nie pójdzie do nikogo.
2. **Reguła odbiorców** (`notifications.ts`, czyste funkcje): kto dostaje.
   Zgłaszający, obserwatorzy (`task_watchers`, w interfejsie „Odbiorcy"),
   preferencje osoby (`notify_important`, `notify_board`).

Producent (`notifyProducer.ts`) zamienia zdarzenie na wiersze w dzwonku
i maile. Powstał 24.08.2026, bo cała maszyneria istniała, była przetestowana
i **nikt jej nie wołał** — zielone testy nie dowodzą, że coś jest wywoływane.

Źródła zdarzeń: webhook ClickUpa (zmiana statusu, komentarz zespołu), akcje
klienta w portalu, cron indeksu.

`notified_events` chroni przed dubletem: webhook przychodzi wiele razy
i szybciej niż nasz własny zapis, więc SELECT-przed-INSERT nie jest
zabezpieczeniem — potrzebny jest warunek na unikalności.

**Granica `[P]`:** klient widzi komentarz zespołu tylko wtedy, gdy ktoś
oznaczył go prefiksem `[P]` (albo `[PUBLIC]`). Prefiks może stać w dowolnym
miejscu treści. Komentarz bez prefiksu **nigdy nie wchodzi** do kolumny
`search_text` w lustrze, a nie jest tylko ukrywany przy wyświetlaniu.

---

## 9. Zakładki i flagi per projekt

- **Zakładki** (`portalTabs.ts`): kanban, dashboard, raporty, historia, chat.
  Flaga w bazie + `implemented` w kodzie, żeby panel nie pokazywał ptaszka do
  strony, której nie ma.
- **Funkcje niebędące zakładkami** (`portalFeatures.ts`): pozostała estymacja,
  zmiana statusu i kolumna „zamknięte", widget SitePing, stan strony.

Powstało 25.08, bo dwie flagi dały się przestawić WYŁĄCZNIE curlem po API.
Funkcja niewidoczna w panelu jest z punktu widzenia człowieka funkcją, której
nie ma. **Nowa flaga dopisuje się do jednej listy i pojawia się w panelu sama.**

Zasada wdrożeniowa: nowa funkcja jest na produkcji **domyślnie wyłączona**,
brama stoi po stronie serwera (ukrycie zakładki to kosmetyka — adres musi być
zamknięty także dla kogoś, kto wpisze go z ręki), a włączenie klientowi jest
osobną decyzją.

---

## 10. Cache i unieważnianie

`clickupCache.ts`, `unstable_cache`, **45 sekund**, klucz = `folderId` +
zakres list, tag = `clickup-folder-tasks-<folderId>`.

Dlaczego nie `revalidate` na segmencie: strona kanbanu czyta ciasteczko sesji,
więc jest renderowana dynamicznie i `export const revalidate` NIE MA tam
żadnego efektu. Stało w kodzie i wyglądało jak działające buforowanie, a każde
wejście na tablicę robiło całą serię wywołań ClickUpa (zmierzone: 1279–1739 ms
kanban wobec ~300 ms pozostałych zakładek).

Buforujemy DANE, nie stronę: sesja zostaje poza cache'em, więc wynik da się
bezpiecznie dzielić między użytkowników jednego klienta.

**`invalidateFolderTasks` wołamy po KAŻDEJ zmianie, którą klient zobaczy.**
Bez tego cache byłby pogorszeniem: klient przeciąga kartę, odświeża i widzi
stan sprzed własnej akcji. „Nie zapisało się" jest gorsze niż „wolno się
wczytuje". W Next 16 `revalidateTag` wymaga drugiego argumentu i używamy
`{ expire: 0 }`, a nie `'max'` — profile typu `max` dają „oddaj stare, odśwież
w tle", czyli dokładnie to, czego tu nie chcemy.

---

## 11. Raporty, czas i pieniądze

Jeden ekran „Czas i budżet" (od 28.08): trzy liczby na górze i **jedna** tabela
zamiast dwóch list z tymi samymi zadaniami.

- Okresy liczone jawnie w **Europe/Warsaw** przez TZDate, nie w strefie serwera.
- Czas z ClickUpa filtrujemy u siebie do zakresu list portalu, bo ClickUp
  filtruje wpisy czasu tylko po folderze. Bez tego raport zawierał godziny
  z list, których do portalu nie wybraliśmy — a to liczba, którą klient
  porównuje z fakturą.
- Stoper odpalony poza zadaniem (`list_id = null`) NIE wchodzi do raportu przy
  zawężonym zakresie.
- **Track Time jest zamrożony** (cron w piątek rano → `task_time_snapshots`),
  żeby klient nie widział liczby tykającej w trakcie patrzenia.
- Kwoty w **groszach**, stawka netto z CRM w Notionie, `null` znaczy „nie
  znamy" i wtedy raport pokazuje same godziny. Zgadnięta kwota obok faktury
  byłaby gorsza niż jej brak. Przy kwocie zawsze stoi słowo „netto".
- Narzut 10% za organizację pracy jest osobnym wierszem, na końcu.

---

## 12. Historia, indeks i wyszukiwarka

`task_index` to lustro zadań folderu: nazwa, status, licznik komentarzy
publicznych, licznik załączników i `search_text`. Zapełnia je cron
`task-index` (codziennie 6:20, budżet zadań na przebieg) oraz webhook.

Normalizacja tekstu pod szukanie jest w Node, nie w Postgresie — dzięki temu
baza nie potrzebuje rozszerzenia `unaccent`, a więc i praw superusera na
produkcyjnym Postgresie w Coolify.

Historia obejmuje też zadania **zamknięte**, których kanban nie pobiera.

---

## 13. SitePing: widget na cudzej stronie

Zgłoszenie z widgetu na stronie klienta → zadanie w ClickUpie z tagiem
`siteping` + tag rodzaju, z zaznaczonym elementem, zrzutem ekranu
i **pełną diagnostyką w załączniku JSON** (ClickUp jest tu magazynem: portal
odtwarza rekord ze zadania i tego załącznika).

Pułapki, wszystkie zapłacone: tag nieistniejący w przestrzeni ClickUpa jest
**po cichu pomijany** (dlatego rodzaj jest też w opisie i dlatego cztery tagi
trzeba założyć ręcznie przed włączeniem klientowi flagi); bundle widżetu musi
być wyjęty z bramy sesji w `proxy.ts`, inaczej skrypt na cudzej stronie dostaje
307 na ekran logowania; `site_domains` projektu jest **jednocześnie** listą
dozwolonych źródeł (Origin) i wejściem dla monitoringu stanu strony.

---

## 14. Stan strony (Dashboard)

Trzy kafle: **dostępność** (SuperCheck, `tests.important.is`), **wynik testów**,
**szybkość ładowania** (PageSpeed Insights). Za flagą `monitoringEnabled`,
token SuperChecka per projekt (`sck_live_…`, zapisywany tylko do zapisu, nigdy
nie wychodzi z serwera).

Cache: 15 minut dla SuperChecka, 24 h dla PageSpeeda. Brak danych mówi „brak
danych" i **nigdy nie pokazuje 0%**.

Dwie rzeczy warte pamiętania: API SuperChecka odpowiada inaczej, niż mówi jego
własna dokumentacja (realny kształt `data.period30d`), a wynik PageSpeeda
domyślnie dotyczy **telefonu z dławionym łączem**, więc liczba „11 s" obok
„98/100 na komputerze" nie jest sprzecznością.

---

## 15. Tabele (22) — kto pisze, kto czyta

| tabela | pisze | po co |
|---|---|---|
| `portals` | panel admina | projekt: folder, przestrzeń, flagi, marka, stawka, macierz |
| `portal_lists` | panel admina | zakres portalu i lista domyślna dla nowych zadań |
| `portal_users` | panel, `auth`, `invites`, `profileStore` | konta klienta, hasła (bcrypt), preferencje |
| `sessions` | `auth` | sesje (hash tokenu), urządzenie, wygaśnięcie |
| `user_invites` | `invites` | zaproszenia i resety hasła (hash tokenu, TTL) |
| `audit_log` | `portalEvents`, `portalIdeas` | **kto z ludzi klienta co zgłosił** |
| `pending_reports` | `pendingReports` | kolejka zgłoszeń, gdy ClickUp odmówi |
| `panic_alerts` | trasa alarmu, cron eskalacji, kolejka | alarm, licznik eskalacji, przejęcie, brak powiadomienia |
| `notifications` | `notificationStore` | dzwonek w portalu |
| `notified_events` | `notificationStore` | ochrona przed dubletem powiadomienia |
| `task_watchers` | `taskWatchers` | „Odbiorcy" zadania |
| `task_comments` | `taskComments` | lustro rozmowy + granica `[P]` |
| `task_index` | `taskIndex` | Historia i wyszukiwarka |
| `task_status_history` | `statusHistory` | kto i kiedy zmienił status (webhook + portal) |
| `task_time_snapshots` | `timeSnapshots` | zamrożony Track Time (piątek) |
| `ai_usage` | trasa czatu | tokeny i koszt per projekt/osoba/model |
| `ai_chat_logs` | trasa czatu | **pełny zapis rozmowy** z wynikiem |
| `cron_runs` | `cronRuns` | przebiegi cronów + alarm przy porażce |
| `mail_log` | `mailer` | każdy mail, do kogo i czy doszedł |
| `sms_log` | `sms` | każdy SMS |
| `portal_links` | `projectLinksStore` | linki projektu na Dashboardzie |
| `siteping_log` | `siteping/log` | ruch z widgetu, do diagnozy |

36 migracji, katalog `src/lib/db/migrations`. **Migracja musi być odporna na
bazę inną niż lokalna**: `IF NOT EXISTS`, więzy w `DO $$ … EXCEPTION WHEN
duplicate_object`. Bazy postawione przez `db:push` nie mają nazw więzów, które
generuje migrator, a jedno polecenie z błędem przerywa całą migrację
i **kontener nie wstaje** (awaria 14.08.2026).

---

## 16. Crony i kto je NAPRAWDĘ woła

| zadanie | co robi | częstotliwość | **wołane przez** |
|---|---|---|---|
| `panic-escalation` | drabinka przypomnień o alarmach | co 5 min | **zadanie cykliczne Coolify** `eskalacja-alarmow`: `wget http://127.0.0.1:3000/…` |
| `pending-reports` | dowozi zgłoszenia z kolejki | co 2 min | **crontab roota** na 65.21.75.39 (publiczny adres) |
| `task-index` | lustro zadań i komentarzy | 6:20 codziennie, 6:40 w sobotę pełny | crontab roota |
| `time-snapshot` | zamrożenie Track Time | piątek 7:00 | crontab roota |

Sprawdzone 31.08 przez bazę Coolify (`scheduled_tasks`) po wykluczeniu
crontabów wszystkich użytkowników i kontenerów, n8n, UptimeRobota, timerów
systemd, GitHub Actions, Mac mini i harmonogramu w aplikacji. **API Coolify
podaje `scheduled_tasks: null`, więc po API tego nie widać** — trzeba zapytać
bazę Coolify.

**Rozjazd wart uporządkowania:** eskalacja idzie po `127.0.0.1` (nie zależy od
proxy ani od domeny), dowożenie kolejki po adresie publicznym (zależy od
Cloudflare i proxy). Dwa mechanizmy dla dwóch cronów tej samej aplikacji.

Ochrona przed dubletem przebiegu: `pg_try_advisory_lock` na nazwie zadania
(`cronLock.ts`). Dubel eskalacji to podwójny SMS budzący ludzi w nocy, dubel
dowożenia to dwa zadania z jednego zgłoszenia.

**Czego crony nie umieją:** zauważyć, że przestały być wołane. Alarmują tylko
wtedy, gdy się wykonają i nie udadzą. Dlatego istnieje
`GET /api/health/zgloszenia` — werdykt tekstowy `OK` / `PROBLEM` (+503) dla
czujnika Z ZEWNĄTRZ. **Dziś nikt tego adresu nie odpytuje**, więc jest to
strona, na którą nikt nie patrzy.

---

## 17. Zewnętrzne zależności

| usługa | po co | co się dzieje, gdy padnie |
|---|---|---|
| **ClickUp API** | zadania, komentarze, czas, załączniki | tablica z cache'u do 45 s, potem błąd; nowe zgłoszenia idą do kolejki |
| **Postgres** (Coolify) | wszystko nasze | portal nie działa; zgłoszenia nie ma gdzie zapisać |
| **SMTP** (mailcow) | powiadomienia, zaproszenia, alarmy | wpis w `mail_log` z `sent: false`; alarm szuka innych kanałów |
| **SMSGate** (`sms.important.is`, telefon z SIM) | SMS alarmowy | kanał wypada, mail i Discord zostają |
| **Discord webhook** | kanał `#alarmy`, alarmy operacyjne cronów | ślad tylko w logach kontenera |
| **Gemini** (`gemini-2.5-flash`) | asystent zgłaszający | zapas: OpenAI `gpt-4o-mini` przy powtórce z `fallback` |
| **SuperCheck** (`tests.important.is`) | dostępność i testy na Dashboard | kafel mówi „brak danych", nigdy 0% |
| **PageSpeed Insights** | szybkość ładowania | jak wyżej |
| **Notion** (CRM) | stawki godzinowe klientów | stawka `null` → raport bez kwot |
| **Cloudflare** | przed portalem | uwaga: odpowiedź z cache nie jest odpowiedzią aplikacji |

**Jeden token ClickUpa obsługuje wszystkich klientów** (limit 100 zapytań/min),
dlatego pętle po zadaniach mają wymuszone przerwy (`CLICKUP_SYNC_DELAY_MS`,
domyślnie 800 ms → ~75/min, z zapasem na ruch użytkowników).

Sekrety: `.env.local` lokalnie, zmienne środowiskowe aplikacji w Coolify na
produkcji, klucze infrastruktury w `~/.claude/keys.env`. **Token SuperChecka
i hasła nigdy nie wychodzą z serwera w odpowiedzi API** (panel dostaje tylko
`hasSupercheckToken`).

Zmienne używane w kodzie (38): od `DATABASE_URL`, `CLICKUP_API_TOKEN`,
`JWT_SECRET`, `ADMIN_*`, `CRON_SECRET`, przez `PANIC_*`, `SMTP_*`,
`SMSGATE_*`, po `PAGESPEED_API_KEY`, `SUPERCHECK_URL`, `NOTION_API_TOKEN`.

---

## 18. Wdrożenie

GitHub → Coolify (aplikacja `n6iy8x0epg8wx1zwe222oh2r`, `portal.important.is`).
**Push sam NIE uruchamia deployu — webhook nie działa (11.08)**, trzeba kopnąć
przez API Coolify. Kontener startuje w kolejności: migracje → serwer.

Po deployu z migracją **pierwsze spojrzenie idzie w logi kontenera**, nie
w adres publiczny, i szuka OBJAWU AWARII, nie sygnału sukcesu (awaria 14.08:
przez jedenaście minut pętla czekała na kod 401 z nowego endpointu, nie
widząc, że kontener wstaje i pada w pętli).

Backup bazy: harmonogram dzienny **3:00** w Coolify, założony 28.08 —
wcześniej produkcyjna baza portalu **nie miała żadnych backupów**. Sprawdzone
31.08: trzy ostatnie przebiegi `success`, rozmiar rośnie zdrowo
(943 574 → 979 026 B), czyli backup naprawdę się wykonuje, a nie tylko jest
zaplanowany.

**Strefa czasowa produkcyjnej bazy: UTC** (sprawdzone 31.08:
`show timezone` → UTC). Kontener aplikacji też chodzi w UTC. To ważne, bo
aplikacja zakłada UTC przy wygasaniu zaproszeń; pod `Europe/Warsaw` trzy testy
zaproszeń padają i wygasły token bywa przyjmowany. Granice okresów raportowych
są liczone jawnie w Europe/Warsaw i to jedyne miejsce, które nie zależy od
strefy serwera.

---

## 19. Pułapki, które już nas kosztowały

| kiedy | co | wniosek |
|---|---|---|
| 03.03 | zmiana routingu bez czytania dokumentacji | najpierw stan obecny, potem zmiana |
| 05.08 | statusy w ClickUpie przemianowane, kolumny kanbana rozjechane | lista kolumn i kolory w JEDNYM pliku |
| 11.08 | webhook deployu Coolify nie działa | push ≠ deploy |
| 11.08 | cache Cloudflare maskował fatal 500 | pytaj o ścieżkę, której cache nie dotyka |
| 13.08 | kubelet k3s kontra Coolify — cała produkcja leżała 2× | — |
| 14.08 | migracja bez `IF EXISTS` → kontener w pętli restartów | migracje odporne + logi od razu po deployu |
| 14.08 | minifikator zjadł zagnieżdżoną funkcję eskalacji (`ReferenceError`) | zielone testy nie dowodzą, że kod przetrwa build |
| 24.08 | producent powiadomień istniał i nikt go nie wołał | sprawdź, KTO to woła |
| 24.08 | `{...obiekt}` z ClickUpa wyciekł prywatne maile zespołu | wylicz, co wychodzi do klienta |
| 24.08 | webhook przychodzi wiele razy i szybciej niż nasz zapis | unikalność, nie SELECT-przed-INSERT |
| 28.08 | test karty z datami wpisanymi na sztywno padł sam z siebie | daty w testach względem „dziś" |
| 30.08 | zgłoszenie przez asystenta zniknęło bez śladu | zapis rozmowy; „rozmowa" przy „dodałem" to błąd |
| 31.08 | alarmy bez zadania, wynik wysyłki wyrzucany do kosza | czytaj WYNIK, nie brak wyjątku |

---

## 20. Czego nie wiemy i co jest długiem

1. **Nikt nie odpytuje `/api/health/zgloszenia`.** Dopóki nie stanie tam czujka
   z zewnątrz, zatrzymany cron zostaje niewidoczny.
2. **Okno na duplikat zadania** w kolejce: gdy ClickUp założy zadanie, a
   odpowiedź do nas nie dojdzie, dowieziemy je drugi raz. Przyjęte świadomie.
3. **Załącznik JSON SitePinga nie przechodzi przez kolejkę** (wymaga
   istniejącego zadania), więc dowiezione zgłoszenie z widgetu ma diagnostykę
   tylko w skrócie, w opisie.
4. **Dwa mechanizmy wołania cronów** (Coolify vs crontab, localhost vs adres
   publiczny) — warte ujednolicenia.
5. **`onyx` nie ma wpisanych domen**, więc monitoring nie ma czego dopasować;
   `wdf` ma domenę, ale wyłączony monitoring. Ta sama kolumna jest listą
   dozwolonych źródeł SitePinga, więc zmiana dotyka dwóch rzeczy naraz.
6. **`cron_runs` rośnie bez czyszczenia**: ~720 wierszy dziennie z samego
   dowożenia kolejki. Nie boli dziś, zaboli za rok.
7. Limiter w pamięci procesu (`memoryRateLimit`) przestaje działać przy
   wielu instancjach aplikacji. Dziś jest jedna.

---

## 21. Jak ten dokument był sprawdzany

Nie jest przepisany z pamięci. Każda liczba w nim ma źródło w kodzie albo
w pomiarze na produkcji, sprawdzone 31.08.2026:

- **Z kodu, dopasowaniem wzorca:** cache 45 s, sesja 7 dni, sesja admina 8 h,
  blokada 5 prób / 15 minut, zaproszenie 72 h, reset 2 h, obie drabinki
  eskalacji, limit 8 s na ClickUpa w alarmie, podpis webhooka
  (`timingSafeEqual`), blokada crona (`pg_try_advisory_lock`), przerwa 800 ms
  w pętli po zadaniach, `expire: 0` przy unieważnianiu cache'u, brak tokenu
  SuperChecka w odpowiedzi API.
- **Z inwentarza repozytorium:** 41 tras API, 12 stron, 22 tabele,
  96 modułów `lib`, 36 migracji, mapa trasa → moduły, mapa tabela → kto pisze.
- **Z produkcji:** strefa czasowa bazy (UTC), skonfigurowane kanały alarmowe,
  wołający eskalacji (baza Coolify), przebiegi backupów z rozmiarami,
  działanie kolejki i endpointu zdrowia.

Czego ten dokument NIE dowodzi: zachowania rzeczy, których nie da się
sprawdzić statycznie. Zachowanie asystenta AI mierzą trzy skrypty pomiarowe
(`docs/testing.md`), a droga zgłoszeń ma osobny opis wraz z tym, co się dzieje
przy awarii (`docs/ochrona-zgloszen-i-alarmow.md`).
