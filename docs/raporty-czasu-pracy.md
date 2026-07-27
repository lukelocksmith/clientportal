# Raporty czasu pracy: co powstało i jak z tym żyć

Notatka do powrotu po czasie. Stan na **2026-07-27**, wdrożone na `portal.important.is`, **wyłączone na wszystkich portalach**.

Projekt i uzasadnienia decyzji: [`superpowers/specs/2026-07-26-raporty-time-tracking-design.md`](superpowers/specs/2026-07-26-raporty-time-tracking-design.md).
Plan wdrożenia krok po kroku: [`superpowers/plans/2026-07-26-raporty-time-tracking.md`](superpowers/plans/2026-07-26-raporty-time-tracking.md).

---

## 1. Co klient widzi

Zakładka **Raporty** w headerze portalu, obok Tablicy. Strona `/[slug]/raporty` pokazuje:

- przełącznik **Tydzień / Miesiąc**, strzałki w przeszłość, lista 12 ostatnich okresów pod etykietą daty
- kartę **Łącznie** z sumą godzin
- tabelę: nazwa zadania, status, czas
- na końcu tabeli pozycję **Organizacja pracy i komunikacja wewnątrz zespołu projektowego...** ze statusem „zrobione", równą 10% czasu zadań

Czego klient **nie** widzi: podziału na osoby, nazw list, bieżącego niezamkniętego okresu.

Okres siedzi w URL, więc da się podesłać link do konkretnego tygodnia:

```
/onyx/raporty?typ=tydzien&okres=2026-W29
/onyx/raporty?typ=miesiac&okres=2026-06
```

Cokolwiek niepoprawnego w URL cicho wraca do ostatniego zamkniętego tygodnia, bez 404, żeby podesłany link nigdy nie umarł.

---

## 2. Jak włączyć i wyłączyć

Zakładka jest za flagą `portals.reports_enabled`, **domyślnie `false`**. Nowy portal startuje bez raportów.

**Z panelu:** `portal.important.is/admin`, checkbox „Raporty" przy nazwie projektu.

**Z terminala:**

```bash
# włącz
curl -X PATCH https://portal.important.is/api/admin/portals \
  -H "Authorization: Bearer $ADMIN_API_TOKEN" \
  -H 'Content-Type: application/json' \
  -d '{"slug":"onyx","reportsEnabled":true}'

# wyłącz
curl -X PATCH https://portal.important.is/api/admin/portals \
  -H "Authorization: Bearer $ADMIN_API_TOKEN" \
  -H 'Content-Type: application/json' \
  -d '{"slug":"onyx","reportsEnabled":false}'

# stan wszystkich portali
curl -s https://portal.important.is/api/admin/portals \
  -H "Authorization: Bearer $ADMIN_API_TOKEN"
```

Wyłączenie działa na trzech poziomach: zakładka nie renderuje się w headerze, przy jednej pozycji cała nawigacja znika, a wejście na `/[slug]/raporty` przekierowuje na tablicę. **Brama jest po stronie serwera**, więc ręczne wpisanie adresu nic nie da.

---

## 3. Skąd biorą się liczby

Jedno wywołanie ClickUp na wejście na stronę:

```
GET /team/{CLICKUP_TEAM_ID}/time_entries
    ?start_date=<ms>&end_date=<ms>
    &folder_id=<clickup_folder_id portalu z bazy>
    &assignee=<id wszystkich członków workspace>
```

Trzy rzeczy, które łatwo zgubić przy refaktorze i które są w kodzie opisane komentarzami:

1. **`assignee` jest obowiązkowe.** Bez tego parametru ClickUp zwraca wyłącznie wpisy właściciela tokena. Ten sam zakres dat: 1 wpis bez `assignee`, 72 wpisy z listą wszystkich sześciu członków.
2. **`folder_id` jest granicą bezpieczeństwa między klientami.** Folder pochodzi z rekordu portalu w bazie, nigdy z URL-a. Izolacja jest wymuszona w zapytaniu do ClickUp, nie filtrowaniem odpowiedzi u nas.
3. **Odrzucamy `duration <= 0` i wpisy bez zadania.** Uruchomione stopery mają ujemny `duration`, a stoper odpalony poza zadaniem ma `task_location.folder_id` równe `null`. Oba przypadki wystąpiły w prawdziwych danych.

**Nie używamy tabeli `task_time_snapshots`.** Ma unikalny indeks `(portal, task)` i piątkowy cron nadpisuje w niej kumulatywny `time_spent`, czyli historii tam nie ma i nigdy nie będzie. `time_entries` daje pełną historię wstecz, więc raporty działały od pierwszego dnia.

---

## 4. Narzut 10% za organizację pracy

Raporty rozliczeniowe w Notion (CRM → Baza → Płatności, baza `płatnosći important`) doklejają do każdego projektu pozycję równą **10% zsumowanego czasu zadań** i to jest podstawa faktury. Portal robi to samo, żeby klient nie widział w portalu innej liczby niż na fakturze.

