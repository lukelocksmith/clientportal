ALTER TABLE "portals" ADD COLUMN IF NOT EXISTS "portal_tag_only" boolean DEFAULT false NOT NULL;--> statement-breakpoint
ALTER TABLE "task_index" ADD COLUMN IF NOT EXISTS "has_portal_tag" boolean DEFAULT false NOT NULL;--> statement-breakpoint
ALTER TABLE "task_index" ADD COLUMN IF NOT EXISTS "portal_visible" boolean DEFAULT false NOT NULL;