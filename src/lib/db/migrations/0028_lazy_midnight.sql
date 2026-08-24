-- Zapora przed podwojnym powiadomieniem o tym samym zdarzeniu (incydent
-- 24.08: ten sam webhook doszedl dwa razy, powstaly dwa identyczne wpisy).
CREATE TABLE IF NOT EXISTS "notified_events" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"portal_id" uuid NOT NULL,
	"dedupe_key" text NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
DO $$ BEGIN
	ALTER TABLE "notified_events" ADD CONSTRAINT "notified_events_portal_id_portals_id_fk" FOREIGN KEY ("portal_id") REFERENCES "public"."portals"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION
	WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "notified_events_portal_key_idx" ON "notified_events" USING btree ("portal_id","dedupe_key");
