ALTER TABLE "panic_alerts" DROP CONSTRAINT "panic_alerts_ack_token_unique";--> statement-breakpoint
ALTER TABLE "panic_alerts" DROP COLUMN "ack_token";--> statement-breakpoint
ALTER TABLE "panic_alerts" DROP COLUMN "acknowledged_at";--> statement-breakpoint
ALTER TABLE "panic_alerts" DROP COLUMN "acknowledged_by";