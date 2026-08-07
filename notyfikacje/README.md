# Powiadomienia — zacznij tutaj

Dokumentacja dla osobnej sesji pracy nad powiadomieniami w Client Portalu.
Stan na **2026-08-07**, gałąź `main`, wszystko zacommitowane lokalnie
(bez pusha).

## Najważniejsza rzecz, zanim cokolwiek zaczniesz

**Nic w aplikacji nie tworzy powiadomień.**

Cała maszyneria istnieje i jest przetestowana: decydowanie o odbiorcach, zapis
do bazy, odczyt, licznik, dzwonek w portalu. Ale funkcja `createNotifications`
nie ma **ani jednego wywołania w kodzie produkcyjnym** — wołają ją wyłącznie
testy i skrypt zasiewający lokalną bazę.

Sprawdzone wprost:

```bash
grep -rn "createNotifications" src scripts tests | sed 's|:.*||' | sort | uniq -c
#   2 scripts/seed-notifications.ts     ← lokalny zasiew
#   1 src/lib/notificationStore.ts      ← definicja
#   … reszta to pliki testów
```

To samo dotyczy `chooseRecipients` (wołane tylko przez własne testy) oraz
`pendingDigest`, `stampEmailSent` i `purgeOldRead` — **nie woła ich nikt**.

Znaczy to, że u klienta na produkcji dzwonek będzie zawsze pusty. Nie jest to
awaria, tylko niedokończone podłączenie: brakuje ostatniego kroku, w którym
zdarzenie (komentarz zespołu, zmiana statusu) tworzy wiersz w tabeli.

**To jest pierwsza rzecz do zrobienia w tej sesji.** Wszystko inne to ulepszanie
widoku, którego nie ma czym wypełnić.

## Gdzie jest kandydat na podłączenie

Zdarzenia z ClickUpa przychodzą do `src/app/api/webhooks/clickup/route.ts`.
Trasa obsługuje już `taskCommentPosted`, `taskCommentUpdated`,
`taskStatusUpdated` i resztę, i wie, do którego portalu należy zadanie. To jest
naturalne miejsce, w którym powinno powstawać powiadomienie — ale dziś trasa
tylko przebudowuje indeks Historii.

Uwaga: webhook nie wie, **kto** z zespołu napisał komentarz ani czy komentarz
jest publiczny. Reguła `[P]` żyje w `src/lib/publicComments.ts` i klient nie ma
prawa dostać powiadomienia o notatce wewnętrznej zespołu.

## Pliki w tym katalogu

| Plik | Co zawiera |
|---|---|
| `README.md` | to, co czytasz: stan i punkt wejścia |
| `architektura.md` | gdzie co leży, model danych, przepływy |
| `zgloszenia-lukasza.md` | co Łukasz zgłosił, co zrobione, co zostało |

## Jak uruchomić lokalnie

```bash
docker start cp-test-pg
npm run dev                                    # portal
node --env-file=.env.local --import tsx \
  scripts/seed-notifications.ts onyx           # przykładowe powiadomienia
```

Skrypt zasiewający **odmawia pracy**, gdy `DATABASE_URL` nie wskazuje na
localhost. To nie jest narzędzie do produkcji.

Potem wejdź na `/onyx`, zaloguj się i kliknij dzwonek w nagłówku.

Zasady testowania całego repo (warstwy, pułapki, projekt testowy w ClickUpie)
są w `docs/testing.md` — przeczytaj przed dopisywaniem testów.
