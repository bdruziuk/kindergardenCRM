ALTER TABLE "job_titles" ADD COLUMN "salary_type" "salary_type" DEFAULT 'monthly' NOT NULL;--> statement-breakpoint
ALTER TABLE "job_titles" ADD COLUMN "rate" numeric(12, 2) DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE "job_titles" ADD COLUMN "vacation_quota" integer DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE "job_titles" ADD COLUMN "day_off_quota" integer DEFAULT 0 NOT NULL;