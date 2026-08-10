# SitePing w panelu admina: konfiguracja, instrukcja, test i log

**Data:** 2026-08-10
**Status:** zaakceptowany projekt, przed planem wdrożenia

## Problem

SitePing jest wdrożony i działa, ale **nie ma go w panelu w ogóle**. `portals.siteping_enabled` i `portals.site_domains` istnieją w bazie, `PATCH /api/admin/portals` je przyjmuje, a jedyny sposób ustawienia to curl z tokenem. Karta projektu pokazuje checkboxy zakładek portalu i formularz marki; SitePing nie należy do `PortalFlags`, bo to nie zakładka, tylko widget na cudzej stronie.

Skutki, wszystkie zgłoszone przez Łukasza:

1. **Nie da się włączyć ani wyłączyć funkcji z panelu.**
2. **Nie ma instrukcji osadzenia.** Kod trzeba za każdym razem szukać po repo.
3. **Nie ma jak sprawdzić, czy u klienta działa.** Pytanie „czemu zgłoszenia nie dochodzą" nie ma dziś żadnej odpowiedzi poza wejściem na serwer.
4. **Nie ma logów.** Odrzucone żądania nie zostawiają śladu nigdzie poza `console.*` na serwerze.

Do tego dochodzi rzecz odkryta przy projektowaniu: **nie istnieje poprawna instrukcja, którą dałoby się dziś wkleić klientowi**, bo nie ma skąd wziąć pliku widgetu (patrz niżej).

## Zakres

Cztery kawałki, w tej kolejności. Punkt 1 jest warunkiem sensu pozostałych.

1. Serwowanie widgetu z portalu
2. Sekcja SitePing w „Konfiguracji"
3. Test połączenia
4. Log diagnostyczny w nowej zakładce „SitePing"

Poza zakresem: wspólne konta portal↔widget (osobna, wcześniejsza decyzja z `project_siteping_clickup`, wymaga tokenów i zmiany w widgecie), edycja zgłoszeń z panelu widgetu (PATCH/DELETE świadomie zamknięte).

## 1. Serwowanie widgetu z portalu

Dziś `@siteping/widget@0.10.7` jest w **devDependencies** i służy wyłącznie stronie testowej `scripts/siteping-manual-test.html`, która ładuje go z `/node_modules/...`. To działa tylko lokalnie. `public/` jest pusty.

**Decyzja: bundle serwuje portal**, pod stałym adresem `https://portal.important.is/siteping/widget.js`.

- `@siteping/widget` przechodzi do `dependencies` (jest teraz zależnością produkcyjną, bo serwujemy jego artefakt).
- Krok budowania kopiuje `node_modules/@siteping/widget/dist/index.global.js` do `public/siteping/widget.js`. Kopiowanie, nie import: to plik statyczny dla cudzych stron, nie moduł naszej aplikacji.
- Plik waży ~468 KB.

Odrzucone alternatywy:

- **Publiczny CDN (unpkg/jsdelivr)**: zero pracy, ale strona klienta zaczyna zależeć od cudzego serwisu, a każda zmiana wersji oznacza obejście wszystkich klientów z prośbą o edycję kodu na ich stronach.
- **Klient hostuje u siebie**: najszybsze ładowanie i pełna niezależność, ale każda aktualizacja to mail i czekanie, a przy kilku klientach kilka różnych wersji naraz.

Przy wyborze „z portalu" aktualizacja wersji u wszystkich idzie jednym deployem portalu. Gdy portal nie działa, widget się nie załaduje, ale wtedy i tak nie działałby endpoint przyjmujący zgłoszenia, więc nie tracimy nic poza kosmetyką.

### Świadoma rezygnacja z Subresource Integrity

Snippet **nie zawiera** `integrity="sha384-…"`, i to jest decyzja, nie przeoczenie.

SRI i wybrana strategia hostingu wykluczają się nawzajem. Hosting z portalu wybraliśmy po to, żeby aktualizować widget u wszystkich klientów jednym deployem, bez proszenia kogokolwiek o edycję kodu na stronie. SRI przypina konkretny hash pliku: po naszym deployu przeglądarka odmówiłaby wykonania nowego bundla u każdego klienta naraz, aż wszyscy podmieniliby hash u siebie. Zamienilibyśmy cichą aktualizację na jednoczesną awarię widgetu wszędzie.

Klasyczny argument za SRI dotyczy skryptów z **cudzego** CDN, gdzie nie kontrolujemy hosta. Tutaj hostem jesteśmy my, na tym samym serwerze, który odbiera zgłoszenia i który klient już musi darzyć zaufaniem.

Ryzyko, które przez to zostaje, nazywam wprost: **przejęcie `portal.important.is` oznacza możliwość wykonania dowolnego kodu na stronach wszystkich klientów z widgetem**, czyli więcej niż samo przejęcie naszego endpointu. Środkiem zaradczym jest ochrona serwera i tego, kto może wgrać plik do `public/`, a nie SRI.

