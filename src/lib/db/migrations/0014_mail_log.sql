-- Rejestr wysłanych maili.
--
-- Powstał po konkretnym zdarzeniu: 2026-08-03 dodano konto dla klienta, osoba
-- powiedziała, że nie dostała zaproszenia, i ustalenie prawdy wymagało wejścia
-- po SSH do logów postfixa oraz odpytania API Brevo. Panel nie wiedział o tym
-- mailu NIC, bo wynik wysyłki był zwracany w odpowiedzi HTTP i tam ginął.
--
-- Zapisujemy odpowiedź serwera SMTP w `detail`, nie tylko sukces lub porażkę.
-- To ona odróżnia „przyjęte do wysyłki" od „dostarczone" i bez niej nie da się
-- powiedzieć, czyj jest problem: nasz, przekaźnika czy odbiorcy.

CREATE TABLE IF NOT EXISTS "mail_log" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"portal_id" uuid,
	-- Adres odbiorcy. Zostaje po usunięciu konta, tak jak w audit_log:
	-- pytanie „czy ten człowiek dostał zaproszenie" ma sens także wtedy,
	-- gdy konta już nie ma.
	"recipient" text NOT NULL,
	-- 'invite' | 'reset' | 'password-changed' | 'panic'
	"kind" text NOT NULL,
	"subject" text NOT NULL,
	"ok" boolean NOT NULL,
	-- Odpowiedź serwera SMTP przy sukcesie, treść błędu przy porażce.
	"detail" text,
	-- Identyfikator wiadomości. Po nim szuka się jej w logach przekaźnika.
	"message_id" text,
	"created_at" timestamp DEFAULT now() NOT NULL
);--> statement-breakpoint

ALTER TABLE "mail_log" ADD CONSTRAINT "mail_log_portal_id_portals_id_fk" FOREIGN KEY ("portal_id") REFERENCES "public"."portals"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint

-- Lista w panelu: per projekt, od najnowszych.
CREATE INDEX IF NOT EXISTS "mail_log_portal_created_idx" ON "mail_log" USING btree ("portal_id","created_at");--> statement-breakpoint
-- „Czy TEN adres cokolwiek od nas dostał", niezależnie od projektu.
CREATE INDEX IF NOT EXISTS "mail_log_recipient_idx" ON "mail_log" USING btree ("recipient","created_at");
