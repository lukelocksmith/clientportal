CREATE TABLE "task_status_history" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"portal_id" uuid NOT NULL,
	"clickup_task_id" text NOT NULL,
	"task_name" text NOT NULL,
	"from_status" text,
	"to_status" text NOT NULL,
	"source" text NOT NULL,
	"actor_user_id" uuid,
	"actor_label" text,
	"changed_at" timestamp DEFAULT now() NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "task_status_history" ADD CONSTRAINT "task_status_history_portal_id_portals_id_fk" FOREIGN KEY ("portal_id") REFERENCES "public"."portals"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "task_status_history" ADD CONSTRAINT "task_status_history_actor_user_id_portal_users_id_fk" FOREIGN KEY ("actor_user_id") REFERENCES "public"."portal_users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "task_status_history_task_idx" ON "task_status_history" USING btree ("portal_id","clickup_task_id","changed_at");--> statement-breakpoint
CREATE INDEX "task_status_history_portal_idx" ON "task_status_history" USING btree ("portal_id","changed_at");