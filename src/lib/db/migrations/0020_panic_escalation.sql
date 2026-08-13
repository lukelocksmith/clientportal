ALTER TABLE "panic_alerts" ADD COLUMN "clickup_task_id" text;--> statement-breakpoint
ALTER TABLE "panic_alerts" ADD COLUMN "escalated_at" timestamp;--> statement-breakpoint
ALTER TABLE "panic_alerts" ADD COLUMN "escalation_count" integer DEFAULT 0 NOT NULL;