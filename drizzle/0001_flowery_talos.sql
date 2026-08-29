ALTER TYPE "public"."salary_type" ADD VALUE 'lesson';--> statement-breakpoint
CREATE TABLE "lessons" (
	"id" serial PRIMARY KEY NOT NULL,
	"staff_id" integer NOT NULL,
	"work_date" date NOT NULL,
	"note" text
);
--> statement-breakpoint
ALTER TABLE "staff" ADD COLUMN "lesson_rate" numeric(12, 2) DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE "lessons" ADD CONSTRAINT "lessons_staff_id_staff_id_fk" FOREIGN KEY ("staff_id") REFERENCES "public"."staff"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "idx_lessons_staff_date" ON "lessons" USING btree ("staff_id","work_date");