Gdyby to ryzyko kiedyś przeważyło, drogą wyjścia jest **wersjonowany adres** (`/siteping/widget-0.10.7.js`) razem z SRI — wtedy aktualizacja i tak wymaga obejścia klientów, więc jest to świadoma zamiana wygody na kontrolę, a nie darmowy zysk.

## 2. Sekcja SitePing w „Konfiguracji"

Miejsce: `AdminPanel` → zakładka projektu → **Konfiguracja**, między rzędem checkboxów „Zakładki w portalu" a `PortalConfigForm`.

Zawartość:

- **Przełącznik włącz/wyłącz** (`sitepingEnabled`), zapis przez istniejące `PATCH /api/admin/portals`, tą samą trasą co flagi zakładek.
- **Pole domen** (`siteDomains`): nazwy hostów po przecinku, opcjonalnie z portem, bez `https://` i bez ścieżki. Walidacja już istnieje po stronie trasy i **zostaje bez zmian** — to pole jest jednocześnie allowlistą `Origin` dla `/api/siteping/[slug]`, więc rozluźnienie go byłoby zmianą bezpieczeństwa, nie kosmetyką.
- **Ostrzeżenie o tagu**, widoczne zanim ktokolwiek kliknie przełącznik.
- **Kod do wklejenia**, zwijany, z przyciskiem kopiowania.
- **Test połączenia**, zwijany, z przyciskiem.

### Kod do wklejenia

Generowany per projekt, z wypełnionym slugiem i adresem produkcyjnym:

```html
<script src="https://portal.important.is/siteping/widget.js"></script>
<script>
  window.SitePing.initSiteping({
    endpoint: 'https://portal.important.is/api/siteping/wdf',
    projectName: 'wdf',
    enableScreenshot: true,
    // WYMAGANE, nie opcjonalne: bez tego link „Zobacz na stronie"
    // z zadania w ClickUpie otworzy stronę i niczego nie podświetli.
    deepLink: true,
    // Zbiera ostatnie wpisy z konsoli i nieudane żądania z chwili zgłoszenia.
    // PRZECZYTAJ OSTRZEŻENIE NIŻEJ zanim włączysz u klienta.
    captureDiagnostics: true,
  })
</script>
```

Pod spodem zdanie „wklej przed `</body>`" i trzy ostrzeżenia:

- **`captureDiagnostics` zbiera konsolę strony klienta.** Może tam być cokolwiek, co ta strona loguje, łącznie z danymi jego użytkowników, a adresy nieudanych żądań niosą pełny query string. Treści odpowiedzi widget nie zbiera. To decyzja klienta, nie nasza: instrukcja mówi to wprost i pokazuje, że wystarczy usunąć tę linię.
- **Tag `siteping` musi istnieć w przestrzeni ClickUp tego klienta, zanim włączysz flagę.** ClickUp po cichu pomija nieznane nazwy tagów: zadanie powstaje bez tagu, a wtedy przestają działać dedup i odczyt zgłoszeń, bez jednego błędu gdziekolwiek.
- **`deepLink: true` jest wymagane**, powtórzone poza komentarzem w kodzie, bo komentarze w kopiowanym snippecie bywają usuwane.

Globalna nazwa w bundlu IIFE to `window.SitePing`, wielkie `P`.

## 3. Test połączenia

Przycisk, **nie test automatyczny**: sprawdzenie wychodzi na zewnątrz (strona klienta oraz API ClickUpa), więc uruchamianie go przy każdym otwarciu panelu spowalniałoby panel i generowało ruch na cudze serwery bez powodu.

Nowa trasa `GET /api/admin/siteping/check?slug=…`, cztery niezależne sprawdzenia:

| Co | Skąd | Uwagi |
|---|---|---|
| Flaga włączona | baza | trywialne |
| Domeny ustawione | baza | bez nich endpoint jest zamknięty niezależnie od flagi |
| Tag `siteping` w przestrzeni | `GET /space/{id}/tag` w ClickUpie | wymaga nowej funkcji `getSpaceTags` w `lib/clickup.ts` |
| Widget na stronie | pobranie HTML **każdej** domeny z listy + historia zgłoszeń z `audit_log` | dwa sygnały, patrz niżej |

Domeny sprawdzamy **wszystkie**, nie tylko pierwszą: projekt ma zwykle stronę produkcyjną i staging, a widget osadzony na jednej, a brakujący na drugiej to typowy stan po wdrożeniu i dokładnie to, co ten test ma wyłapywać. Wynik jest per domena.

**Trzy stany, nie dwa.** Każde sprawdzenie zwraca `ok`, `fail` albo `unknown`. `unknown` znaczy „nie udało się sprawdzić" (strona nie odpowiedziała, ClickUp zwrócił błąd, przekroczony czas) i jest pokazywane jako `—`, nigdy jako `✗`. Zlanie tych dwóch stanów wysyłałoby szukać nieistniejącego problemu.

**Jedno nieudane sprawdzenie nie przerywa pozostałych.** Każde jest opakowane osobno; pełny wynik jest zawsze czterowierszowy.

