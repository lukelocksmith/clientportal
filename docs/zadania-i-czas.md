# Zadania i czas: jak pracujemy nad portalem

Ten dokument odpowiada na cztery pytania: **gdzie** wrzucamy zadania, **jak** je
opisujemy, **kiedy** je zakładamy i **które** w ogóle zasługują na zadanie. Plus
piąte, najczęściej pomijane: **jak logujemy czas**, żeby dało się powiedzieć, ile
ta praca kosztowała.

Powstał 14.09.2026, po sesji, w której zrobiliśmy dużo dobrej roboty i o mało co
nie zostawilibyśmy po niej ani zadania, ani ani jednej zalogowanej minuty.

---

## Gdzie

| Rodzaj pracy | Lista w ClickUpie | Rozliczenie |
|---|---|---|
| **Portal** (ten projekt) | `portal.important.is` → `901220457028`, folder important.is | wewnętrzne, `billable: false` |
| Praca dla klienta w jego projekcie | folder klienta (Onyx, EFF, WDF…) | klienckie, na fakturę |
| Próby, pomiary, zadania testowe | „arena akcji" → `901212252101` | nie rozliczamy |

**Portal jest nasz.** Rozstrzygnięte 31.08.2026: czas nad nim idzie na listę
wewnętrzną i nie wchodzi nikomu na fakturę. To nie znaczy, że się go nie loguje —
znaczy, że wiadomo, ile nas kosztuje.

**Nigdy nie zakładaj zadań testowych w folderze klienta.** Klient widzi swoją
tablicę w portalu, a zespół ma je w kolejce. Do prób służy arena akcji.

---

## Kiedy

**Zadanie powstaje PRZED pracą, nie po niej.** Powód jest praktyczny, nie
formalny: bez zadania nie ma czego oznaczyć znacznikiem rozliczeniowym, a bez
znacznika czas trafia do kubełka `UNASSIGNED` i da się go odzyskać tylko wtedy,
gdy projekt miał własny katalog.

```bash
S=~/Projects/important/tmrozliczenie/.claude/skills/rozliczenie/scripts/rozliczenie.py
python3 $S start <task-id>     # PRZED pierwszą zmianą w kodzie
```

Do tego służy skill **`/start`**: zbiera kontekst, ustala co i po co, stawia
znacznik. Sesja zaczęta inaczej kończy się pracą, której nie da się rozliczyć.

Wyjątek, który wolno zostawić bez zadania: drobiazg poniżej mniej więcej
godziny, dopisany do zadania już istniejącego. Gdy robota rośnie, zakładamy
zadanie w trakcie i przenosimy na nie znacznik.

---

## Jakie

Zadanie zasługuje na istnienie, gdy spełnia **oba** warunki:

1. Da się powiedzieć, **po czym poznamy, że skończone** (pole `Outcome`).
2. Ktoś inny niż autor zrozumie, **czego dotyczy**, bez czytania rozmowy.

Nie zakładamy zadań na: „poprawki", „drobne rzeczy", „refaktor", „przegląd kodu".
Takie nazwy po miesiącu nie znaczą nic i nie da się ich zamknąć, bo nie wiadomo,
kiedy się kończą.

Zakładamy natomiast zadanie zawsze, gdy:

- klient to zauważy (funkcja, komunikat, zmiana w portalu),
- coś zginęło albo mogło zginąć (zgłoszenie, mail, alarm),
- rzecz wraca po raz drugi (wtedy zadanie jest tańsze niż trzecia rozmowa o tym samym),
- praca zajmie więcej niż mniej więcej godzinę.

---

## Jak opisujemy

Cztery pola (format TMD ze skilla `task-create`), w opisie zadania jako sekcje:

| Pole | Pytanie | Czego unikać |
|---|---|---|
| **Action** | co konkretnie robimy | czasowników bez dopełnienia („poprawić", „ogarnąć") |
| **Intent** | po co, czyj problem to rozwiązuje | „bo tak trzeba", „dla porządku" |
| **Context** | co już wiadomo, czego dotyka, gdzie w kodzie | ogólników bez ścieżek i nazw |
| **Outcome** | po czym poznamy, że skończone | „działa poprawnie" (to nie jest sprawdzalne) |

