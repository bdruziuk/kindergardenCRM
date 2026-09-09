CREATE TYPE "public"."transaction_direction" AS ENUM('expense', 'income');--> statement-breakpoint
ALTER TABLE "transactions" ADD COLUMN "direction" "transaction_direction" DEFAULT 'expense' NOT NULL;