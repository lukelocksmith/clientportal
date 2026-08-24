-- Rozmowa z klientem, wlasnosc portalu (krok 1:
-- docs/superpowers/specs/2026-08-09-portal-2.0-kierunek-design.md).
--
-- `IF NOT EXISTS` na tabeli i indeksach: lokalne bazy stawiane przez
-- `db:push` maja obiekty, ktorych nie ma w `__drizzle_migrations`, a jedno
-- polecenie konczace sie bledem przerywa CALA migracje (awaria 2026-08-14).
CREATE TABLE IF NOT EXISTS "task_comments" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"portal_id" uuid NOT NULL,
	"clickup_task_id" text NOT NULL,
	"clickup_comment_id" text NOT NULL,
	"author_type" text NOT NULL,
	"author_id" uuid,
	"author_label" text NOT NULL,
	"body" text NOT NULL,
	"published_at" timestamp NOT NULL,
	"edited_at" timestamp,
	"deleted_at" timestamp,
	"source" text NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
DO $$ BEGIN
	ALTER TABLE "task_comments" ADD CONSTRAINT "task_comments_portal_id_portals_id_fk" FOREIGN KEY ("portal_id") REFERENCES "public"."portals"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION
	WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
	ALTER TABLE "task_comments" ADD CONSTRAINT "task_comments_author_id_portal_users_id_fk" FOREIGN KEY ("author_id") REFERENCES "public"."portal_users"("id") ON DELETE set null ON UPDATE no action;
EXCEPTION
	WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "task_comments_clickup_comment_idx" ON "task_comments" USING btree ("clickup_comment_id");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "task_comments_task_idx" ON "task_comments" USING btree ("portal_id","clickup_task_id","published_at");
