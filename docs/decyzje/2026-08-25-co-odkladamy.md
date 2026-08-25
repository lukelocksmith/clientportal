# Co świadomie odkładamy — stan na 2026-08-25

Zapis decyzji, żeby za miesiąc nie było pytania „czy to zginęło". Nie zginęło:
zostało odłożone, i tu jest napisane dlaczego oraz kiedy do tego wrócić.

---

## 1. Krok 2 „Portal 2.0": przełączenie ODCZYTU komentarzy na `task_comments`

**Stan:** tabela `task_comments` istnieje i **napełnia się** (od 24.08). Portal
nadal **czyta** komentarze z ClickUpa na żywo.

**Decyzja Łukasza (25.08):** odkładamy. Powiadomienia i komentarze działają bez
tego, więc przełączanie źródła odczytu nie kupuje dziś nic, czego klient by nie
miał, a jest zmianą w ścieżce, którą klient ogląda przy każdym otwarciu zadania.

**Co to blokuje:** dopóki odczyt idzie z ClickUpa, portal nie jest od niego
niezależny. Funkcje z kroków 3-4 specu (oznaczenia osób, wątki wewnętrzne,
zmiana widoczności po fakcie) wymagają najpierw tego przełączenia.

**Kiedy wrócić:** gdy pojawi się pierwsza funkcja wymagająca własnego modelu
widoczności, albo gdy odczyt z ClickUpa zacznie boleć (limity API, wolne
ładowanie szuflady).

**Jak to zrobić bezpiecznie:** za flagą per portal (`comments_v2_enabled`),
najpierw jeden projekt, tak jak opisuje spec. Dane już się zbierają, więc w
chwili przełączenia historia będzie kompletna.

Spec: `docs/superpowers/specs/2026-08-09-portal-2.0-kierunek-design.md`, „Krok 1"
i „Kolejność wdrożenia".

---

## 2. Zbiorczy mail dzienny (digest) — ODRZUCONY, nie odłożony

**Decyzja Łukasza (25.08):** nie budujemy. Pytanie brzmiało wprost: „po co nam
zbiorczy mail dzienny, skoro wysyłamy powiadomienia od razu?". Nie ma dobrej
odpowiedzi — digest miał sens w projekcie, w którym powiadomienia natychmiastowe
byłyby zbyt częste, a przy macierzy ustawianej per projekt to admin decyduje,
które zdarzenia w ogóle mailują.

**Konsekwencja, o której trzeba pamiętać:** preferencja użytkownika `daily`
(kolumny `portal_users.notify_board`, domyślnie `daily`) jest dziś traktowana
jak `instant` (patrz `notifyProducer.ts`). Czyli seria zmian statusów wyśle
serię maili. Regulacja jest w macierzy: przy zdarzeniu „status" trzymamy mail
odznaczony.

**Martwy kod do sprzątnięcia przy okazji:** `pendingDigest` i `stampEmailSent`
w `src/lib/notificationStore.ts` nie mają wywołań produkcyjnych. Zostają na
wypadek powrotu tematu; jeśli po kilku miesiącach nikt o digest nie zapyta,
usunąć razem z kolumną `email_sent_at`... UWAGA: `email_sent_at` jest UŻYWANE
przez wysyłkę natychmiastową jako stempel, więc kolumna zostaje niezależnie.

---

## 3. SMS do klienta — odłożone do kolejnej wersji

**Stan:** kolumna SMS jest w macierzy powiadomień **widoczna i nieaktywna**, z
podpisem wyjaśniającym dlaczego.

**Czego brakuje:** `portal_users` nie ma kolumny z numerem telefonu. To nie jest
przełącznik do włączenia, tylko: zebranie numerów, zgoda na kontakt SMS-em,
kolumna w bazie, obsługa w producencie powiadomień.

**Decyzja Łukasza (25.08):** „to nie ma teraz znaczenia".

**Dlaczego kolumna zostaje widoczna:** kratka, którą da się zaznaczyć i która
nic nie robi, jest gorsza niż wyraźnie wyłączona — ktoś zaznaczyłby ją,
obiecał klientowi SMS-y i nikt by nie zauważył, że nie chodzą. Patrz
`src/components/admin/NotificationMatrix.tsx`.

Bramka SMS istnieje i działa (alarmy, `src/lib/sms.ts`), więc to jest brakujące
dane i zgoda, nie brakująca technologia.

---

## 4. Profil użytkownika: preferencje powiadomień NIE wchodzą

Spec `2026-08-06-powiadomienia-i-profil-design.md` przewidywał na profilu
ustawienia powiadomień użytkownika. **Ta część jest nieaktualna.**

**Powód:** 24.08 Łukasz zdecydował, że o kanałach powiadomień decyduje
ADMINISTRATOR per projekt (`portals.notification_config`), nie klient. Dwa
miejsca sterujące tym samym dawałyby pytanie „dlaczego nie dostaję maila", na
które odpowiedź wymagałaby sprawdzenia obu.

Reszta specu profilu (imię, zdjęcie, zmiana hasła) jest aktualna i budowana
25.08.
