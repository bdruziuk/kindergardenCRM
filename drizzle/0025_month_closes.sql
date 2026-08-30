CREATE TABLE "month_closes" (
	"id" serial PRIMARY KEY NOT NULL,
	"branch_id" integer NOT NULL,
	"month" date NOT NULL,
	"data" text NOT NULL,
	"closed_at" timestamp with time zone DEFAULT now() NOT NULL,
	"closed_by" integer
);
--> statement-breakpoint
ALTER TABLE "month_closes" ADD CONSTRAINT "month_closes_branch_id_branches_id_fk" FOREIGN KEY ("branch_id") REFERENCES "public"."branches"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "month_closes" ADD CONSTRAINT "month_closes_closed_by_users_id_fk" FOREIGN KEY ("closed_by") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "idx_month_closes_branch_month" ON "month_closes" USING btree ("branch_id","month");