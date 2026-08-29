-- Income is never entered by hand — the only money coming in is the monthly
-- fee, which lives in `payments`. Drop any income rows before removing the
-- column, otherwise they would silently be reinterpreted as expenses.
DELETE FROM "transactions" WHERE "type" = 'income';--> statement-breakpoint
ALTER TABLE "transactions" DROP COLUMN "type";--> statement-breakpoint
DROP TYPE "public"."transaction_type";