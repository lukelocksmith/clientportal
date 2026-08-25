-- Zrodlo stawki (link do projektu w CRM) oraz domyslna osoba przypisywana
-- do zadan zakladanych z portalu.
--
-- `IF NOT EXISTS`, mimo ze generator tego nie stawia: bazy stawiane przez
-- `db:push` maja kolumny spoza `__drizzle_migrations`, a jedno polecenie
-- konczace sie bledem przerywa CALA migracje (awaria produkcji 2026-08-14).
ALTER TABLE "portals" ADD COLUMN IF NOT EXISTS "notion_project_url" text;--> statement-breakpoint
ALTER TABLE "portals" ADD COLUMN IF NOT EXISTS "default_assignee_id" integer;
