# Zakładka Raporty: statystyki time trackingu dla klienta

Data: 2026-07-26
Status: zaakceptowany, gotowy do planu wdrożenia

## Cel

Klient portalu ma zobaczyć, ile czasu zespół zalogował na jego zadaniach w wybranym zamkniętym tygodniu lub miesiącu. Model mentalny: raport, jaki wysłalibyśmy na koniec tygodnia.

## Decyzje i ich uzasadnienie

| Decyzja | Uzasadnienie |
|---|---|
| Źródłem danych jest ClickUp `time_entries`, nie tabela `task_time_snapshots` | Snapshoty mają unikalny indeks `(portal, task)` i cron robi `onConflictDoUpdate`, czyli nadpisuje kumulatywny `time_spent`. Historii tam nie ma i delty rozjeżdżałyby się przy każdej ręcznej korekcie czasu w ClickUp. `time_entries` daje pełną historię wstecz, więc raporty działają od pierwszego dnia. |
| Bez podziału na osoby, tylko zadania | Spójne z wcześniejszą decyzją o ukryciu assignees i nazw list w widoku klienta. Klient dostaje odpowiedź na pytanie "na co poszły godziny", bez wglądu w to, kto ile pracował. |
| Tylko zamknięte okresy, bieżącego nie ma | Track Time celowo nie jest live. Klient nie ma widzieć liczby, która rośnie mu w trakcie oglądania. Bieżący okres nie pojawia się ani na liście, ani przez ręcznie wpisany URL. |
| Przełącznik Tydzień/Miesiąc plus strzałki | Jeden mechanizm pokrywa wszystkie przypadki: poprzedni tydzień to jedna strzałka, jeszcze poprzedni to dwie. Do skoków dalej w przeszłość lista dwunastu ostatnich okresów pod etykietą daty. Bez kalendarza, obsługiwalne kciukiem. |
| Osobna strona z zakładkami w headerze | Raport ma własny URL, więc da się podesłać klientowi link do konkretnego okresu. Dane pobierane na serwerze. Zostaje miejsce na kolejne sekcje. |
| shadcn tylko na nowej stronie | Portal już stoi na fundamencie shadcn (Radix, `cva`, `clsx`, `tailwind-merge`, `cn()`, cztery komponenty w `src/components/ui/`), brakuje wyłącznie `components.json`. Nowa strona jest odcięta od kanbanu, więc jest bezpiecznym miejscem na pilotaż bez ryzyka regresji w drag&drop, drawerze i czacie. |

## Źródło danych

```
GET /team/{CLICKUP_TEAM_ID}/time_entries
    ?start_date=<ms>&end_date=<ms>
    &folder_id=<clickup_folder_id portalu z bazy>
    &assignee=<id wszystkich członków workspace, po przecinku>
```

Ustalenia sprawdzone empirycznie na folderze Onyx (`90129337912`, workspace `4552118`). Wszystkie trzy trafiają do kodu jako komentarze, bo każde z nich jest niecodzienne i łatwo je przy refaktorze zgubić:

1. **`assignee` jest obowiązkowe.** Bez tego parametru ClickUp zwraca wyłącznie wpisy właściciela tokena. Ten sam zakres dat zwrócił 1 wpis bez `assignee` i 72 wpisy z listą wszystkich sześciu członków. Lista id pobierana raz z `GET /team` i trzymana w pamięci procesu.
2. **`folder_id` jest granicą bezpieczeństwa.** Folder pochodzi z rekordu portalu w bazie, nigdy z URL-a. Izolacja klienta jest wymuszona po stronie zapytania do ClickUp, a nie filtrowaniem odpowiedzi w naszym kodzie.
3. **Odrzucamy wpisy z `duration <= 0` oraz bez zadania.** Uruchomione stopery mają ujemny `duration`, a stopery odpalone poza zadaniem mają `task_location.folder_id` równe `null`. Taki wpis wystąpił w prawdziwych danych (2,9 sekundy).

Agregacja: `duration` przychodzi jako string, konwertowany do liczby, sumowany po `task.id`, sortowanie malejąco po sumie. Pole `user` jest ignorowane.

Zadania z sumą poniżej jednej minuty wypadają z raportu. Powód: istniejący `formatDuration` zwraca dla nich pusty string, więc wiersz miałby puste pole Czas. Suma całkowita liczona jest z wszystkich wpisów, także tych krótkich, żeby zgadzała się z ClickUp.

## Nowy moduł: `src/lib/timeReports.ts`

Czysta logika, bez zależności od Next i bazy, dzięki czemu daje się sprawdzić skryptem.

