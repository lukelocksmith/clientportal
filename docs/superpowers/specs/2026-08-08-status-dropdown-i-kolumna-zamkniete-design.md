# Zmiana statusu z dropdownu + widoczna kolumna „zamknięte” na kanbanie

Data: 2026-08-08
Status: zaakceptowany, gotowy do planu wdrożenia

## Kontekst

Zgłoszenie od Łukasza: po przeciągnięciu zadania na status „zamknięte” zadanie znika z tablicy przy najbliższym odświeżeniu. To zamierzone zachowanie z commitu `ae1ac2a` — kanban pobiera zadania z ClickUp z `include_closed: false` (`src/lib/clickup.ts:64`), a zamknięte mają żyć w zakładce Historia. Zachowanie jest poprawne technicznie, ale myląco wygląda jak utrata zadania.

Dwie zmiany, żeby to ograć bez powrotu do pobierania całej historii zamknięć na żywo:

1. Kolumna „zamknięte” na tablicy pokazuje ograniczoną liczbę **niedawno** zamknietych zadań, z linkiem do pełnej listy w Historii.
2. Zmiana statusu (w tym na „zamknięte”) dostaje drugą drogę oprócz przeciągania karty: dropdown w widoku otwartego zadania (`TaskDrawer`).

Poza zakresem: zmiana zachowania drag&drop na tablicy (zostaje jak jest), zmiana pobierania zadań otwartych, jakiekolwiek zmiany w Historii poza tym, że stanie się celem linku „Zobacz więcej”.

## Decyzje i ich uzasadnienie

| Decyzja | Uzasadnienie |
|---|---|
| Zamknięte zadania w kolumnie pobierane **dodatkowym, ograniczonym zapytaniem** (`include_closed: true` + `date_updated_gt` z oknem np. 30 dni), nie zmianą istniejącego `getAllTasksForLists`/`getAllTasksForFolder` | Zwykłe przełączenie `include_closed` na `true` dla całego poboru ściągałoby też bardzo starą historię zamknięć u długoletnich klientów, z realnym ryzykiem, że `MAX_PAGES_PER_LIST = 11` obciąłby przy okazji świeże, otwarte zadania. Skoro i tak pokazujemy tylko kilka najnowszych, nie ma powodu ściągać więcej. |
| Alternatywa odrzucona: czytać zamknięte z `task_index` (lustro pod Historię) | Synchronizacja tej tabeli jest **dzienna** (`Zalecany harmonogram: codziennie` w `src/app/api/cron/task-index/route.ts`). Zadanie zamknięte rano zniknęłoby z kolumny do jutrzejszego crona — to samo zgłoszenie, tylko przesunięte w czasie, nie rozwiązane. |
| Limit wyświetlania: **5 zadań** w kolumnie „zamknięte”, sortowane po dacie zamknięcia (najnowsze pierwsze) | Ustalone z Łukaszem. Wystarczające do orientacji „co ostatnio zamknięto”, bez zamieniania kolumny w nieskończoną listę. |
| Link „Zobacz więcej” prowadzi do `/${slug}/historia?status=zamkniete`, nie rozwija listy w miejscu | Historia już ma wyszukiwarkę, filtr statusu i stronicowanie (`src/app/[slug]/historia/page.tsx`) — duplikowanie tego na kanbanie byłoby drugim miejscem do utrzymania tej samej funkcji. |
| Link „Zobacz więcej” pojawia się tylko gdy `isTabEnabled(flags, 'historia')` | Portal bez włączonej zakładki Historii nie ma gdzie tego linku zaprowadzić — kolumna kończy się po prostu na piątym zadaniu, bez martwego odnośnika. |
| Dropdown statusu żyje w `TaskDrawer`, nie na `TaskCard` | Ustalone z Łukaszem: przeciąganie karty po tablicy zostaje bez zmian, dropdown dostaje widok otwartego zadania — miejsce, gdzie i tak trzeba kliknąć, żeby coś zobaczyć/zmienić. |
| Dropdown wysyła ten sam `PATCH /api/clickup/tasks/{id}` co drag&drop, bez zmian backendu | `patchSchema` już przyjmuje `{status: string}` (`src/app/api/clickup/tasks/[taskId]/route.ts:54`), a historia zmian statusu i unieważnianie cache’u folderu są tam już podłączone. Nowa droga UI, ten sam, sprawdzony kontrakt. |
| Podłączenie `onTaskUpdated` z `TaskDrawer` do istniejącej, dotąd nieużywanej funkcji `handleTaskUpdated` w `KanbanBoard.tsx:226-228` | Funkcja została napisana wcześniej i zostawiona bez podłączenia (martwy kod, opisany w komentarzu przy usunięciu poprzedniej edycji w `TaskDrawer.tsx:76-88`). Podłączamy istniejący kod, nie piszemy drugiego. |

