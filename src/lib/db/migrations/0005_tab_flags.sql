ALTER TABLE "portals" ADD COLUMN "kanban_enabled" boolean DEFAULT true NOT NULL;--> statement-breakpoint
ALTER TABLE "portals" ADD COLUMN "history_enabled" boolean DEFAULT false NOT NULL;--> statement-breakpoint
ALTER TABLE "portals" ADD COLUMN "dashboard_enabled" boolean DEFAULT false NOT NULL;