-- Log diagnostyczny SitePinga: co sie stalo z zadaniem HTTP z widgetu na
-- stronie klienta. Najwazniejsze sa wiersze ODMOWNE (zly Origin, limit,
-- niepelna konfiguracja) — dzis koncza sie `return`-em bez sladu gdziekolwiek.
--
-- `IF NOT EXISTS` i wiez w bloku DO, mimo ze generator tego nie stawia: bazy
-- stawiane przez `db:push` maja obiekty spoza `__drizzle_migrations`, a jedno
-- polecenie konczace sie bledem przerywa CALA migracje i aplikacja nie wstaje
-- (awaria produkcji 2026-08-14).
CREATE TABLE IF NOT EXISTS "siteping_log" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"portal_id" uuid NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"method" text NOT NULL,
	"status" integer NOT NULL,
	"outcome" text NOT NULL,
	"origin" text,
	"ip_prefix" text,
	"duration_ms" integer,
	"clickup_task_id" text,
	"detail" text
);
--> statement-breakpoint
DO $$ BEGIN
	ALTER TABLE "siteping_log" ADD CONSTRAINT "siteping_log_portal_id_portals_id_fk" FOREIGN KEY ("portal_id") REFERENCES "public"."portals"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION
	WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "siteping_log_portal_created_idx" ON "siteping_log" USING btree ("portal_id","created_at");
