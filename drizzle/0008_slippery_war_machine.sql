CREATE TYPE "public"."waitlist_status" AS ENUM('waiting', 'invited', 'enrolled', 'declined');--> statement-breakpoint
CREATE TABLE "waitlist" (
	"id" serial PRIMARY KEY NOT NULL,
	"branch_id" integer NOT NULL,
	"child_name" text NOT NULL,
	"child_birth_date" date,
	"parent_name" text NOT NULL,
	"parent_phone" text NOT NULL,
	"parent_email" text,
	"preferred_group_id" integer,
	"desired_from" date,
	"status" "waitlist_status" DEFAULT 'waiting' NOT NULL,
	"note" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "waitlist" ADD CONSTRAINT "waitlist_branch_id_branches_id_fk" FOREIGN KEY ("branch_id") REFERENCES "public"."branches"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "waitlist" ADD CONSTRAINT "waitlist_preferred_group_id_groups_id_fk" FOREIGN KEY ("preferred_group_id") REFERENCES "public"."groups"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "idx_waitlist_branch_status" ON "waitlist" USING btree ("branch_id","status");