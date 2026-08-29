CREATE TYPE "public"."salary_kind" AS ENUM('advance', 'salary');--> statement-breakpoint
CREATE TABLE "salary_payments" (
	"id" serial PRIMARY KEY NOT NULL,
	"staff_id" integer NOT NULL,
	"month" date NOT NULL,
	"kind" "salary_kind" NOT NULL,
	"amount" numeric(12, 2) NOT NULL,
	"paid_at" date NOT NULL,
	"note" text
);
--> statement-breakpoint
ALTER TABLE "salary_payments" ADD CONSTRAINT "salary_payments_staff_id_staff_id_fk" FOREIGN KEY ("staff_id") REFERENCES "public"."staff"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "idx_salary_payments_staff_month" ON "salary_payments" USING btree ("staff_id","month");--> statement-breakpoint
CREATE INDEX "idx_salary_payments_paid_at" ON "salary_payments" USING btree ("paid_at");