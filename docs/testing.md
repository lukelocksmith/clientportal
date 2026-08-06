# Testy portalu

**Zasada: każda rzecz, która może wpuścić klienta do cudzych danych albo skłamać
mu w twarz liczbą, ma mieć test. Bez wyjątków i bez „to oczywiste".**

Ten dokument mówi, jak testujemy, co jest pokryte, a czego NIE MA — bo lista
dziur jest ważniejsza od listy sukcesów. Zielony wynik testów, które nie
dotykają danej ścieżki, wygląda dokładnie tak samo jak zielony wynik testów,
które ją sprawdzają.

## Trzy warstwy, każda po coś innego

| Warstwa | Gdzie | Co sprawdza | Czas |
|---|---|---|---|
| Jednostkowe | `src/**/*.test.ts` | czysta logika, zero zależności | ms |
| Integracyjne | `tests/integration/` | prawdziwy Postgres: SQL, sesje, granice | ~1 s |
| Budowanie | `next build` | to, czego nie widzi ani `tsc`, ani test | ~4 s |

Trzecia warstwa nie jest formalnością. Błąd, który raz położył całą aplikację
(sterownik postgresa wciągnięty do paczki przeglądarki), był **niewidoczny dla
`tsc` i byłby niewidoczny dla testu komponentu**, bo wszystkie funkcje działały
poprawnie. Złapał go bundler. Dlatego `next build` jest częścią `npm run verify`,
a nie opcją.

## Uruchamianie

```bash
npm test                  # wszystko; integracyjne SAME SIĘ POMIJAJĄ bez bazy
npm run test:unit         # tylko src/, w milisekundach, dobre do trybu watch
npm run test:integration  # tylko tests/integration, wymaga bazy
npm run verify            # tsc + eslint + testy + build — przed każdym pushem
```

Baza do testów integracyjnych:

```bash
docker start cp-test-pg   # Postgres na porcie 5433
```

`DATABASE_URL` testy czytają z `.env.local`. **Wskazanie tam produkcji oznacza
uruchomienie na żywych danych testów, które tworzą i kasują portale.** Każdy test
integracyjny pracuje na własnym portalu o losowym slugu i kasuje go po sobie,
ale to zabezpieczenie chroni cudze dane w tej samej bazie, nie chroni przed
wskazaniem złej bazy.

`npm run lint` skanuje też katalogi spoza `src`, w tym pozostawione worktree
z ich `.next`. Gdy sypie tysiącami błędów, sprawdź `npx eslint src tests`.

## Co jest pokryte

**Trasy API wywołane wprost, jako funkcje** (`tests/integration/routes.*.test.ts`).
Podstawione jest wyłącznie wyjście na świat: ClickUp, poczta, Discord. Postgres,
sesje, ciasteczka, HMAC admina i zapis do `audit_log` są prawdziwe.

| Trasa | Metody |
|---|---|
| `/api/clickup/tasks` | GET, POST |
| `/api/clickup/tasks/[taskId]` | GET, PATCH |
| `/api/clickup/tasks/[taskId]/comments` | GET, POST |
| `/api/clickup/tasks/[taskId]/attachments` | POST |
| `/api/panic` | POST |
| `/api/notifications` | GET, POST |
| `/api/portal-ideas` | POST |

Poza tym: brama sesji (`apiSession`), logowanie i wygasanie sesji, zaproszenia
z testem wyścigu, indeks Historii, raporty czasu, powiadomienia, pomysły,
poczta, cron, cache, SitePing.

## Czego NIE MA — stan na 2026-08-07

**25 z 32 tras API nie ma żadnego testu.** Najważniejsze braki, w kolejności
ryzyka:

| Brak | Dlaczego to boli |
|---|---|
| `/api/auth/*` (login, set-password, forgot-password) | to jest **wejście do systemu**; logika logowania ma testy przez `lib/auth`, ale sama trasa, jej limity prób i kształt odpowiedzi nie |
| `/api/admin/*` (13 tras) | zakładanie portali i użytkowników, czyli miejsce, w którym da się nadać komuś dostęp do cudzego projektu |
| `/api/cron/*` | liczby, które klient widzi jako „dane na dzień X"; `lib/` pod spodem ma testy, pętla po portalach nie |
| `/api/webhooks/clickup` | wejście z zewnątrz, przyjmuje cudzy payload |
| `/api/ai/chat` | strumień i providerzy; brama ma test, samo narzędzie tworzenia zadania nie |
| `/api/siteping/[slug]` | publiczny endpoint bez sesji; `lib/siteping` ma 38 testów, trasa nie |

