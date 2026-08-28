-- Widgety „Stan strony" na Dashboardzie (dostepnosc, testy, szybkosc) plus
-- token API SuperChecka dla TEGO projektu. Powody obu kolumn przy tabeli
-- w schema.ts.
--
-- `IF NOT EXISTS`, mimo ze generator tego nie stawia: bazy stawiane przez
-- `db:push` maja obiekty spoza `__drizzle_migrations`, a jedno polecenie
-- konczace sie bledem przerywa CALA migracje i aplikacja nie wstaje
-- (awaria produkcji 2026-08-14).
ALTER TABLE "portals" ADD COLUMN IF NOT EXISTS "monitoring_enabled" boolean DEFAULT false NOT NULL;--> statement-breakpoint
ALTER TABLE "portals" ADD COLUMN IF NOT EXISTS "supercheck_token" text;
