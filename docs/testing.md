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
| Komponentowe | `**/*.test.tsx` | render w jsdom: „czy klient to zobaczy" | ~0,5 s |
| Integracyjne | `tests/integration/` | prawdziwy Postgres: SQL, sesje, granice | ~1 s |
| Budowanie | `next build` | to, czego nie widzi ani `tsc`, ani test | ~4 s |

Środowisko jest `node` **domyślnie**, bo jsdom kosztuje kilkaset milisekund na
plik. Pliki komponentów włączają je same, blokiem `// @vitest-environment jsdom`
w pierwszej linii.

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

**Wszystkie 32 trasy API mają test.** Podział na pliki:

| Plik | Co obejmuje |
|---|---|
| `routes.clickupTasks` | lista zadań, szczegóły, komentarze |
| `routes.portal` | załączniki, alarm, powiadomienia, pomysły |
| `routes.auth` | logowanie w projekcie i ze strony głównej, wylogowanie, hasło z zaproszenia, reset |
| `routes.admin` | perymetr, logowanie admina, konta użytkowników, zaproszenia |
| `routes.adminPanel` | portale (POST/PATCH), linki, zdarzenia, rejestr maili, log synchronizacji, foldery i listy ClickUpa, historia osoby, potwierdzenie alarmu |
| `routes.webhook` | webhook ClickUpa |
| `routes.cron` | indeks Historii, zamrażanie godzin |
| `routes.siteping` | publiczny endpoint widgetu |
| `routes.aiChat` | brama czatu i narzędzie tworzenia zadania |
| `apiSession` | brama sesji, ścieżka sukcesu i wszystkie odmowy |

Poza tym: brama sesji (`apiSession`), logowanie i wygasanie sesji, zaproszenia
z testem wyścigu, indeks Historii, raporty czasu, powiadomienia, pomysły,
poczta, cron, cache, SitePing.

**Perymetr admina jest sprawdzany pętlą** po liście tras w `routes.admin.test.ts`.
Dopisując trasę pod `/api/admin/`, dopisz ją do tej listy — trasa, której tam
nie ma, nie ma sprawdzonego perymetru.

## Komponenty

Testowane: `usage` (cegiełki widoków zużycia), `AdminLoginScreen`, `TaskDrawer`.

Trzy rodzaje rzeczy, których warto tu pilnować, bo żadna inna warstwa ich nie
widzi:

1. **Co komponent wysyła na serwer.** `TaskDrawer` wołał trasę komentarzy bez
   `?slug=` i to był błąd widoczny dla użytkownika. Test „oba wywołania niosą
   slug" jest jego parą po stronie przeglądarki.
2. **Czy da się w to trafić bez myszy.** Przyciski ikonowe bez `aria-label` są
   dla czytnika ekranu nierozróżnialne. Wyszło przy pisaniu testu, który nie
   potrafił wskazać żadnego z dwóch przycisków po nazwie.
3. **Czy treść od klienta jest tekstem, a nie kodem.** Opis zadania przechodzi
   przez własny renderer znaczników (`MarkdownLite`), więc React nie chroni tu
   automatycznie wszystkiego.

**Czego celowo NIE testujemy komponentami:** układu, klas Tailwinda, kolorów.
Test, który sprawdza `className`, psuje się przy każdej zmianie stylu i nie mówi
nic o tym, czy interfejs działa.

## Czego NIE MA — stan na 2026-08-07

**Warstwa API jest pokryta w całości** (32 z 32 tras).

**Moduły `lib/` bez własnego pliku testowego:** `adminUser`, `passwordNotice`,
`timeSnapshots`, `projectLinksStore`, `portalScopeStore`, `portalSession`,
`admin-auth`, `notificationStore`, `portalEvents`, `clickup`.

Ta lista wygląda gorzej niż jest: wszystkie te moduły są przechodzone przez
testy tras, część intensywnie (`admin-auth` przez perymetr, `portalEvents`
przez sprawdzanie wpisów w `audit_log`, `clickup` przez granice folderu i list).
Czego brakuje, to testów **ich własnych przypadków brzegowych** — takich, do
których przez trasę się nie dojdzie.

**Komponentów wciąż nietestowanych jest więcej niż testowanych.** `AdminPanel`
(753 linie), `KanbanBoard`, `ChatWindow`, `HistoryTable`, `PortalConfigForm`
i formularze admina nie mają testów. To jest największa pozostała dziura.

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

**`createTestUser` wstawia atrapę hasha**, której `bcrypt.compare` nigdy nie
potwierdzi. Do testów sesji to wystarcza, ale test logowania na takim koncie
sprawdzałby wyłącznie, że złe hasło nie wpuszcza, i przechodziłby także wtedy,
gdyby dobre hasło też nie wpuszczało. Do logowania służy
`createTestUserWithPassword`.

**Hasło zapisane nie znaczy hasło działające.** Po ustawieniu hasła testem
sprawdź je **logowaniem**, a nie oglądaniem hasha w bazie: hash może wyglądać
poprawnie i mimo to nigdy nie pasować.

**Trasy cronowe chodzą po WSZYSTKICH aktywnych portalach**, także po prawdziwych
(Onyx, WDF, EFF) siedzących w tej samej bazie. W ich testach wszystko, co
zapisuje (`writeSnapshots`, `syncPortalIndex`, `recordCronRun`), musi być
podstawione — inaczej test dopisuje wiersze do danych klientów i do dziennika
synchronizacji widocznego w panelu.

**Ładunek SitePinga ma sztywny kontrakt** i brak dowolnego pola kończy się 400,
zanim cokolwiek dojdzie do sklepu: `projectName`, `type`, `message`, `url`,
`viewport`, `userAgent`, `authorName`, `authorEmail`, `clientId`, `annotations`.
Pułapka: `viewport` na górnym poziomie jest **napisem** (`"1280x800"`), a wewnątrz
anotacji to płaskie `viewportW`/`viewportH`. Gotowy kształt jest w
`routes.siteping.test.ts` (`zgloszenie()`) i w `clampPayload.test.ts`.

**Limit częstotliwości SitePinga żyje w pamięci modułu.** Bez
`resetRateLimits()` w `beforeEach` poprzedni test zjada budżet następnemu,
a porażka wygląda jak źle działająca brama.

**`audit_log` i `ai_usage` gromadzą wpisy przez cały plik.** Testy dzielą jeden
portal, a atrapy zwykle oddają wszędzie to samo id zadania, więc liczenie
wierszy po `resourceId` policzy też cudze. Nadaj w takim teście własny,
losowy identyfikator.

**Nazwy kolumn sprawdź w schemacie, nie zgaduj.** W tej sesji zgadywanie
kosztowało trzy przebiegi: `portal_lists.display_name` (nie `name`),
`mail_log.ok` (nie `status`), tabela `user_invites` (nie `invites`).

## Pisząc nowy test

1. Nazwa mówi, co ma być prawdą, nie co robi kod: „klient portalu A nie pobierze
   zadań portalu B", nie „test GET tasks".
2. Komentarz mówi **dlaczego to jest ważne**, najlepiej przez opis awarii, której
   test pilnuje. Test bez powodu zostanie kiedyś skasowany jako niewygodny.
3. Odmowa idzie w parze z przejściem.
4. Sprawdzaj też, czego kod **nie zrobił**: że przy braku uprawnień ClickUp nie
   został w ogóle zawołany. Wyciek do procesu jest wyciekiem, nawet gdy
   odpowiedź to 403.
