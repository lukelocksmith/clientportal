-- Stawka godzinowa NETTO w groszach, do kwoty w raporcie czasu pracy.
-- Kopia stawki z CRM (Notion, baza "B: PROJEKT", kolumna Godzinowka).
--
-- `IF NOT EXISTS`, mimo ze generator tego nie stawia: bazy stawiane przez
-- `db:push` maja kolumny spoza `__drizzle_migrations`, a jedno polecenie
-- konczace sie bledem przerywa CALA migracje i aplikacja nie wstaje
-- (awaria produkcji 2026-08-14).
ALTER TABLE "portals" ADD COLUMN IF NOT EXISTS "hourly_rate_net" integer;
