CREATE TYPE "public"."fee_mode" AS ENUM('monthly', 'daily');--> statement-breakpoint
CREATE TABLE "child_month_days" (
	"id" serial PRIMARY KEY NOT NULL,
	"child_id" integer NOT NULL,
	"month" date NOT NULL,
	"days" integer NOT NULL
);
--> statement-breakpoint
ALTER TABLE "children" ADD COLUMN "fee_mode" "fee_mode" DEFAULT 'monthly' NOT NULL;--> statement-breakpoint
ALTER TABLE "children" ADD COLUMN "daily_rate" numeric(12, 2) DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE "child_month_days" ADD CONSTRAINT "child_month_days_child_id_children_id_fk" FOREIGN KEY ("child_id") REFERENCES "public"."children"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "idx_child_month_days" ON "child_month_days" USING btree ("child_id","month");