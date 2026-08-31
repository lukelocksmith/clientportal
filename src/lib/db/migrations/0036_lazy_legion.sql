-- Odporne na baze inna niz lokalna (awaria 2026-08-14): jedno polecenie
-- z bledem przerywa CALA migracje i kontener nie wstaje.
CREATE TABLE IF NOT EXISTS "login_throttle" (
	"key" text PRIMARY KEY NOT NULL,
	"attempts" integer DEFAULT 0 NOT NULL,
	"locked_until" timestamp,
	"updated_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "pending_reports" ADD COLUMN IF NOT EXISTS "marker" text;--> statement-breakpoint
ALTER TABLE "pending_reports" ADD COLUMN IF NOT EXISTS "extra" jsonb;