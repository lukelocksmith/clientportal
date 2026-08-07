# Powiadomienia — zgłoszenia Łukasza i stan wykonania

## Zrobione 2026-08-07

### Czytelność listy

Zgłoszenie: *„notyfikacje chciałbym żeby były trochę bardziej czytelne"*.

Co było źle i co z tym zrobiono:

| Problem | Poprawka |
|---|---|
| wszystko ucięte do jednej linii | treść na dwóch liniach (`line-clamp-2`) |
| brak rozróżnienia rodzaju zdarzenia | ikona + nazwa słowami dla czytników ekranu |
| data bezwzględna („12 sie") przy zdarzeniu sprzed godziny | czas względny, pełna data pod kursorem |
| kropka 6 px jako jedyny znacznik nieprzeczytanego | tło pozycji + większy znacznik |
| panel 320 px, data ściśnięta | 384 px |

Czas względny to nowy moduł `src/lib/relativeTime.ts` z 13 testami. Polska
odmiana liczebników ma trzy formy i wyjątek na 12–14 — „12 minuty temu" nie ma
prawa trafić do klienta.

### Kliknięcie oznacza przeczytane

Zgłoszenie: *„jak mam notyfikacje i jest tam liczba jak tworzę i kliknę
w jakieś to chcę żeby było odczytane"*.

Wcześniej licznik schodził **wyłącznie** przyciskiem „oznacz wszystkie", więc
zajęcie się jedną sprawą nie zmieniało cyfry przy dzwonku — czyli cyfra kłamała.

### Kasowanie pojedynczych

Zgłoszenie: *„chcę żeby można było pojedyncze wiadomości kasować nie tylko
oznaczać wszystkie jako przeczytane, bo teraz nie znikają w ogóle nawet jak
oznaczę jako przeczytane"*.

Dodane: przycisk przy każdej pozycji, nowa trasa `DELETE /api/notifications`,
funkcja `deleteForUser` w store, 5 testów integracyjnych.

**Uwaga do przemyślenia w nowej sesji:** oznaczenie jako przeczytane nadal
zostawia pozycję na liście, tylko bez podświetlenia. Kasowanie jest teraz
sposobem, żeby ją usunąć. Do rozstrzygnięcia, czy przeczytane powinny znikać
same po jakimś czasie — dziś nie znikają nigdy, a `purgeOldRead(days = 90)`
istnieje w store, ale **nikt jej nie woła**.

### Wcześniej (2026-08-06)

Zgłoszenie: *„nie klikają się linki"* — pozycje listy nie były
`DropdownMenuItem`, więc Radix przechwytywał kliknięcie. Naprawione,
szczegóły w `architektura.md`.

## Niezrobione — do tej sesji

### 1. Nic nie tworzy powiadomień  ← najważniejsze

Opisane w `README.md`. Bez tego reszta jest ulepszaniem pustego widoku.

Do rozstrzygnięcia przy podłączaniu:

- **Skąd zdarzenia?** Webhook ClickUpa (`taskCommentPosted`,
  `taskStatusUpdated`) już przychodzi i wie, do którego portalu należy zadanie.
- **Kto ma dostać?** `chooseRecipients` w `notifications.ts` już to liczy,
  wystarczy zawołać.
- **Komentarze wewnętrzne.** Klient nie może dostać powiadomienia o notatce
  zespołu. Reguła `[P]` jest w `src/lib/publicComments.ts`.
- **Własne działania.** Klient, który sam napisał komentarz, nie powinien
  dostać powiadomienia o własnym komentarzu.

### 2. Wysyłka mailowa nie działa

`pendingDigest`, `stampEmailSent` i `purgeOldRead` istnieją w store i mają
testy, ale **nie woła ich nikt**. Brakuje trasy cronowej, która raz dziennie
zbierze oczekujące i wyśle zbiorczy mail. Ustawienie `daily` w profilu klienta
nie ma dziś żadnego skutku.

Wzór do naśladowania: `src/app/api/cron/task-index/route.ts` — autoryzacja
tokenem, pętla po portalach, zapis przebiegu przez `recordCronRun`,
i **porażka jednego projektu nie może przerwać pozostałych** (jest na to test).

### 3. Brak testów komponentu

`NotificationBell.tsx` nie ma żadnego testu. Harness do testów komponentów już
istnieje (jsdom + Testing Library, patrz `docs/testing.md`), więc to jest
dopisanie pliku, a nie stawianie infrastruktury.

Co warto pokryć: kliknięcie oznacza przeczytane, kasowanie usuwa z listy
i zmniejsza licznik, nieudane żądanie przywraca pozycję, admin dostaje pustą
listę bez błędu.

### 4. Ustawienia w profilu klienta

Kolumny `notify_important` i `notify_board` istnieją i mają wartości domyślne,
ale **nie sprawdzałem, czy klient ma gdzie je zmienić**. Do zweryfikowania
w nowej sesji: czy strona profilu w portalu pozwala je ustawić, czy tylko
siedzą w bazie.
