CREATE TABLE "task_time_snapshots" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"portal_id" uuid NOT NULL,
	"clickup_task_id" text NOT NULL,
	"time_spent_ms" bigint DEFAULT 0 NOT NULL,
	"snapshot_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "task_time_snapshots" ADD CONSTRAINT "task_time_snapshots_portal_id_portals_id_fk" FOREIGN KEY ("portal_id") REFERENCES "public"."portals"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "task_time_snapshots_portal_task_idx" ON "task_time_snapshots" USING btree ("portal_id","clickup_task_id");
