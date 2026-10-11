CREATE TABLE "staff_deductions" (
	"id" serial PRIMARY KEY NOT NULL,
	"staff_id" integer NOT NULL,
	"month" date NOT NULL,
	"amount" numeric(12, 2) NOT NULL,
	"note" text
);
--> statement-breakpoint
ALTER TABLE "staff_deductions" ADD CONSTRAINT "staff_deductions_staff_id_staff_id_fk" FOREIGN KEY ("staff_id") REFERENCES "public"."staff"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "idx_staff_deductions" ON "staff_deductions" USING btree ("staff_id","month");