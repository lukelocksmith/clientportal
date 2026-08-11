# SitePing — stan prac

Zapis sesji **2026-08-07/08**. Gałąź `main`, wszystko zacommitowane lokalnie,
**bez pusha**.

Powiadomienia mają własną dokumentację w `notyfikacje/` — pracujemy nad nimi
w osobnej sesji.

## Co działa dziś

Klient zgłasza usterkę **zaznaczając miejsce na własnej stronie**, a zadanie
ląduje w ClickUpie z linkiem prowadzącym dokładnie tam.

**Ścieżka klienta.** Portal → „Nowe zadanie ▾" → „Pokaż na stronie" → jego
strona z widgetem → dymek → ołówek → zaznacza obszar → wysyła.

**Co dostaje zespół w ClickUpie:**

| Element | Skąd |
|---|---|
| Treść zgłoszenia | pierwsza linia opisu, bez ozdób |
| **Rodzaj** (błąd / zmiana / pytanie / inne) | opis **oraz** tag |
| Link „Zobacz na stronie" | otwiera stronę i podświetla zaznaczenie |
| Element i selektor CSS | z anotacji widgetu |
| Stopka ze zgłaszającym | z sesji portalu, nie z treści |
| **Ślad techniczny** | wewnętrzny komentarz: konsola + nieudane żądania |
| Tagi | `siteping` + rodzaj |

## Co zrobiliśmy w tej sesji

Osiemnaście commitów. Najważniejsze rzeczy, pogrupowane.

### Refaktor i testy (fundament)

- **Jedna brama sesji dla tras API** (`requirePortalApi`). Wcześniej ta sama
  reguła bezpieczeństwa istniała w pięciu wariantach, a wszystkie wypadały
  bezpiecznie tylko dzięki jednej linijce w innym pliku.
- **Testy z 363 do 814.** Wszystkie 32 trasy API mają pokrycie; doszły testy
  komponentów (jsdom) i przypadków brzegowych modułów `lib/`.
- Zasady i mapa pokrycia: **`docs/testing.md`** — czytaj przed dopisywaniem
  testów, są tam pułapki, które już nas kosztowały.
- **`npm run verify` naprawiony** — świecił na czerwono przez wygenerowany kod
  porzuconego worktree, czyli brama przed pushem była bramą do omijania.

### SitePing

- **Przycisk „Nowe zadanie ▾"** z wyborem drogi: zaznacz na stronie albo opisz
  asystentowi. Bez skonfigurowanej strony działa jak dotąd, bez menu.
- **Rodzaj zgłoszenia** trafia do tagów i opisu (był wyrzucany).
- **Ślad techniczny** jako wewnętrzny komentarz (`captureDiagnostics`).

### Znalezione i naprawione błędy

1. **Komentarze nie ładowały się adminowi** — `TaskDrawer` wołał trasę bez
   `?slug=`, a obejście admina działa tylko dla nazwanego portalu.
2. **Powiadomienie nie otwierało zadania** — stan liczony w inicjalizatorze
   `useState`, który przy nawigacji po stronie przeglądarki się nie wykonuje.
3. **`recordCronRun` bez try/catch** — padnięty zapis przerywał pętlę i reszta
   projektów zostawała niezsynchronizowana.
4. **Przyciski ikonowe bez `aria-label`** w szufladzie zadania.
5. **Martwy interfejs** `onTaskUpdated` — wyglądał na żywy, nie robił nic.
6. **`https://localhost`** w linku „Pokaż na stronie" (mój błąd, ta sesja).

### Historia zmian statusu

Nowa tabela `task_status_history`, dwa źródła (webhook ClickUpa i przeciągnięcie
karty w portalu), widok w **Logu synchronizacji** w karcie projektu.

## Zakładka „SitePing" w panelu

Dopisane **2026-08-11**. Karta projektu → zakładka **SitePing**, obok „Poczta".
Wszystko, co dotyczy widgetu, stoi w jednym miejscu, bo pytanie „czemu klientowi
nie dochodzą zgłoszenia" jest pytaniem o jedno miejsce w panelu.

**Konfiguracja:** przełącznik, pole domen (zapis po opuszczeniu pola), stałe
ostrzeżenie o tagach, zwijany kod do wklejenia w dwóch wariantach — mu-plugin
WordPressa (podstawia tożsamość) i zwykły HTML (nie podstawia, widget zapyta
o imię i mail).

**Test połączenia** — przycisk, nie automat: sprawdzenie wychodzi do ClickUpa
i na stronę klienta, więc nie ma powodu robić tego przy każdym otwarciu panelu.
Cztery rzeczy naraz:

| Sprawdzenie | Skąd |
|---|---|
| Funkcja włączona | baza |
| Domeny ustawione | baza |
| Tagi w przestrzeni ClickUp | `GET /space/{id}/tag` |
| Widget na stronie — **osobno dla każdej domeny** | pobranie HTML + historia zgłoszeń |

