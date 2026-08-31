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

W `payload` leżą **gotowe argumenty `createTask`**, policzone raz, w chwili
zgłoszenia: stopka z sesji, tagi, status, przypisanie. Dowożenie jest głupim
powtórzeniem tego samego wywołania, a nie drugą implementacją reguł.

Dowiezione zadanie zostawia w historii projektu `zKolejki: true` razem z liczbą
minut czekania — inaczej nikt nie zauważy, że przy zgłoszeniu ClickUp odmówił.

**Czego kolejka nie ratuje przy widgecie SitePing:** załącznik JSON z pełną
diagnostyką i zrzutem ekranu wymaga istniejącego zadania, więc nie przechodzi.
Skrót diagnostyki dokładamy do opisu, a w zadaniu staje adnotacja, że
załącznika nie ma.

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

Czujnik zewnętrzny (UptimeRobot, monitor typu keyword na słowo `OK`) ma odpytywać
ten adres co 5 minut. **Bez tego czujnika ten endpoint jest tylko stroną, na
którą nikt nie patrzy.**

## Wpisy w crontabie serwera

```cron
# Dowożenie zgłoszeń, które nie weszły do ClickUpa przy zgłoszeniu. Co 2 minuty.
*/2 * * * * curl -s -o /dev/null -m 100 "https://portal.important.is/api/cron/pending-reports?token=$CRON_SECRET" >/dev/null 2>&1
```

Eskalacja alarmów (`panic-escalation`, co 5 minut) chodzi od dawna i widać ją
w `cron_runs`, ale **nie ma jej w crontabie roota na 65.21.75.39** — woła ją
coś innego (prawdopodobnie zewnętrzny czujnik odpytujący ten adres). Warto to
kiedyś ustalić i zapisać, bo dziś nikt nie wie, co utrzymuje ten cron przy życiu.
