-- Odporne na bazę, która wygląda inaczej niż lokalna: produkcja bywa
-- zakładana przez `db:push`, więc nazwy więzów nie muszą się zgadzać
-- z tym, co generuje migrator. Jedno polecenie kończące się błędem przerywa
-- CAŁĄ migrację i kontener nie wstaje (awaria 2026-08-14).
CREATE TABLE IF NOT EXISTS "ai_chat_logs" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"portal_id" uuid NOT NULL,
	"user_id" uuid,
	"user_email" text,
	"provider" text NOT NULL,
	"model" text NOT NULL,
	"outcome" text NOT NULL,
	"task_id" text,
	"task_name" text,
	"finish_reason" text,
	"transcript" jsonb NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
DO $$ BEGIN
	ALTER TABLE "ai_chat_logs" ADD CONSTRAINT "ai_chat_logs_portal_id_portals_id_fk" FOREIGN KEY ("portal_id") REFERENCES "public"."portals"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION WHEN duplicate_object THEN null; END $$;
--> statement-breakpoint
DO $$ BEGIN
	ALTER TABLE "ai_chat_logs" ADD CONSTRAINT "ai_chat_logs_user_id_portal_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."portal_users"("id") ON DELETE set null ON UPDATE no action;
EXCEPTION WHEN duplicate_object THEN null; END $$;
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "ai_chat_logs_portal_created_idx" ON "ai_chat_logs" USING btree ("portal_id","created_at");
