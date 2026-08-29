CREATE TABLE "group_staff" (
	"id" serial PRIMARY KEY NOT NULL,
	"group_id" integer NOT NULL,
	"staff_id" integer NOT NULL
);
--> statement-breakpoint
ALTER TABLE "group_staff" ADD CONSTRAINT "group_staff_group_id_groups_id_fk" FOREIGN KEY ("group_id") REFERENCES "public"."groups"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "group_staff" ADD CONSTRAINT "group_staff_staff_id_staff_id_fk" FOREIGN KEY ("staff_id") REFERENCES "public"."staff"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "idx_group_staff" ON "group_staff" USING btree ("group_id","staff_id");