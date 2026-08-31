# Kafel budżetu miesięcznego na Raportach

Data: 2026-08-31. Stan: **ustalone, czeka na wdrożenie.**
Makieta: https://claude.ai/code/artifact/f78c7df1-daa4-4ba7-a962-1cd7fae3d197

## Co

Czwarty kafel na ekranie „Czas i budżet" (`/{slug}/raporty`), pokazujący
zużycie miesięcznego limitu pracy: `2 h 20 m / 3 h` plus pasek wypełnienia
i podpis z kwotą oraz tym, ile zostało.

## Po co

Trzy dzisiejsze kafle mówią, ile poszło i co zostało w planie, ale **żaden nie
mówi, ile klient ma**. Liczba „2 h 20 m" nic nie znaczy, dopóki nie wiadomo, że
w umowie są 3 h. Klient zadaje to pytanie jako pierwsze i dziś odpowiedź zna
tylko zespół.

Michał Dmitrowicz (WDF) pytał o dokładnie to na cotygodniowych spotkaniach
17 i 21.07: budżet miesięczny i przepracowane kontra estymacja.

## Jak — decyzje podjęte 31.08

**Liczbą wiodącą są ZAWSZE godziny**, także u klientów rozliczanych kwotowo.
Jedna jednostka czyta się szybciej niż dwie, a kwota stoi w podpisie. Dzięki
temu kafel jest jeden i identyczny dla wszystkich projektów, a nie dwa warianty
do rozróżniania wzrokiem.

**Limit wpisujemy w panelu jako czas, co do minuty.** Portal nic nie przelicza
i nic nie zaokrągla — pokazuje to, co wpisaliśmy. Onyx: 3 h. WDF: 35 h 42 m
(co po stawce 140 zł/h daje 4 998 zł, czyli górną granicę widełek 3,5–5 tys.).
Decyzja „która granica przy widełkach" zapada raz, przy wpisywaniu, a nie
w kodzie.

**Kolor niesie wyłącznie pasek**, liczba zostaje w kolorze tekstu także po
przekroczeniu. Jeden nośnik stanu, nie dwa krzyczące naraz.

**Przekroczenie jest widoczne i policzone**, nie obcięte do 100%: kafel
pokazuje `3 h 40 m / 3 h` i nadwyżkę w godzinach oraz złotówkach. Klient
dowiaduje się o niej z portalu, a nie z faktury.

**Nowy kafel nie jest niczym wyróżniony** — wygląda dokładnie jak pozostałe
trzy.

## Skąd liczby

| Liczba | Źródło | Uwaga |
|---|---|---|
| zużyte godziny | ClickUp, wpisy czasu okresu, zawężone do list projektu | ta sama liczba co w kaflu „W tym miesiącu" |
| kwota | godziny × stawka netto z CRM w Notionie | bez stawki kafel pokazuje same godziny, nigdy zgadniętej kwoty |
| limit | NOWE pole w konfiguracji projektu, minuty | puste = kafla nie ma |
| granice miesiąca | okres z zakładki Raporty, liczony w Europe/Warsaw | bieżący, jeszcze trwający miesiąc jest domyślny |

## Zakres wdrożenia

1. Kolumna `monthly_limit_minutes` na projekcie plus pole w panelu, obok
   stawki godzinowej.
2. Czysty moduł liczący (zużycie, pozostało, procent, nadwyżka, brak stawki),
   z testami — jak `money.ts` i `reportMerge.ts`.
3. Kafel w `ReportView`, za flagą projektu, **domyślnie wyłączoną**
   (`portalFeatures.ts`, zasada „wdrożenie za flagą").
4. Włączenie: Onyx 3 h, WDF 35 h 42 m — osobną decyzją, po sprawdzeniu na
   projekcie testowym.

## Czego świadomie NIE robimy

- Nie pokazujemy dwóch kresek na pasku dla widełek 3,5–5 tys. To więcej wykresu
  niż informacji.
- Nie liczymy limitu z kwoty w kodzie. Kwota bywa negocjowana i zmienia się
  inaczej niż stawka, więc przeliczanie w locie dałoby liczbę, której nikt nie
  zatwierdził.
- Nie dokładamy prognozy („w tym tempie skończy się 24.08"). Najpierw niech
  klient zobaczy stan faktyczny.