```ts
type PeriodKind = 'tydzien' | 'miesiac'

interface Period {
  kind: PeriodKind
  key: string        // '2026-W29' albo '2026-07'
  label: string      // '13-19 lipca 2026 (tyg. 29)' albo 'czerwiec 2026'
  startMs: number
  endMs: number
}

interface ReportRow {
  taskId: string
  taskName: string
  status: string
  durationMs: number
}

interface TimeReport {
  period: Period
  totalMs: number
  rows: ReportRow[]   // malejąco po durationMs
}
```

Funkcje:

- `listPeriods(kind, count = 12, now = new Date()): Period[]` zwraca wyłącznie zamknięte okresy, najnowszy pierwszy.
- `parsePeriodKey(kind, key): Period | null`, zwraca `null` dla okresu bieżącego, przyszłego i niepoprawnego klucza.
- `formatPeriodLabel(period): string`, etykiety po polsku.
- `buildReport(period, entries): TimeReport`, agregacja opisana wyżej.

**Strefa czasowa.** Kontener na Coolify chodzi na UTC, a granice tygodnia muszą być liczone w `Europe/Warsaw`. Bez tego poniedziałek przed godziną 2:00 wpada do poprzedniego tygodnia i sumy nie zgadzają się z ClickUp. Granice liczone jawnie w strefie Warszawy przez `date-fns-tz` (dochodzi do obecnego `date-fns`), nie przez ambientny `TZ` procesu, żeby wynik nie zależał od konfiguracji hosta.

## Zmiany w `src/lib/clickup.ts`

Dwie nowe funkcje, w konwencji istniejącego `clickupFetch`:

- `getTimeEntries(folderId, startMs, endMs): Promise<ClickUpTimeEntry[]>`
- `getWorkspaceMemberIds(): Promise<string[]>` z cache w module

Zamknięty okres się nie zmienia, ale ktoś może dopisać czas wstecz, więc na `fetch` dla wpisów czasu ustawiamy `revalidate: 300`.

Nowy typ `ClickUpTimeEntry` w `src/lib/types.ts`, z polami faktycznie zwracanymi przez API: `id`, `duration` (string), `start`, `end`, `task` (`id`, `name`, `status`), `task_location` (`list_id`, `folder_id`, `space_id`), `user`.

## Strona: `src/app/[slug]/raporty/page.tsx`

Server Component, ten sam wzorzec co istniejące `src/app/[slug]/page.tsx`:

1. `getSession(slug)`, przekierowanie na `/[slug]/login` gdy brak sesji lub slug się nie zgadza.
2. Odczyt portalu z bazy po slugu, `redirect('/')` gdy nie istnieje.
3. Odczyt i walidacja `searchParams` Zodem: `typ` w zbiorze `tydzien | miesiac`, `okres` jako klucz okresu.
4. Cokolwiek niepoprawnego, brakującego albo wskazującego na okres bieżący lub przyszły leci na ostatni zamknięty tydzień. Bez 404, żeby podesłany link nigdy nie umarł.
5. Pobranie wpisów, `buildReport`, render.

URL: `/onyx/raporty?typ=tydzien&okres=2026-W29`.

## Zmiana w istniejącym kodzie: `PortalHeader`

Header portalu (awatar, nazwa, email użytkownika) jest dzisiaj wklejony w środek `src/components/kanban/KanbanBoard.tsx`, w liniach 173-204, razem ze stanem tablicy. Zakładki muszą pojawić się na obu stronach, więc część tożsamościową i nawigację wyciągamy do `src/components/PortalHeader.tsx`, przyjmującego akcje po prawej stronie jako `children`.

- Kanban przekazuje jako `children` swoje przyciski: Alarm, Nowe zadanie, odświeżenie.
- Raporty nie przekazują nic.
- Aktywna zakładka rozpoznawana po `usePathname`.

Około 30 przeniesionych linii. To jedyny istniejący plik komponentu, który zmieniamy. Header nie może wejść do `[slug]/layout.tsx`, bo pod tym layoutem siedzi też strona logowania.

## Wygląd i pilotaż shadcn

Dodajemy `components.json` i ściągamy wyłącznie `card`, `table`, `tabs`. Przełącznik Tydzień/Miesiąc na `Tabs`, lista okresów na już zainstalowanym `@radix-ui/react-dropdown-menu`, wiersze na `Table`, suma na `Card`. Istniejące komponenty w `src/components/ui/` zostają nietknięte, shadcn dokłada pliki obok.

Układ ekranu:

```
Onyx
[ Tablica ] [ Raporty ]        (prawa strona headera pusta,
                                akcje tablicy zostają na tablicy)
─────────────────────────────────────────────────────────────────
Raport czasu pracy

[ Tydzień | Miesiąc ]          ◀  13-19 lipca 2026  ▶

┌───────────────────────────────────────────────────────────────┐
│  Łącznie                                             3h 52m   │
└───────────────────────────────────────────────────────────────┘

Zadanie                                       Status      Czas
[onyx] Warianty z baselinker                  w trakcie   2h 5m
Czas ładowania sklepu                         w trakcie     59m
Optymalizacja i automatyzacja wdrażania       w trakcie     48m
```

