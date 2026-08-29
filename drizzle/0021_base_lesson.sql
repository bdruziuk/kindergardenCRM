ALTER TYPE "public"."salary_type" ADD VALUE 'base_lesson';--> statement-breakpoint
ALTER TABLE "job_titles" ADD COLUMN "lesson_rate" numeric(12, 2) DEFAULT 0 NOT NULL;