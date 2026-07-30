-- Kto zgłosił: przypisanie zdarzeń w portalu do osoby.
--
-- 1. audit_log dostaje zdenormalizowane user_email/user_name. Powód jest ten
--    sam, co w ai_usage: historia musi przeżyć usunięcie konta. Sam user_id
--    po usunięciu użytkownika zostawiłby wiersze bez żadnej informacji o tym,
--    kto to zgłosił, czyli dokładnie odwrotnie do celu tej tabeli.
--
-- 2. Klucze obce w audit_log NIE mają ON DELETE, czyli zachowują się jak
--    NO ACTION. Usunięcie użytkownika, który zgłosił cokolwiek, kończy się
--    naruszeniem klucza obcego. Dotychczas trafiało to tylko autorów pomysłów
--    (rzadkość), od teraz trafiłoby każdego. Użytkownik: SET NULL (wiersz
--    zostaje, e-mail mamy obok). Portal: CASCADE, spójnie z resztą schematu.
--
-- 3. panic_alerts nie zapisywały autora w ogóle. Alarm trafiał na Discorda
--    i maila jako "ALARM od klienta <projekt>", bez wskazania osoby, więc przy
--    kilku użytkownikach jednego klienta nie było do kogo oddzwonić.

ALTER TABLE "audit_log" ADD COLUMN "user_email" text;--> statement-breakpoint
ALTER TABLE "audit_log" ADD COLUMN "user_name" text;--> statement-breakpoint

ALTER TABLE "audit_log" DROP CONSTRAINT IF EXISTS "audit_log_user_id_portal_users_id_fk";--> statement-breakpoint
ALTER TABLE "audit_log" ADD CONSTRAINT "audit_log_user_id_portal_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."portal_users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint

ALTER TABLE "audit_log" DROP CONSTRAINT IF EXISTS "audit_log_portal_id_portals_id_fk";--> statement-breakpoint
ALTER TABLE "audit_log" ADD CONSTRAINT "audit_log_portal_id_portals_id_fk" FOREIGN KEY ("portal_id") REFERENCES "public"."portals"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint

-- Lista zdarzeń projektu w panelu, od najnowszych.
CREATE INDEX IF NOT EXISTS "audit_log_portal_created_idx" ON "audit_log" USING btree ("portal_id","created_at");--> statement-breakpoint
-- Odstęp między pomysłami jednego użytkownika (portalIdeas.ideaSubmittedRecently).
CREATE INDEX IF NOT EXISTS "audit_log_user_action_idx" ON "audit_log" USING btree ("user_id","action","created_at");--> statement-breakpoint

ALTER TABLE "panic_alerts" ADD COLUMN "user_id" uuid;--> statement-breakpoint
ALTER TABLE "panic_alerts" ADD COLUMN "user_email" text;--> statement-breakpoint
ALTER TABLE "panic_alerts" ADD COLUMN "user_name" text;--> statement-breakpoint
ALTER TABLE "panic_alerts" ADD CONSTRAINT "panic_alerts_user_id_portal_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."portal_users"("id") ON DELETE set null ON UPDATE no action;
