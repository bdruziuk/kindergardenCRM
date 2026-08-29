-- The benefit rate is being removed. Where it was active it *was* the salary
-- actually paid, so fold it into monthly_rate before dropping the columns —
-- otherwise those people would silently get a raise back to the nominal rate.
UPDATE "staff"
SET "monthly_rate" = "benefit_salary"
WHERE "benefit_enabled" = true AND "salary_type" = 'monthly';--> statement-breakpoint
ALTER TABLE "staff" DROP COLUMN "benefit_enabled";--> statement-breakpoint
ALTER TABLE "staff" DROP COLUMN "benefit_salary";--> statement-breakpoint
ALTER TABLE "staff" DROP COLUMN "benefit_note";