Trzy zasady, każda kupiona pomyłką:

- **Opis zadania może dotrzeć do klienta.** Portal pokazuje go w szufladzie,
  a komentarze z prefiksem `[P]` idą do niego wprost. Rozbicie godzin, uwagi
  o zespole i nasze wewnętrzne wątpliwości idą do **komentarza**, nie do opisu.
- **Odwzorowuj nazwy ze źródła.** Jeżeli klient nazywa rzecz „banerem", zadanie
  ma mówić o banerze, a nie o „sekcji hero".
- **Liczby w zadaniu muszą mieć pokrycie.** Nie wpisujemy ocen ani wyników
  („58/100"), za którymi nie stoi raport.

---

## Jak zamykamy

Status zmieniamy dopiero wtedy, gdy **jest dowód**, a nie wtedy, gdy kod wygląda
na gotowy. Dowodem jest przebieg na produkcji, zielony test, który dotyka tej
konkretnej ścieżki, albo odczyt zwrotny z systemu, którego dotyczy zmiana.

Kolumna „weryfikacja" i „przegląd" znaczą, że ktoś ma to jeszcze sprawdzić.
Zamykanie ich hurtem, bo „przecież zrobiliśmy", zamienia tablicę w listę życzeń.

Gdy zadanie okazuje się niewykonalne albo bezprzedmiotowe, **nie kasujemy go po
cichu**: dopisujemy powód i zamykamy. Skasowane zadanie wraca po kwartale jako
ten sam pomysł.

---

## Jak logujemy czas

Skill **`/done`** robi to na koniec sesji. Ręcznie wygląda to tak:

```bash
S=~/Projects/important/tmrozliczenie/.claude/skills/rozliczenie/scripts/rozliczenie.py
python3 $S zadanie <task-id>                          # gdy był znacznik
python3 $S projekt clientportal --od <d> --do <d>      # gdy znacznika nie było
```

**Liczbą do zalogowania jest „czas po podziale", nigdy „suma bloków".** Przy
pracy w kilku katalogach naraz suma bloków bywa dwa, trzy razy wyższa. W tej
sesji: suma 3,36 h, po podziale 1,74 h, równoległość zabrała 48 procent.

**Nigdy nie szacuj czasu z odstępów między wiadomościami.** 11.08.2026 taki
szacunek dał 147 minut przy zmierzonych 45.

Wpis do ClickUpa:

```bash
POST /api/v2/team/4552118/time_entries
{ "tid": "<task-id>", "start": <ms>, "duration": <ms>, "description": "..." }
```

- **Osobny wpis na każdy dzień pracy.** Jeden plik sesji po `--resume` rozciąga
  się na kilka dni, a rozliczenia idą w okresach.
- **Nigdy `time_estimate`.** Około 20 procent zadań loguje potem czas „na
  estymatę", więc wpisana estymata zaczyna udawać czas pracy.
- Trasa `POST /task/{id}/time` odrzuca wpis błędem `TIMESPENT_002`, jeżeli podasz
  `start` i `duration` bez `end`. Endpoint zespołowy powyżej działa.
- Rozbicie godzin idzie w **komentarzu**.
- Godziny AI (`k = 0,123`) są liczone i raportowane, ale **faza 1**: nie
  dopisujemy ich do wpisów. Zmiana wymaga zgody Łukasza, bo rusza kwoty.

---

## Sesja, która ma sens

Skrótowo, do przypięcia nad biurkiem:

1. **`/start`** — co robimy, po co, znacznik na zadaniu.
2. Praca. Po każdej zmianie sprawdzenie, które szuka **objawu awarii**, nie
   potwierdzenia sukcesu.
3. **`/done`** — pomiar czasu, wpis do ClickUpa, pamięć projektu, lista rzeczy
   **niedokończonych**.

Punkt trzeci jest tym, który najłatwiej pominąć i który najwięcej kosztuje: bez
niego następna sesja zaczyna od odkrywania, co właściwie zostało zrobione.

## Powiązane

- `docs/testing.md` — jak sprawdzamy, co jest pokryte, czego NIE ma.
- `docs/architektura.md` — co woła crony, gdzie leżą dane.
- `docs/decyzje/` — czego świadomie NIE robimy i dlaczego.
