CREATE TYPE "public"."attendance_kind" AS ENUM('worked', 'absent', 'vacation', 'day_off');--> statement-breakpoint
ALTER TABLE "staff" ADD COLUMN "vacation_quota" integer DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE "staff" ADD COLUMN "day_off_quota" integer DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE "staff_attendance" ADD COLUMN "kind" "attendance_kind";;--> statement-breakpoint
-- Carry the boolean over before the next migration drops it.
UPDATE "staff_attendance"
SET "kind" = CASE WHEN "worked" THEN 'worked'::attendance_kind
                  ELSE 'absent'::attendance_kind END