## Zmiany w kodzie

**`src/lib/clickup.ts`** — nowa funkcja, np. `getRecentlyClosedTasks(folderIdOrListIds, { sinceDays: 30, limit: 5 })`, budująca zapytanie z `include_closed: true` + `date_updated_gt`, ograniczona do 1-2 stron per lista (nie `MAX_PAGES_PER_LIST`, bo tu bierzemy tylko niedawne).

**`src/components/kanban/KanbanBoard.tsx`**:
- `buildColumns` łączy wynik istniejącego poboru otwartych zadań z wynikiem `getRecentlyClosedTasks` dla kolumny „zamknięte”, przycina do 5, sortuje po dacie zamknięcia.
- `TaskDrawer` dostaje `onTaskUpdated={handleTaskUpdated}` (funkcja już istnieje, tylko podłączenie).

**`src/components/kanban/KanbanColumn.tsx`**: link „Zobacz więcej” pod listą zadań, renderowany tylko dla kolumny `zamknięte` i tylko gdy `historyEnabled` (flaga przekazana z `KanbanBoard`/`page.tsx`).

**`src/components/kanban/TaskDrawer.tsx`**:
- plakietka statusu (linie ~202-204) zamieniona na `DropdownMenu` (shadcn, wzorzec z `NewTaskButton.tsx`) z siedmioma statusami z `STATUS_COLUMNS`.
- nowy prop `onTaskUpdated?: (task: ClickUpTask) => void`, wywoływany po udanym PATCH.
- błąd PATCH: toast + status w dropdownie wraca do poprzedniej wartości (bez optymistycznej zmiany widoku, żeby nie pokazywać stanu, który się nie zapisał).

## Edge cases

- **Zmiana statusu na ten sam** (klient wybiera aktualny status w dropdownie) — no-op, bez wywołania PATCH, analogicznie do `task.status.status === targetColumn` w `handleDragEnd`.
- **Zadanie zamknięte dawno, poza oknem 30 dni**, otwarte linkiem z powiadomienia — już obsłużone istniejącym mechanizmem w `KanbanBoard.tsx:133-138` („Tego zadania nie ma na tablicy. Poszukaj go w Historii”).
- **Konflikt: zmiana statusu w dropdownie i w ClickUpie w tej samej chwili** — nierozwiązywany specjalnie, tak jak dziś przy drag&drop: kto ostatni zapisze, wygrywa.
- **Portal bez włączonej zakładki Historia** — kolumna „zamknięte” bez linku „Zobacz więcej”, jak wyżej.

## Testy do dopisania

- `lib/clickup.ts`: `getRecentlyClosedTasks` — poprawne parametry zapytania (`include_closed=true`, `date_updated_gt`), mock fetch jak istniejące testy w tym pliku.
- `KanbanBoard.tsx` / `buildColumns`: kolumna „zamknięte” obcina do 5 mimo więcej zadań na wejściu, sortowanie po dacie zamknięcia.
- `TaskDrawer`: wybór statusu z dropdownu wywołuje PATCH z poprawnym body i `onTaskUpdated`; błąd PATCH pokazuje toast i nie zmienia widocznego statusu; wybór aktualnego statusu nie wywołuje PATCH.
