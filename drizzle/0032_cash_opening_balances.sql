CREATE TABLE "cash_opening_balances" (
	"id" serial PRIMARY KEY NOT NULL,
	"branch_id" integer NOT NULL,
	"method" "payment_method" NOT NULL,
	"amount" numeric(12, 2) DEFAULT '0' NOT NULL,
	"as_of" date NOT NULL,
	"note" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"created_by" integer
);
--> statement-breakpoint
ALTER TABLE "cash_opening_balances" ADD CONSTRAINT "cash_opening_balances_branch_id_branches_id_fk" FOREIGN KEY ("branch_id") REFERENCES "public"."branches"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "cash_opening_balances" ADD CONSTRAINT "cash_opening_balances_created_by_users_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "idx_cash_opening_branch_method_date" ON "cash_opening_balances" USING btree ("branch_id","method","as_of");--> statement-breakpoint
-- Каса читає оплати за датою оплати, а не за місяцем нарахування; без цього
-- індексу кожен місяць фінансів робив би повний прохід по таблиці.
CREATE INDEX IF NOT EXISTS "idx_payments_paid_at" ON "payments" USING btree ("paid_at");
