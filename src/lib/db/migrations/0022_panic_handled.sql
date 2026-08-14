-- Kto i kiedy przejal sprawe. IF NOT EXISTS, bo produkcyjna baza powstala
-- inaczej niz lokalna i migracja przerwana w polowie nie pozwala wstac
-- aplikacji (14.08.2026, kod 42704).
ALTER TABLE "panic_alerts" ADD COLUMN IF NOT EXISTS "handled_at" timestamp;--> statement-breakpoint
ALTER TABLE "panic_alerts" ADD COLUMN IF NOT EXISTS "handled_by" text;