Wiersze zadań nie są klikalne. Szczegóły zadania klient ma na tablicy.

Formatowanie czasu przez istniejący `formatDuration` z `src/lib/utils.ts`, który już ukrywa wartości poniżej minuty.

## Błędy i stany puste

- ClickUp nie odpowiada: komunikat na stronie plus przycisk ponowienia, nie pięćsetka.
- Zero wpisów w okresie: "W tym okresie nie zalogowano czasu". To normalny stan, nie błąd.
- Brak sesji lub cudzy slug: przekierowanie na login, jak wszędzie w portalu.
- Niepoprawny `okres` w URL: cichy fallback na ostatni zamknięty tydzień.

## Weryfikacja

W repo nie ma runnera testów, żadnego vitest ani jest. Nie dokładamy go przy tej funkcji, to osobna decyzja. Weryfikacja:

1. Skrypt w katalogu roboczym sesji sprawdzający `listPeriods` na granicach: przełom roku, przełom miesiąca w środku tygodnia, zmiana czasu na letni i z letniego, oraz odrzucanie okresu bieżącego.
2. Skrypt sprawdzający `buildReport` na zapisanej prawdziwej odpowiedzi ClickUp z folderu Onyx, z wpisem o ujemnym `duration` i wpisem bez zadania w zestawie.
3. Ręcznie lokalnie na folderze Onyx: porównanie sumy tygodnia z widokiem czasu w ClickUp.

Znany dobry punkt odniesienia: Onyx, 13-19 lipca 2026, suma 3h 52m na trzech zadaniach.

## Nowe zmienne środowiskowe

- `CLICKUP_TEAM_ID` (wartość `4552118`), lokalnie w `.env.local`, na produkcji w env Coolify.

## Narzut za organizację pracy (dopisane 2026-07-26 po weryfikacji w CRM)

Raporty rozliczeniowe w Notion (baza `płatnosći important`, CRM → Baza → Płatności) doklejają do każdego projektu pozycję:

> Organizacja pracy i komunikacja wewnątrz zespołu projektowego, planowanie i nadzór nad zadaniami, raportowanie postępów, wystawianie zadań i weryfikacja wykonania

równą **10% zsumowanego czasu zadań**, i ta suma jest podstawą faktury. Portal musi pokazywać to samo, inaczej klient widzi w portalu inną liczbę niż na fakturze.

Reguła potwierdzona na pięciu projektach za czerwiec 2026:

| Projekt | Czas zadań | Narzut w Notion | 10% |
|---|---|---|---|
| Instytut TUS | 990 min | 99 min | 99,0 |
| Onyx | 1237 min | 123 min | 123,7 |
| WDF | 8258 min | 825 min | 825,8 |
| Elko Kazanów | 485 min | 48 min | 48,5 |
| IGTSF | 97 min | 9 min | 9,7 |

**Zaokrąglanie: obcięcie w dół do pełnych minut, nie zaokrąglenie.** 48,5 daje 48, a nie 49. Zwykłe zaokrąglanie rozjechałoby portal z fakturą o minutę na części projektów.

Prezentacja: pozycja doklejona jako ostatni wiersz tabeli, poza sortowaniem po czasie, z pełną nazwą jak w Notion, ze statusem „zrobione" jak każde inne zadanie (stała OVERHEAD_STATUS). Suma „Łącznie" obejmuje narzut.

`TimeReport` rozbija to na trzy wartości: `taskMs` (czas zadań), `overheadMs` (narzut) i `totalMs` (suma). Narzut poniżej minuty nie dostaje wiersza.

### Znana rozbieżność z generatorem w Notion

Generator raportów w Notion liczy granice okresu **w UTC**, portal liczy je **w Europe/Warsaw**. Skutek: wpis czasu startujący 30 czerwca o 22:59 UTC, czyli 1 lipca o 00:59 w Warszawie, trafia w Notion do czerwca, a w portalu do lipca. Dla Onyx za czerwiec 2026 daje to 20h 37m w Notion i 20h 19m w portalu.

Decyzja: **portal zostaje przy strefie warszawskiej, bo liczy poprawnie.** Do poprawy jest generator w Notion, co jest osobną robotą w innym systemie. Do czasu poprawki portal może różnić się od faktury o kilkanaście minut na styku okresów.

## Poza zakresem

Eksport do PDF i CSV, wykresy, podział czasu na osoby, bieżący okres, klikalne wiersze, wysyłka raportu mailem na koniec tygodnia, migracja pozostałych ekranów na shadcn.