**Dlaczego dwa sygnały na widget.** Samo pobranie HTML kłamie w obie strony: strona budowana po stronie przeglądarki, CDN z cache albo skrypt wstrzykiwany przez GTM dadzą fałszywe „nie ma", a to gorsze niż brak testu. Sama historia zgłoszeń nic nie powie o świeżo skonfigurowanym kliencie, u którego nikt jeszcze nic nie zgłosił, czyli akurat wtedy, gdy pytanie jest najpilniejsze. Razem dają odpowiedź, którą da się przeczytać: „skrypt jest i zgłoszenia idą", „skryptu nie widzę, ale zgłoszenia były trzy dni temu, więc pewnie GTM albo zniknął przy wdrożeniu", „nic i nigdy".

Pobranie strony ma **limit czasu 5 sekund** i nie podąża za przekierowaniami poza domenę z listy.

## 4. Log diagnostyczny

Nowa zakładka **„SitePing"** obok „Poczta", spójnie z `ProjectSyncLog` i `ProjectMailLog`. Treść montowana dopiero po wejściu w zakładkę, jak pozostałe.

### Tabela `siteping_log`

Migracja `0016`.

```
id            uuid pk
portal_id     uuid not null → portals(id) on delete cascade
created_at    timestamp not null default now()
method        text not null
status        integer not null       -- 201, 400, 403, 429, 500
outcome       text not null          -- ok | origin_not_allowed | rate_limited
                                     -- | invalid_payload | misconfigured | error
origin        text                   -- nagłówek Origin żądania
ip_prefix     text                   -- trzy oktety, np. "89.64.12"
duration_ms   integer
clickup_task_id text                 -- gdy powstało zadanie
detail        text                   -- treść błędu albo nazwa zadania
```

Indeks na `(portal_id, created_at desc)`.

**Zapis obejmuje wszystkie wyjścia z trasy `/api/siteping/[slug]`**, także te wczesne: odrzucony origin i rate-limit kończą się dziś `return` bez żadnego śladu, a to one odpowiadają na „czemu klientowi nie działa".

### Prywatność i retencja

- **IP skracane do trzech oktetów** przy zapisie (`89.64.12.x`). Pełny adres to dane osobowe, a trzymanie ich bezterminowo w logu diagnostycznym wymagałoby uzasadnienia, którego nie mamy. Trzy oktety wystarczą, żeby odróżnić „jeden klient bije w kółko" od „ruch z wielu miejsc".
- **Retencja 30 dni.** Czyszczenie dopięte do `GET /api/cron/task-index`, który już chodzi cyklicznie i jest jedynym cronem uruchamianym częściej niż raz w tygodniu. Bez nowego wpisu w crontabie na serwerze: każdy nowy wpis to kolejna rzecz, o której trzeba pamiętać przy odtwarzaniu maszyny, a kasowanie starych wierszy nie potrzebuje własnego harmonogramu.

### Dlaczego osobna tabela, a nie `audit_log`

Udane zgłoszenia **zostają** w `audit_log` (`source: 'siteping'`, z adresem strony i danymi zgłaszającego) i nic się w tym nie zmienia. To zdarzenie biznesowe: kto co zgłosił. `siteping_log` jest zapisem technicznym: co się stało z żądaniem HTTP. Panel pokaże jedno i drugie razem, ale trzymanie ich w jednej tabeli oznaczałoby, że retencja 30 dni kasuje klientowi historię zgłoszeń.

## Testy

Jednostkowe:

- budowanie snippetu: poprawny slug i adres, obecność `deepLink: true`
- skracanie IP: IPv4 do trzech oktetów, IPv6 obcięte, brak adresu nie wywala zapisu
- klasyfikacja wyniku sprawdzenia na `ok`/`fail`/`unknown`, w szczególności że błąd sieci daje `unknown`, nie `fail`

Integracyjne, na `cp-test-pg`:

- zapis do `siteping_log` dla każdego rodzaju wyjścia z trasy
- retencja kasuje starsze niż 30 dni i tylko je
- log jednego portalu nie wycieka do drugiego

Komponentowe:

- sekcja SitePing renderuje ostrzeżenie o tagu także przy wyłączonej fladze
- wynik `unknown` pokazuje się jako `—`, nie jako `✗`

## Ryzyka

- **Pobranie strony klienta z naszego serwera** to ruch wychodzący na cudzą infrastrukturę, inicjowany kliknięciem admina. Limit czasu i brak podążania za przekierowaniami poza allowlistę ograniczają to do jednego żądania na kliknięcie.
- **Bundle 468 KB serwowany z Hetznera** przy każdym wejściu na stronę klienta, który ma widget. Nagłówki cache są tu istotne, nie opcjonalne.
- **Instrukcja pokazuje `captureDiagnostics: true`.** To domyślne włączenie zbierania konsoli cudzej strony. Ostrzeżenie musi być widoczne przy kodzie, nie w osobnym miejscu, bo snippet będzie kopiowany bez czytania reszty.
