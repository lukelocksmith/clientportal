# Ochrona zgłoszeń i alarmów

Co się stanie ze zgłoszeniem klienta, gdy coś padnie. Stan na 2026-08-31.

## Skąd to się wzięło

Wszystkie cztery kanały zgłaszania (formularz, asystent AI, czerwony przycisk
Alarm, widget SitePing) miały **jedno miejsce zapisu: ClickUp**. Gdy jego API
odmawiało, treść zgłoszenia znikała, bo u nas nie zostawało z niej nic.
Formularz oddawał klientowi 500, widget błąd, a asystent AI zaczynał rozmowę
od nowa.

Nie była to teoria. Alarmy z **11.08 i 13.08** leżą w `panic_alerts`
z `clickup_task_id` równym `NULL`: powiadomienia poszły, zadanie nie powstało
i nic go nigdy nie ponowiło. Zespół widział maila, a klient patrzył na tablicę,
na której jego najpilniejszej sprawy nie było. Do tego eskalacja nie miała
czego pytać o przypisanych, bo pyta ClickUpa po id zadania.

## Zasada

**Najpierw nasza baza, potem ClickUp.** Gdy ClickUp odmówi, zgłoszenie zostaje
w tabeli `pending_reports`, klient dostaje potwierdzenie (bo jego zgłoszenie
JEST przyjęte), a cron dowozi zadanie z ponawianiem.

Klient widzi porażkę w jednym jedynym przypadku: gdy padł ClickUp **oraz** nasza
baza. Wtedy zgłoszenia nie ma już nigdzie i udawanie sukcesu byłoby kłamstwem.

## Kolejka

| | |
|---|---|
| tabela | `pending_reports` |
| reguły | `src/lib/pendingReports.ts` |
| dowożenie | `/api/cron/pending-reports`, co 2 minuty |
| ponawianie | 1, 5, 15, 60, potem co 180 minut |
| alarm | Discord (#alarmy), gdy zgłoszenie czeka ponad 15 minut i ma ≥ 2 próby |
| widok | panel admina → projekt → Zgłoszenia, czerwona ramka nad historią |

**Duplikat niemożliwy od 31.08.** Każde zgłoszenie dostaje numer
(`zg-xxxxxxxx`, `newReportMarker` w lib/reporter.ts) doklejony do stopki opisu
PRZED pierwszą próbą. Dowożenie najpierw pyta ClickUpa o zadanie z tym numerem
(`findTaskByDescriptionMarker`, jedno wywołanie: lista zwraca `description`)
i jeśli je znajdzie, zamyka wiersz kolejki bez tworzenia kopii. Dotyczy to
dokładnie tego przypadku, w którym ClickUp przyjął POST, ale odpowiedź do nas
nie dojechała. Błąd samego sprawdzenia NIE blokuje dowożenia: kosztem pomyłki
jest duplikat, który widać i da się zamknąć, a nie utrata zgłoszenia.

W `payload` leżą **gotowe argumenty `createTask`**, policzone raz, w chwili
zgłoszenia: stopka z sesji, tagi, status, przypisanie. Dowożenie jest głupim
powtórzeniem tego samego wywołania, a nie drugą implementacją reguł.

Dowiezione zadanie zostawia w historii projektu `zKolejki: true` razem z liczbą
minut czekania — inaczej nikt nie zauważy, że przy zgłoszeniu ClickUp odmówił.

**Widget SitePing przechodzi w całości.** Pełne zgłoszenie leży w
`pending_reports.extra`, a zrzut ekranu i załącznik z diagnostyką dokładają się
PO dowiezieniu, bo wymagają istniejącego zadania. Nieudany załącznik nie
przewraca dowiezienia: zadanie już jest, więc zgłoszenie nie zginęło.

## Alarm

Kolejność jest celowa i się nie zmienia: **zadanie przed powiadomieniami**, żeby
powiadomienie niosło link, ale z twardym limitem 8 sekund na ClickUpa. Po tym
czasie powiadomienia idą bez linku.

Od 31.08 **wynik wysyłki jest czytany**. Wcześniej `Promise.allSettled`
służyło tylko do tego, żeby porażka jednego kanału nie zatrzymała pozostałych,
a jego rezultat leciał do kosza — alarm, o którym nie dowiedział się nikt,
wyglądał w bazie identycznie jak alarm ogłoszony na trzech kanałach.

Uwaga na pułapkę, w którą łatwo wpaść drugi raz: **wszystkie trzy funkcje
wysyłkowe łykają swoje błędy**, więc ich obietnice zawsze kończą się sukcesem.
Patrzenie na `status === 'rejected'` mierzyłoby wyłącznie to, czy kod się
wykonał. Dlatego każda zwraca `boolean` znaczący „co najmniej jeden odbiorca
dostał". SMS pominięty przez dławik liczy się jako **niedostarczony**: pytanie
brzmi „czy TEN alarm do kogoś dotarł".

Gdy padły wszystkie trzy: wiersz alarmu dostaje `notify_failed_at`, leci alarm
operacyjny na Discorda, a **eskalacja nie czeka na pierwszy próg** (25 minut) —
ogłasza przy najbliższym przebiegu, czyli w ciągu 5 minut.

## Kto pilnuje pilnujących

Oba crony alarmują na Discordzie, **gdy się wykonają i nie udadzą**. Cron, który
przestał być wołany, nie alarmuje o niczym: cisza wygląda identycznie jak
spokój. Zauważyć to może tylko coś spoza tego serwera.

Stąd **`/api/health/zgloszenia`**: bez tokenu, zwraca tekst zaczynający się od
`OK` albo od `PROBLEM`, a przy problemie także kod 503. Nie wychodzi stąd nic
o klientach, tylko wiek przebiegów i liczniki. Granice w
`src/lib/healthReporting.ts`:

| pilnowane | granica ciszy |
|---|---|
| `pending-reports` (co 2 min) | 15 minut |
| `panic-escalation` (co 5 min) | 20 minut |
| `task-index` (raz na dobę) | 36 godzin |
| najstarsze zgłoszenie w kolejce | 20 minut |

**Od 31.08 pilnują tego DWIE czujki, obie poza Hetznerem:** UptimeRobot
(nr 803873937, typ `KEYWORD` na słowo `OK`, alerty mail + Pushover, utworzona
**API v3** — v2 na tym planie odmawia) oraz cron na Mac mini
(`scripts/portal-health-watch.sh`, alarm na Discorda, jedna wiadomość na
godzinę). Dwie, bo kanał alertów stojący razem z monitorowaną maszyną milczy
dokładnie wtedy, gdy jest potrzebny.

## Kto woła crony

Oba szybkie crony idą po `127.0.0.1` WEWNĄTRZ kontenera, więc żaden nie zależy
od proxy, Cloudflare ani DNS-u:

- **`panic-escalation`, co 5 minut** — zadanie cykliczne Coolify
  (`eskalacja-alarmow`). Uwaga: API Coolify podaje `scheduled_tasks: null`,
  więc harmonogramy trzeba czytać z bazy Coolify.
- **`pending-reports`, co 2 minuty** — crontab roota na 65.21.75.39:

```cron
*/2 * * * * C=$(docker ps -q -f name=n6iy8x0epg8wx1zwe222oh2r | head -1) && docker exec $C wget -q -T 100 -O - "http://127.0.0.1:3000/api/cron/pending-reports?token=$CRON_SECRET" >/dev/null 2>&1
```

Nazwa kontenera zmienia się przy każdym deployu, dlatego wybieramy go po
prefiksie, a nie po pełnej nazwie.