**Moduły `lib/` bez testu:** `admin-auth`, `adminUser`, `apiAuth`,
`loginAttempts`, `passwordNotice`, `team`, `timeSnapshots`, `historyParams`,
`projectLinks`, `projectLinksStore`, `aiPricing`, `portalScopeStore`,
`portalSession`.

`portalSession` i `admin-auth` są pokryte pośrednio, przez testy bramy i sesji,
ale własnych nie mają.

**Komponentów Reacta nie testujemy w ogóle.** Zmiana w `AdminPanel`,
`TaskDrawer` czy `KanbanBoard` jest sprawdzana wyłącznie przez `tsc` i `next
build`, czyli nikt nie sprawdza, czy panel się rysuje. To jest świadoma dziura,
nie przeoczenie — ale przy każdej większej zmianie w tych plikach trzeba to
kliknąć albo dopisać test.

## Testowanie na żywym ClickUpie

Do testów, które muszą dotknąć prawdziwego ClickUpa, służy **projekt testowy
„arena akcji"**:

- lista: `901212252101`
- przestrzeń: `90100136256`
- workspace: `4552118`

**Nigdy nie testuj na folderze klienta.** Zadania testowe zakładane u Onyxu, WDF
czy EFF widzi klient na swoim kanbanie i zespół w swojej kolejce.

Przed włączeniem SitePinga komukolwiek: tag `siteping` musi wcześniej istnieć
w przestrzeni klienta, bo ClickUp po cichu gubi nieistniejące tagi.

## Pułapki, które już nas kosztowały

**Pominięty test wygląda jak zaliczony.** Gdy `beforeAll` się wywali, vitest
raportuje `20 skipped`, a nie `failed`. Podobnie `it.skipIf(!process.env.X)` przy
brakującej zmiennej. **Przy testach granic bezpieczeństwa uruchamiaj
`--reporter=verbose` i policz `✓`**, zamiast czytać samo podsumowanie.

**Odmowa z powodu awarii wygląda jak odmowa z powodu reguły.** Test, który
sprawdza tylko 401, przechodzi także wtedy, gdy trasa jest zepsuta i odmawia
wszystkim. Dlatego **każdy test odmowy ma parę dowodzącą, że ta sama
konfiguracja przepuszcza uprawnionego**.

**Zmienne środowiskowe przeciekają między plikami testów.** Pliki chodzą
sekwencyjnie w jednym procesie (`fileParallelism: false`, bo dzielą bazę). Test,
który ustawia `process.env.X`, musi przywrócić poprzednią wartość w `afterAll`.

**Stałe modułu czytają `process.env` raz, przy imporcie.** Test porównujący
zachowanie „zmienna ustawiona" i „zmienna pusta" musi przeładować moduł
(`vi.resetModules()` + ponowny import), a nie liczyć na jeden statyczny import.

**`vi.fn(async () => …)` zawęża typ wywołań.** TypeScript wywnioskuje sygnaturę
bezargumentową i `mock.calls[0][0]` przestanie istnieć. W fabrykach `vi.hoisted`
używaj gołego `vi.fn()`, a implementację dowiązuj w `beforeEach`.

**Portal bez list działa na CAŁYM folderze.** Test granicy list musi jawnie
utworzyć listę (`createTestList`), inaczej sprawdza przypadek „brak zawężenia"
w przekonaniu, że sprawdza zawężenie.

## Pisząc nowy test

1. Nazwa mówi, co ma być prawdą, nie co robi kod: „klient portalu A nie pobierze
   zadań portalu B", nie „test GET tasks".
2. Komentarz mówi **dlaczego to jest ważne**, najlepiej przez opis awarii, której
   test pilnuje. Test bez powodu zostanie kiedyś skasowany jako niewygodny.
3. Odmowa idzie w parze z przejściem.
4. Sprawdzaj też, czego kod **nie zrobił**: że przy braku uprawnień ClickUp nie
   został w ogóle zawołany. Wyciek do procesu jest wyciekiem, nawet gdy
   odpowiedź to 403.