**Zaokrąglanie w dół do pełnych minut, nie zaokrąglanie.** Potwierdzone na pięciu projektach za czerwiec 2026:

| Projekt | Czas zadań | Narzut w Notion | 10% |
|---|---|---|---|
| Instytut TUS | 990 min | 99 min | 99,0 |
| Onyx | 1237 min | 123 min | 123,7 |
| WDF | 8258 min | 825 min | 825,8 |
| Elko Kazanów | 485 min | 48 min | 48,5 |
| IGTSF | 97 min | 9 min | 9,7 |

Przy zwykłym zaokrąglaniu 48,5 dałoby 49 i portal rozjechałby się z fakturą o minutę na części projektów. Reguła siedzi w `overheadFor()` w `src/lib/timeReports.ts`, a te pięć wartości jest w skrypcie weryfikacyjnym, więc zmiana logiki od razu wywali test.

---

## 5. Znana rozbieżność, do poprawy poza portalem

**Generator raportów rozliczeniowych w Notion liczy granice okresu w UTC, portal liczy je w `Europe/Warsaw`.**

Wpis czasu startujący 30 czerwca o 22:59 UTC to w Warszawie 1 lipca o 00:59. Notion wrzuca go do czerwca, portal do lipca.

| Projekt (czerwiec 2026) | Portal | Faktura | Różnica |
|---|---|---|---|
| Onyx | 22h 20m | 22h 41m | −21 min (1,5%) |
| WDF | 151h 54m | 151h 23m | +31 min (0,4%) |

Różnica idzie w obie strony, zależnie od tego, po której stronie granicy wypadły wpisy z okolic północy. **Portal liczy poprawnie, do poprawy jest generator.** Warto to zrobić, zanim raporty pokażą się klientowi, który porównuje liczby z fakturą.

---

## 6. Gdzie co siedzi

| Plik | Odpowiedzialność |
|---|---|
| `src/lib/timeReports.ts` | okresy, parsowanie kluczy, agregacja, narzut. Czysta logika, bez Next i bazy |
| `src/lib/clickup.ts` | `getTimeEntries`, `getWorkspaceMemberIds` (cache w module) |
| `src/app/[slug]/raporty/page.tsx` | sesja, brama flagi, walidacja URL Zodem, pobranie danych |
| `src/components/reports/ReportView.tsx` | układ raportu, stan pusty, stan błędu |
| `src/components/reports/PeriodPicker.tsx` | przełącznik i lista okresów, jedyny komponent klienta |
| `src/components/PortalHeader.tsx` | wspólny header tablicy i raportów, zakładki, akcje jako `children` |
| `src/lib/db/migrations/0004_*.sql` | `ALTER TABLE portals ADD COLUMN reports_enabled` |
| `scripts/check-*.ts` | weryfikacja, uruchamiane przez `npx tsx` |

Zmienna środowiskowa, która musi być: **`CLICKUP_TEAM_ID=4552118`**, w `.env.local` i w env aplikacji w Coolify. Bez niej strona raportu pokazuje stan błędu, reszta portalu działa normalnie.

---

## 7. Jak sprawdzić, że nadal działa

W repo nie ma runnera testów, weryfikacja idzie skryptami:

```bash
npx tsx scripts/check-timeReports.ts          # okresy, strefy, przełomy roku i DST
npx tsx scripts/check-buildReport.ts          # agregacja, narzut, zgodność z Notion
npx tsx scripts/check-clickup-time-entries.ts # na żywo, Onyx tydzień 29 = 3h 52m + 23m
```

Wartości odniesienia w skryptach są policzone niezależnie. Dwie najważniejsze asercje:

- **tydzień 23-29 marca 2026 ma 167 godzin**, nie 168, bo zmienia się czas. Implementacja licząca granice w UTC da równe 168 i test ją złapie.
- **suma kolumny Czas równa się liczbie w karcie Łącznie.** Bez tego wychodziły rozjazdy na prawdziwych danych.

Lokalnie:

```bash
docker run -d --name cp-test-pg -e POSTGRES_PASSWORD=postgres \
  -e POSTGRES_DB=clientportal -p 5433:5432 postgres:16-alpine
npm run db:migrate
npm run dev        # next start nie działa z output: standalone
```

---

## 8. Pułapki, które nas kosztowały czas

**Sumy nie zgadzały się z tym, co widać.** Zadania poniżej minuty wypadały z listy, ale ich czas wchodził do sumy, a każdy wiersz był zaokrąglany osobno od sumy, więc przy 110 wierszach reszty się kumulowały. WDF tydzień 29: kolumna dawała 22h 32m przy sumie 22h 34m. Naprawa: **kwantyzacja do pełnych minut u źródła, nie przy wyświetlaniu.** Uwaga, `Math.round(0.5)` w JS daje 1, więc 30 sekund idzie w górę do minuty, tak samo jak w `formatDuration`. Kwantyzacja i wyświetlanie muszą używać tej samej reguły, inaczej rozjazd wraca innymi drzwiami.

