-- Potwierdzanie alarmu linkiem z maila zostalo usuniete 13.08.2026.
--
-- Kazde polecenie ma IF EXISTS, bo produkcyjna baza powstala inaczej niz lokalna
-- i NIE MA wiezu unikalnosci na ack_token. Bez tego migracja przerywa sie na
-- pierwszej linii, aplikacja nie wstaje i portal zwraca 503 (zdarzylo sie
-- 14.08.2026, kod bledu 42704).
ALTER TABLE "panic_alerts" DROP CONSTRAINT IF EXISTS "panic_alerts_ack_token_unique";--> statement-breakpoint
ALTER TABLE "panic_alerts" DROP COLUMN IF EXISTS "ack_token";--> statement-breakpoint
ALTER TABLE "panic_alerts" DROP COLUMN IF EXISTS "acknowledged_at";--> statement-breakpoint
ALTER TABLE "panic_alerts" DROP COLUMN IF EXISTS "acknowledged_by";
