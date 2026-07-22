CREATE TABLE "ai_usage" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"portal_id" uuid NOT NULL,
	"user_id" uuid,
	"user_email" text,
	"provider" text NOT NULL,
	"model" text NOT NULL,
	"input_tokens" bigint DEFAULT 0 NOT NULL,
	"output_tokens" bigint DEFAULT 0 NOT NULL,
	"total_tokens" bigint DEFAULT 0 NOT NULL,
	"cost_usd" double precision DEFAULT 0 NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "ai_usage" ADD CONSTRAINT "ai_usage_portal_id_portals_id_fk" FOREIGN KEY ("portal_id") REFERENCES "public"."portals"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "ai_usage" ADD CONSTRAINT "ai_usage_user_id_portal_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."portal_users"("id") ON DELETE set null ON UPDATE no action;