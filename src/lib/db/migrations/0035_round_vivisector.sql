-- Odporne na bazę, która wygląda inaczej niż lokalna (awaria 2026-08-14):
-- jedno polecenie kończące się błędem przerywa CAŁĄ migrację i kontener nie
-- wstaje. Nazwy więzów w bazie z `db:push` nie muszą zgadzać się z migratorem.
CREATE TABLE IF NOT EXISTS "pending_reports" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"portal_id" uuid NOT NULL,
	"source" text NOT NULL,
	"clickup_list_id" text NOT NULL,
	"payload" jsonb NOT NULL,
	"actor_user_id" uuid,
	"actor_email" text,
	"actor_name" text,
	"panic_alert_id" uuid,
	"attempts" integer DEFAULT 0 NOT NULL,
	"last_error" text,
	"next_attempt_at" timestamp DEFAULT now() NOT NULL,
	"delivered_at" timestamp,
	"delivered_task_id" text,
	"created_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "panic_alerts" ADD COLUMN IF NOT EXISTS "notify_failed_at" timestamp;
--> statement-breakpoint
DO $$ BEGIN
	ALTER TABLE "pending_reports" ADD CONSTRAINT "pending_reports_portal_id_portals_id_fk" FOREIGN KEY ("portal_id") REFERENCES "public"."portals"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION WHEN duplicate_object THEN null; END $$;
--> statement-breakpoint
DO $$ BEGIN
	ALTER TABLE "pending_reports" ADD CONSTRAINT "pending_reports_actor_user_id_portal_users_id_fk" FOREIGN KEY ("actor_user_id") REFERENCES "public"."portal_users"("id") ON DELETE set null ON UPDATE no action;
EXCEPTION WHEN duplicate_object THEN null; END $$;
--> statement-breakpoint
DO $$ BEGIN
	ALTER TABLE "pending_reports" ADD CONSTRAINT "pending_reports_panic_alert_id_panic_alerts_id_fk" FOREIGN KEY ("panic_alert_id") REFERENCES "public"."panic_alerts"("id") ON DELETE set null ON UPDATE no action;
EXCEPTION WHEN duplicate_object THEN null; END $$;
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "pending_reports_pending_idx" ON "pending_reports" USING btree ("delivered_at","next_attempt_at");
