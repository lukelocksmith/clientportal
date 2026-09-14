CREATE TABLE IF NOT EXISTS "app_errors" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"path" text NOT NULL,
	"method" text NOT NULL,
	"route_type" text,
	"message" text NOT NULL,
	"digest" text,
	"stack" text,
	"alerted" boolean DEFAULT false NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "app_errors_created_idx" ON "app_errors" USING btree ("created_at");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "app_errors_digest_idx" ON "app_errors" USING btree ("digest","created_at");