**Trzy stany, nie dwa.** `unknown` („nie udało się sprawdzić") jest myślnikiem,
nigdy czerwonym krzyżykiem — inaczej test wysyłałby naprawiać coś, o czym nie
wiadomo, czy jest zepsute. Jedno nieudane sprawdzenie nie zabiera pozostałych:
padnięty ClickUp nie może ukryć tego, że domeny są puste.

Dwie rzeczy warte zapamiętania, obie odkryte przy pisaniu:

1. **Sprawdzenie pobiera `https://domena/?siteping=1`**, nie samą stronę.
   mu-plugin osadza widget warunkowo, więc bez parametru wynik brzmiałby
   „nie ma widgetu" u **każdego** poprawnie skonfigurowanego klienta.
   Sprawdzone na `important.is`: bez parametru zero trafień, z parametrem jest.
2. **Wymaganych tagów jest pięć, nie jeden.** Spec wymieniał sam `siteping`;
   od tamtej pory każde zadanie dostaje też tag rodzaju.

## Czego NIE MA

**Logu diagnostycznego** (punkt 4 specu): tabela `siteping_log` z zapisem
każdego wyjścia z trasy, także odrzuconego origina i rate-limitu. Dziś
odrzucone żądanie nie zostawia śladu nigdzie poza `console.*` na serwerze.
Spec mówi „migracja 0016", ale pierwszy wolny numer to **0018**.

**Widget osadzony tylko na `important.is`.** `wdf` i `onyx` mają SitePinga
wyłączonego i puste domeny.

**Nie ma trybu zaznaczania z adresu.** Publiczne API widgetu to `open()`,
`close()`, `refresh()`, `focusFeedback(id)` — nie da się wejść od razu
w rysowanie prostokąta. „Pokaż na stronie" otwiera stronę, resztę klient musi
kliknąć sam.

**Wideo** — świadomie odłożone. Pakiet tego nie ma, `getDisplayMedia` pokazuje
systemowy wybór okna (klient może udostępnić złą rzecz), 10 sekund ekranu to
kilka MB przy limicie 10 MB. Jeśli ślad techniczny okaże się niewystarczający,
wracamy — ale wtedy **rrweb** (zmiany w DOM), nie nagrywanie pikseli.

## Zanim włączysz SitePinga klientowi

Kroki 1–3 sprawdza za Ciebie **Test połączenia** w zakładce SitePing. Nie
zastąpi ich, bo tagi i osadzenie i tak trzeba zrobić ręcznie, ale powie, czego
brakuje, zanim zgubi się pierwsze zgłoszenie.

1. **Załóż tagi w jego przestrzeni ClickUpa:** `siteping`, `błąd`, `zmiana`,
   `pytanie`, `inne`. Tag nieistniejący jest **po cichu pomijany** — bez błędu,
   bez śladu.
2. **Osadź widget** na jego stronie: skopiuj kod z zakładki SitePing
   (wariant WordPress → `wp-content/mu-plugins/siteping.php`).
3. **Ustaw `siteDomains`** na host tej strony — bez `https://`, opcjonalnie
   z portem. Pole jest w tej samej zakładce.
4. **Ustaw `SITEPING_API_KEY`** w środowisku produkcyjnym.
5. ⚠️ **Uprzedź klienta o zbieraniu konsoli**, jeśli włączasz
   `captureDiagnostics`. Konsola jego strony może zawierać dane jego
   użytkowników, a adresy nieudanych żądań niosą pełny query string.

## Testowanie lokalne

```bash
docker start cp-test-pg
npm run dev                    # portal na :3000
# strona testowa widgetu: http://localhost:5500/scripts/siteping-manual-test.html
```

**Jeden serwer dev naraz** — Next 16 odmawia uruchomienia drugiego, a dwa
stojące jednocześnie były w tej sesji źródłem dwóch fałszywych alarmów (stary
build serwował kod sprzed refaktoru).

Portal testowy: `siteping-test`, domena `localhost:5500`.

Pełna instrukcja klikania po aplikacji: **`docs/testing.md`**.

## Otwarte decyzje

- **Push do GitHuba** — 18 commitów lokalnie, nic nie wysłane. Coolify ciągnie
  z GitHuba, więc push = deploy.
- **Porzucony worktree** `.claude/worktrees/siteping-clickup-backend/` — gałąź
  w całości scalona, nic niezacommitowanego. Obszedłem go w konfiguracji
  lintera, ale nadal zajmuje miejsce.
- **Migracja 0017 na produkcji.** Lokalnie rejestr migracji miał dryf (kolumny
  z 0016 weszły przez `db:push`), więc `drizzle-kit migrate` przerywał **cicho**,
  z kodem 1 i połkniętym komunikatem. Przy deployu sprawdź, czy 0017 faktycznie
  się zastosowała.
