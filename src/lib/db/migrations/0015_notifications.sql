-- Powiadomienia o tym, co dzieje się w zadaniach, oraz ustawienia profilu.
--
-- Portal miał dotąd jeden kanał wyjścia do klienta: mail przy zaproszeniu i
-- resecie hasła. O odpowiedzi zespołu w zadaniu klient dowiadywał się tylko
-- wtedy, gdy sam wszedł i sprawdził. Przy planie opieki z czasami reakcji
-- zapisanymi w ofercie to obciąża obie strony.
--
-- Świadomie BEZ Redisa i bez osobnego silnika kolejek (rozważony i odrzucony
-- Novu, patrz spec z 2026-08-06): „do wysłania w zbiorczym mailu" to po prostu
-- `email_sent_at IS NULL`, a cykliczne uruchomienie robi istniejący cron.

CREATE TABLE IF NOT EXISTS "notifications" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"portal_id" uuid NOT NULL,
	"user_id" uuid NOT NULL,
	-- 'comment' | 'status' | 'closed' | 'panic_ack'
	"kind" text NOT NULL,
	"clickup_task_id" text,
	-- Nazwa zadania zdenormalizowana celowo. Powiadomienie ma pozostać
	-- czytelne, gdy zadanie zniknie z ClickUpa albo wypadnie poza folder
	-- klienta. Dociąganie nazwy przy wyświetlaniu znaczyłoby zapytanie do
	-- cudzego API przy każdym otwarciu dzwonka.
	"task_name" text NOT NULL,
	-- Co jest potrzebne do treści maila i dzwonka: przy 'comment' fragment
	-- i autor, przy 'status' stary i nowy status. Trzymamy to tutaj, żeby
	-- wysyłka nie musiała pytać ClickUpa o stan sprzed godziny, którego on
	-- już nie pamięta.
	"payload" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL,
	-- NULL = nieprzeczytane. Zasila licznik przy dzwonku.
	"read_at" timestamp,
	-- NULL = czeka na zbiorczy mail. Stempel stawia zarówno wysyłka
	-- natychmiastowa, jak i digest, więc jedno powiadomienie nigdy nie
	-- pójdzie mailem dwa razy.
	"email_sent_at" timestamp
);--> statement-breakpoint

ALTER TABLE "notifications" ADD CONSTRAINT "notifications_portal_id_portals_id_fk" FOREIGN KEY ("portal_id") REFERENCES "public"."portals"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "notifications" ADD CONSTRAINT "notifications_user_id_portal_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."portal_users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint

-- Dzwonek: nieprzeczytane danej osoby, od najnowszych.
CREATE INDEX IF NOT EXISTS "notifications_user_unread_idx" ON "notifications" USING btree ("user_id","read_at","created_at");--> statement-breakpoint
-- Digest: co czeka na maila. Osobny indeks, bo pyta o inną kolumnę niż dzwonek.
CREATE INDEX IF NOT EXISTS "notifications_user_pending_mail_idx" ON "notifications" USING btree ("user_id","email_sent_at");--> statement-breakpoint

-- Profil użytkownika.
--
-- Zdjęcie trzymamy jako data URI w kolumnie, bo portal nie ma i nie chce mieć
-- magazynu plików: załączniki zadań idą prosto do ClickUpa. Obraz jest
-- skalowany do 256×256 WebP PO STRONIE PRZEGLĄDARKI, więc mowa o kilkunastu
-- kilobajtach. Nie wolno go zwracać w payloadach list; jest do tego osobna
-- trasa z cache (patrz spec).
ALTER TABLE "portal_users" ADD COLUMN IF NOT EXISTS "avatar_url" text;--> statement-breakpoint

-- Ustawienia powiadomień, dwie grupy o różnej pilności.
-- Obie przyjmują 'instant' | 'daily' | 'never'.
--
-- Domyślne wartości są celowo różne: na odpowiedź zespołu klient czeka, więc
-- idzie od razu, natomiast statusy potrafią lecieć seriami przy porządkowaniu
-- tablicy i domyślne 'instant' zamieniłoby to w zalew poczty.
ALTER TABLE "portal_users" ADD COLUMN IF NOT EXISTS "notify_important" text DEFAULT 'instant' NOT NULL;--> statement-breakpoint
ALTER TABLE "portal_users" ADD COLUMN IF NOT EXISTS "notify_board" text DEFAULT 'daily' NOT NULL;
