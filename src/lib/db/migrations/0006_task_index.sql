CREATE TABLE "cron_runs" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"job" text NOT NULL,
	"portal_id" uuid,
	"ok" boolean NOT NULL,
	"items_processed" integer DEFAULT 0 NOT NULL,
	"detail" text,
	"started_at" timestamp NOT NULL,
	"finished_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "task_index" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"portal_id" uuid NOT NULL,
	"clickup_task_id" text NOT NULL,
	"name" text NOT NULL,
	"description" text,
	"status" text NOT NULL,
	"status_type" text NOT NULL,
	"priority" text,
	"list_name" text,
	"parent_id" text,
	"url" text,
	"date_created" bigint NOT NULL,
	"date_updated" bigint NOT NULL,
	"date_closed" bigint,
	"attachment_count" integer DEFAULT 0 NOT NULL,
	"public_comment_count" integer DEFAULT 0 NOT NULL,
	"subtask_count" integer DEFAULT 0 NOT NULL,
	"search_text" text DEFAULT '' NOT NULL,
	"content_synced_at" timestamp,
	"indexed_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "cron_runs" ADD CONSTRAINT "cron_runs_portal_id_portals_id_fk" FOREIGN KEY ("portal_id") REFERENCES "public"."portals"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "task_index" ADD CONSTRAINT "task_index_portal_id_portals_id_fk" FOREIGN KEY ("portal_id") REFERENCES "public"."portals"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "cron_runs_job_finished_idx" ON "cron_runs" USING btree ("job","finished_at");--> statement-breakpoint
CREATE UNIQUE INDEX "task_index_portal_task_idx" ON "task_index" USING btree ("portal_id","clickup_task_id");--> statement-breakpoint
CREATE INDEX "task_index_portal_created_idx" ON "task_index" USING btree ("portal_id","date_created");