**Next rozwija `$ZMIENNA` w plikach `.env`.** Hash bcrypta (`$2b$12$...`) wpisany gołym tekstem dociera do aplikacji obcięty, bo `$2b` i `$12` są traktowane jako referencje. `bcrypt.compare` zwraca wtedy po cichu `false`, więc objaw to „Invalid credentials" bez żadnego błędu w logach. **Apostrofy ani cudzysłowy nie chronią, tylko escape backslashem:** `ADMIN_PASSWORD_HASH=\$2b\$12\$...`. Produkcji nie dotyczy, bo w Coolify zmienne wchodzą przez UI. Sprawdzenie: `node -e "const{loadEnvConfig}=require('@next/env');loadEnvConfig(process.cwd());console.log(process.env.ADMIN_PASSWORD_HASH.length)"` ma dać 60.

**Skrypty muszą leżeć w drzewie projektu.** Node rozwiązuje `node_modules` względem katalogu pliku, nie `cwd`, więc skrypt w katalogu tymczasowym nie zaimportuje nawet `dotenv`.

**`tsx` kompiluje do CJS**, bo projekt nie jest ESM. Brak top-level `await`, wszystko w `main()`. Statyczne importy są hoistowane nad `dotenv.config()`, a `clickup.ts` czyta token w ciele modułu, więc moduły korzystające z env trzeba ładować dynamicznie **wewnątrz** `main()`. Inaczej ClickUp zwraca 401 „Oauth token not found" przy poprawnym tokenie.

**`shadcn init` przepisuje `globals.css`.** Ten projekt ma własny blok `@theme` z tokenami `--color-*`, na których stoi cały portal, więc `components.json` napisaliśmy ręcznie i użyliśmy tylko `shadcn add`. Trzeba było dołożyć brakujące tokeny `--color-popover` i `--color-popover-foreground`, bo `dropdown-menu` ich używa, a motyw ich nie miał. Bez nich lista okresów byłaby przezroczysta.

**Tabela shadcn ma `whitespace-nowrap` na komórkach.** Dwustuznakowa nazwa pozycji narzutu rozpychała tabelę i wypychała kolumny Status oraz Czas za krawędź ekranu. Fix: `table-fixed` na tabeli plus `whitespace-normal` na kolumnie nazwy.

**Coolify API przyjmuje `is_buildtime`, nie `is_build_time`.** Przy `is_build_time` zwraca 422 „This field is not allowed". Po dodaniu zmiennej Coolify sam tworzy drugi wpis z `is_preview: true`.

**Tailwind v4 z Turbopackiem** czasem nie kompiluje nowo dodanych klas na hot reload. Objaw: element bez stylu przy poprawnej klasie w HTML. Fix: zatrzymać dev server, `rm -rf .next`, uruchomić ponownie.

---

## 9. Czego nie zrobiliśmy

- **Drag & drop na tablicy sprawdzony tylko strukturalnie.** Header był wyciągany z `KanbanBoard.tsx`, `git diff` nie dotknął `DndContext`, sensorów ani handlerów, ale nikt nie przeciągnął karty po refaktorze. Przeciągnięcie zapisuje status do ClickUp na prawdziwym zadaniu klienta, dlatego nie testowaliśmy tego automatem.
- **Panel `/admin` nie był klikany w przeglądarce**, bo logowanie oznaczałoby wpisanie hasła w formularz. Przełącznik zweryfikowany end-to-end przez API i przez bramę.
- **Grupowanie po listach.** Raport mailowy grupuje zadania po listach (Instytut TUS ma trzy), portal pokazuje płaską listę, bo nazwy list są przed klientem ukryte. Dla WDF i Onyx bez znaczenia, mają po jednej liście.
- Eksport do PDF i CSV, wykresy, podział na osoby, bieżący okres, klikalne wiersze, wysyłka raportu mailem.

---

## 10. Historia zmian

Jedenaście commitów, zmergowane do `main` jako `7bcff7a`:

```
feat(raporty): okresy raportowe liczone w strefie Warszawy
feat(raporty): agregacja wpisow czasu po zadaniu
feat(raporty): pobieranie wpisow czasu z ClickUp dla folderu klienta
chore(ui): konfiguracja shadcn i komponenty card, table, dropdown-menu
feat(raporty): zakladka Raporty z czasem pracy za wybrany okres
feat(raporty): narzut 10% za organizacje pracy, jak w CRM
fix(raporty): pozycja narzutu ze statusem "zrobione" zamiast metki 10%
feat(raporty): numer tygodnia ISO w etykiecie okresu
refactor(portal): zakladki w gornym rzedzie headera, miedzy logo a akcjami
fix(raporty): kwantyzacja czasu do pelnych minut u zrodla
feat(admin): przelacznik zakladki Raporty per projekt
```

Weryfikacja po wdrożeniu: migracja przeszła, `CLICKUP_TEAM_ID` potwierdzone w kontenerze, oba portale z raportami wyłączonymi, a przy chwilowym włączeniu Onyxa na 2 sekundy tydzień 29 dał 4h 15m i czerwiec 22h 20m, identycznie jak lokalnie.
