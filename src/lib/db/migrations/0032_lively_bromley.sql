-- Obserwatorzy zadania: kto POZA zglaszajacym dostaje maila o sprawie.
-- Powod istnienia przy tabeli w schema.ts.
--
-- `IF NOT EXISTS` i wiezy w blokach DO, mimo ze generator tego nie stawia:
-- bazy stawiane przez `db:push` maja obiekty spoza `__drizzle_migrations`,
-- a jedno polecenie konczace sie bledem przerywa CALA migracje i aplikacja
-- nie wstaje (awaria produkcji 2026-08-14).
CREATE TABLE IF NOT EXISTS "task_watchers" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"portal_id" uuid NOT NULL,
	"clickup_task_id" text NOT NULL,
	"user_id" uuid NOT NULL,
	"added_by" uuid,
	"created_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
DO $$ BEGIN
	ALTER TABLE "task_watchers" ADD CONSTRAINT "task_watchers_portal_id_portals_id_fk" FOREIGN KEY ("portal_id") REFERENCES "public"."portals"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION
	WHEN duplicate_object THEN NULL;
END $$;
--> statement-breakpoint
DO $$ BEGIN
	ALTER TABLE "task_watchers" ADD CONSTRAINT "task_watchers_user_id_portal_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."portal_users"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION
	WHEN duplicate_object THEN NULL;
END $$;
--> statement-breakpoint
DO $$ BEGIN
	ALTER TABLE "task_watchers" ADD CONSTRAINT "task_watchers_added_by_portal_users_id_fk" FOREIGN KEY ("added_by") REFERENCES "public"."portal_users"("id") ON DELETE set null ON UPDATE no action;
EXCEPTION
	WHEN duplicate_object THEN NULL;
END $$;
--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "task_watchers_task_user_idx" ON "task_watchers" USING btree ("portal_id","clickup_task_id","user_id");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "task_watchers_task_idx" ON "task_watchers" USING btree ("portal_id","clickup_task_id");
