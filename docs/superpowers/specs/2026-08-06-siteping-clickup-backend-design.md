# SitePing → ClickUp: backend zgłoszeń ze strony klienta

Data: 2026-08-06
Status: zaakceptowany, gotowy do planu wdrożenia

## Kontekst

Klienci zgłaszają poprawki na swoich stronach przez zewnętrzne SaaS SimpleCommenter (simplecommenter.ee), którego webhook nie przekazuje CSS selectora / dokładnego miejsca zmiany (potwierdzone mailem do aleksander@simplecommenter.ee, czerwiec 2026, bez odpowiedzi). Efekt: zespół dostaje zgłoszenie bez wiedzy, którego elementu ono dotyczy.

`@siteping/widget` (npm, siteping.dev, MIT, self-hosted, shadow-dom) to inny, osobny produkt — już używany na `demo.important.is` (repo `demo-app`) do zbierania feedbacku na prototypach. Łapie `cssSelector`, `xpath`, fragment tekstu, `elementTag/Id`, pozycję w % viewportu, screenshot (html2canvas) i diagnostykę konsoli/sieci — czyli dokładnie to, czego brakuje w SimpleCommenter. demo-app ma już sprawdzony wzorzec backendu w trybie „endpoint” (Hono, `/sp/:slug`), ale zapisuje zgłoszenia lokalnie do JSON, bez ClickUpa.

Ten spec dotyczy **wyłącznie fundamentu**: publicznego endpointu w Client Portalu, który przyjmuje zgłoszenia z widgetu osadzonego na żywej stronie klienta i tworzy z nich zadania ClickUp z pełną lokalizacją. Poza zakresem (osobne przyszłe sub-projekty):
- osadzenie widgetu w motywie WordPress klienta,
- przycisk „Nowe zadanie na stronie” + redirect w UI portalu,
- znacznik w czacie AI („pokaż gdzie to jest”) i przekazanie anotacji do rozmowy,
- autonomiczna naprawa przez AI na instancji testowej.

## Decyzje i ich uzasadnienie

| Decyzja | Uzasadnienie |
|---|---|
| Zgłoszenie z widgetu tworzy zadanie w ClickUp **od razu**, bez mediacji czatu AI | Widget ma własny formularz (treść, typ, autor) — dokładnie jak dziś na demo.important.is. To sprawdzony, prosty flow. Przekazywanie anotacji do trwającej rozmowy z asystentem (widget żyje na domenie klienta, czat w portalu) to międzydomenowy handoff — osobny, większy temat, dopiero gdy ten fundament działa. |
| Backend to nowy endpoint w tym repo, nie osobny serwis | 90% logiki już istnieje: `lib/clickup.ts` (`createTask`, `addTaskAttachment`), tabela `portals` (slug → `clickup_folder_id`, `portal_lists`). Osobny serwis (jak demo-app) duplikowałby to wszystko i wymagał drugiego deployu/monitoringu bez realnej korzyści — mapowanie strona→ClickUp i tak musi czytać z tej samej bazy. |
| Widget self-hosted z `portal.important.is/siteping.js` | Kontrola wersji, i strona klienta dopisuje do CSP jedną naszą domenę, nie zewnętrzny CDN (jsdelivr/unpkg) na swojej produkcji. |
| Ochrona endpointu: allowlist domen (Origin/Referer) per portal + rate-limit, bez tokena w JS | Token w kodzie front-endowym jest widoczny w view-source, więc nie chroni przed kimś, kto podejrzy stronę — daje tylko odsianie przypadkowego ruchu/botów. Sprawdzenie domeny + limit częstotliwości to realna bariera przeciw spamowi do ClickUpa. |
| `portals.site_domains` jako **lista** domen (CSV, jak `contactMemberIds`), nie jedna domena | WDF ma `wdf.important.is` (staging) i `wodadlafirmy.pl` (produkcja) — to dwie różne, realne domeny, nie warianty www/non-www jednej domeny. Jeden portal musi móc zgłaszać z obu. |
| Rollout za flagą `portals.siteping_enabled`, domyślnie `false` | Konsekwentne z `reports_enabled`. Brama po stronie serwera: portal z flagą wyłączoną albo bez `site_domains` dostaje 404 na `/api/siteping/[slug]`, więc znajomość URL-a nic nie daje bez włączenia. |
| Tag ClickUp `siteping` na każdym takim zadaniu | Analogicznie do istniejącego `AWARIA_TAG`. Zespół i klient (tagi już się wyświetlają na karcie) widzą skąd zadanie przyszło, bez zmian w UI kanbanu. |
| Handler HTTP z `@siteping/adapter-prisma` (`createSitepingHandler({ store })`), nie własny routing | Zweryfikowane w realnym pakiecie (npm pack + lektura `.d.ts`), nie zgadywane. Handler już robi routing GET/POST/PATCH/DELETE, walidację Origin (`allowedOrigins`) i auth (`apiKey`/`publicEndpoints`) zgodnie z kontraktem widgetu — pisanie tego od zera byłoby powtórzeniem gotowego, przetestowanego kodu. |
| Dane anotacji jako załącznik JSON na zadaniu (nie custom field ClickUp) | Reużywa istniejący `addTaskAttachment` (już używany do zrzutów z czatu) — zero nowej konfiguracji po stronie ClickUp. `findByClientId`/`getFeedbacks` czytają ClickUp na żywo (marker `siteping-client-id:` w opisie + `getAllTasksForFolder`), nie duplikują stanu w nowej tabeli portalu — konsekwentne z tym, jak kanban już działa. |
| PATCH/DELETE z panelu widgetu pozostają zablokowane (401) | Nie konfigurujemy `apiKey` dla publicznego widgetu, a `createSitepingHandler` domyślnie wymaga go dla operacji destrukcyjnych. Świadomie: anonimowy odwiedzający strony klienta nie powinien móc resolve/delete realnych zadań ClickUp. |

