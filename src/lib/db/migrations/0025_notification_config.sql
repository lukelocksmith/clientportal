-- Macierz powiadomien per projekt (lib/notifyConfig.ts).
--
-- `IF NOT EXISTS`, mimo ze generator tego nie stawia: lokalne bazy stawiane
-- przez `db:push` maja kolumny, ktorych nie ma w `__drizzle_migrations`, a
-- jedno polecenie konczace sie bledem przerywa CALA migracje i aplikacja nie
-- wstaje (awaria produkcji 2026-08-14).
ALTER TABLE "portals" ADD COLUMN IF NOT EXISTS "notification_config" jsonb;
