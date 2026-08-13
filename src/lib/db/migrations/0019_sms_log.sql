CREATE TABLE "sms_log" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"portal_id" uuid,
	"recipient" text NOT NULL,
	"kind" text NOT NULL,
	"text" text NOT NULL,
	"ok" boolean NOT NULL,
	"detail" text,
	"provider_message_id" text,
	"state" text,
	"created_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "sms_log" ADD CONSTRAINT "sms_log_portal_id_portals_id_fk" FOREIGN KEY ("portal_id") REFERENCES "public"."portals"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "sms_log_portal_created_idx" ON "sms_log" USING btree ("portal_id","created_at");--> statement-breakpoint
CREATE INDEX "sms_log_recipient_idx" ON "sms_log" USING btree ("recipient","created_at");