## Data flow

```
Strona klienta (wodadlafirmy.pl)
  └─ <script src="https://portal.important.is/siteping.js">
  └─ initSiteping({ endpoint: "https://portal.important.is/api/siteping/wdf", ... })
       │  klient klika element → widget łapie anchor+rect+screenshot
       │  klient wypełnia formularz widgetu (treść, typ, autor)
       ▼
POST https://portal.important.is/api/siteping/[slug]
       │
       ├─ portal istnieje? siteping_enabled? → inaczej 404
       ├─ Origin/Referer ∈ portals.site_domains? → inaczej 403
       ├─ rate limit per portal/IP → inaczej 429
       ├─ Zod .strict() na payloadzie, cap rozmiaru screenshotu
       ├─ flatten annotation (port z demo-app: SitepingAnnotation/AnnotationPayload)
       ├─ createTask(defaultListId, { description: url+selector+xpath+rect+stopka,
       │                              tags: ['siteping'], status: 'do zrobienia' })
       ├─ addTaskAttachment(taskId, screenshot) — jeśli jest
       ├─ invalidateFolderTasks(portal.clickupFolderId)
       ├─ logEvent(audit_log, source: 'siteping')
       ▼
Odpowiedź w formacie AnnotationResponse/FeedbackResponse, jak oczekuje @siteping/widget
```

## Zmiany w schemacie (`src/lib/db/schema.ts`, nowa migracja)

- `portals.siteping_enabled` (boolean, `not null default false`) — flaga rollout per projekt.
- `portals.site_domains` (text, nullable) — domeny dozwolone dla tego portalu, po przecinku (np. `wdf.important.is,wodadlafirmy.pl`), sprawdzane wobec `Origin`/`Referer` żądania. Ten sam styl co istniejące `contactMemberIds`.

## Endpoint: `src/app/api/siteping/[slug]/route.ts`

**Zweryfikowane w pakiecie (nie zgadywane):** ściągnięty i rozpakowany `@siteping/widget@0.10.7` + `@siteping/adapter-prisma@0.6.4` + `@siteping/adapter-kit@0.1.0` z npm pokazują gotowy, oficjalny handler:

