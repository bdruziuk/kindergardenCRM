CREATE TYPE "public"."payment_purpose" AS ENUM('tuition', 'entrance');--> statement-breakpoint
ALTER TABLE "payments" ADD COLUMN "purpose" "payment_purpose" DEFAULT 'tuition' NOT NULL;