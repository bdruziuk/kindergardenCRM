CREATE TABLE "age_categories" (
	"id" serial PRIMARY KEY NOT NULL,
	"branch_id" integer NOT NULL,
	"name" text NOT NULL,
	"from_year" integer NOT NULL,
	"to_year" integer NOT NULL
);
--> statement-breakpoint
ALTER TABLE "age_categories" ADD CONSTRAINT "age_categories_branch_id_branches_id_fk" FOREIGN KEY ("branch_id") REFERENCES "public"."branches"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "idx_age_categories_branch_name" ON "age_categories" USING btree ("branch_id","name");