```ts
import { createSitepingHandler } from '@siteping/adapter-prisma' // działa też bez Prismy — patrz store: poniżej
export const { GET, POST, PATCH, DELETE, OPTIONS } = createSitepingHandler({
  store: mojaStoreDlaPortalu,
  allowedOrigins: portal.siteDomains.split(','),
  // apiKey NIE ustawiamy — widget woła POST bez sesji z przeglądarki klienta.
  // Bez apiKey PATCH/DELETE i tak zwracają 401 (`requireAuthForDestructive` domyślnie true) —
  // to jest pożądane: panel widgetu nie ma prawa resolve/delete realnych zadań ClickUp.
})
```

Nie portujemy `flattenAnnotation`/routingu z demo-app — `flattenAnnotation` jest eksportowane z samego pakietu, a `createSitepingHandler` już implementuje routing metod, walidację payloadu i allowlistę Origin. Nasza jedyna praca: napisać obiekt `SitepingStore` (patrz niżej) i podłączyć go pod ten handler.

### `SitepingStore` — ClickUp jako jedyne źródło prawdy (bez nowej tabeli)

Zgodnie z resztą portalu (kanban czyta ClickUp live, nie cache'uje w Postgresie) — `SitepingStore` nie dostaje własnej tabeli. Dane anotacji jadą do ClickUp jako **załącznik JSON** (ten sam mechanizm co `addTaskAttachment` używany już do zrzutów ekranu z czatu), nie jako nowe custom field — nie wymaga żadnej konfiguracji po stronie ClickUp.

- `createFeedback(data)`:
  1. `createTask(defaultListId, { name, description, tags: ['siteping'], status: 'do zrobienia' })` — opis zaczyna się od linii-markera `<!-- siteping-client-id:${data.clientId} -->` (do dedupu, patrz `findByClientId`), dalej URL strony, `cssSelector`, `xpath`, `textSnippet`, rect%, treść zgłoszenia, stopka zgłaszającego.
  2. `addTaskAttachment(taskId, screenshot)` — jeśli `screenshotDataUrl` jest ustawiony.
  3. `addTaskAttachment(taskId, jsonZAnotacja)` — plik `siteping-data.json` z pełnym `FeedbackCreateInput` (annotations + diagnostics), do późniejszego odtworzenia przez `getFeedbacks`.
  4. Zwraca `FeedbackRecord` złożony z tego, co już mamy w pamięci (nie trzeba dociągać z powrotem z ClickUpa — mamy wszystkie dane z `data` + `taskId`).
- `findByClientId(clientId)`: skanuje **już pobraną** listę zadań folderu (`getAllTasksForFolder` — istnieje, jedno wywołanie, bez dodatkowych round-tripów) szukając marker-linii `siteping-client-id:${clientId}` w opisie. Dopasowanie → dociąga załącznik JSON tego jednego zadania i odtwarza pełny `FeedbackRecord`. Brak dopasowania → `null`.
- `getFeedbacks(query)`: `getAllTasksForFolder` (tag `siteping`, filtr po `query.url` na podstawie marker-linii URL w opisie), dla każdego dopasowanego zadania dociąga załącznik JSON (per-task fetch — patrz Ryzyko/koszt niżej) i mapuje na `FeedbackRecord`. Paginacja (`page`/`limit`) po pobraniu i przefiltrowaniu w pamięci.
- `updateFeedback`/`deleteFeedback`/`deleteAllFeedbacks`: zaimplementowane (mapowane na `updateTask`/ClickUp delete) dla kompletności kontraktu `SitepingStore`, ale **nieosiągalne z publicznego widgetu** — `createSitepingHandler` blokuje PATCH/DELETE bez `apiKey`, którego świadomie nie konfigurujemy.
- `verifyProjectOwnership`: sprawdza że zadanie należy do folderu portalu (analogicznie do istniejącego `verifyTaskBelongsToFolder`).

### Budowa opisu zadania (linia markera + treść)
- Pierwsza linia (niewidoczna dla klienta w ClickUp UI jako nagłówek, ale czytelna programowo): `<!-- siteping-client-id:{clientId} -->`.
- Tytuł zadania: pierwsze ~80 znaków treści zgłoszenia (albo generyczne „Zgłoszenie ze strony” gdy treść pusta).
- Opis: URL strony, `cssSelector`, `xpath`, fragment tekstu (`textSnippet`), rect w % + viewport, treść zgłoszenia klienta, stopka zgłaszającego (wzorem `withReporterFooter`, `source: 'siteping'`).
- `tags: ['siteping']`, `status: 'do zrobienia'`, lista = `defaultList` portalu (ten sam wybór co w tool `createTask` czatu AI).

### Koszt/ryzyko odczytu na żywo
`getFeedbacks` robi jeden `getAllTasksForFolder` + N dociągnięć załącznika (N = liczba zgłoszeń na danej stronie, typowo niewielka — panel jest per-URL). Brak nowej tabeli, ale odczyt jest wolniejszy niż read z lokalnej bazy; akceptowalne, bo panel widgetu nie jest krytyczną ścieżką (klient i tak widzi status w kanbanie portalu).

## Bezpieczeństwo

- Origin/Referer musi się zgadzać z jedną z domen w `site_domains` — inaczej 403 (bez rozróżnienia „nie ma takiego portalu” vs „zła domena”, żeby nie ułatwiać rekonesansu).
- Rate-limit per portal + per IP (implementacja w pamięci procesu wystarczy na start — pojedynczy kontener na Coolify; do udokumentowania jako znane ograniczenie, nie do rozwiązania w tym sub-projekcie).
- Zod `.strict()` na całym payloadzie (wzorem `portal-ideas/route.ts`), limit długości treści i rozmiaru screenshotu (odrzucić zamiast próbować skalować/kompresować — to zwiększa powierzchnię błędu bez wyraźnej potrzeby).
- Wszystkie stringi z widgetu (treść, `textSnippet`, `elementTag` itd.) przechodzą przez `esc()` wszędzie, gdzie later renderowane w portalu (TaskDrawer) — ClickUp API samo nie renderuje HTML, ale nasz frontend przy odczycie już tak.

## Obsługa błędów / edge case'y

- Portal nieaktywny / brak flagi / domena spoza listy → odpowiednio 404/404/403, zero zapisu.
- Brak skonfigurowanej domyślnej listy w portalu → błąd zwrócony do widgetu (analogicznie do `{ error: 'Brak skonfigurowanej listy w portalu' }` w tool `createTask`), zadanie nie powstaje.
- Zgłoszenie bez anotacji (widget dopuszcza feedback bez kliknięcia w element) → zadanie i tak powstaje, opis bez sekcji lokalizacji.
- Screenshot przekracza limit → zadanie powstaje bez zrzutu, nie blokujemy całego zgłoszenia.

## Testowanie

Repo nie ma runnera testów — wzorem `scripts/check-timeReports.ts` (`node:assert` + `npx tsx`): osobny skrypt sprawdzający czyste funkcje (`flattenAnnotation`, budowa opisu zadania) bez uderzania w prawdziwy ClickUp. Do tego: ręczny test `curl` na lokalnym dev z podstawionym nagłówkiem `Origin` przeciw allowlist, i end-to-end na jednym realnym portalu (WDF, dwie domeny: staging + produkcja) przed włączeniem flagi gdziekolwiek indziej.

## Ryzyko — zamknięte przed pisaniem planu

Pierwsza wersja tego specu zakładała odtworzenie kontraktu `@siteping/widget` z komentarzy w kodzie demo-app. Zweryfikowane bezpośrednio (`npm pack @siteping/widget@0.10.7 @siteping/adapter-prisma@0.6.4 @siteping/adapter-kit@0.1.0`, lektura `.d.ts`): kontrakt jest inny i lepszy niż zakładano — patrz sekcja „Endpoint” wyżej. Nie ma już otwartego ryzyka co do wire-formatu; ewentualne niejasności przy implementacji dotyczą już tylko naszego kodu (`SitepingStore`), nie kontraktu pakietu.
