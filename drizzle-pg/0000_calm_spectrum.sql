CREATE TYPE "public"."payment_method" AS ENUM('cash', 'bank');--> statement-breakpoint
CREATE TYPE "public"."salary_kind" AS ENUM('advance', 'salary');--> statement-breakpoint
CREATE TYPE "public"."transaction_type" AS ENUM('income', 'expense');--> statement-breakpoint
CREATE TABLE "branches" (
	"id" serial PRIMARY KEY NOT NULL,
	"name" text NOT NULL,
	"address" text,
	"monthly_fee" numeric(12, 2) DEFAULT '0' NOT NULL
);
--> statement-breakpoint
CREATE TABLE "children" (
	"id" serial PRIMARY KEY NOT NULL,
	"branch_id" integer,
	"group_id" integer,
	"full_name" text NOT NULL,
	"birth_date" text,
	"custom_fee" numeric(12, 2),
	"active" boolean DEFAULT true NOT NULL
);
--> statement-breakpoint
CREATE TABLE "groups" (
	"id" serial PRIMARY KEY NOT NULL,
	"branch_id" integer,
	"name" text NOT NULL,
	"age_range" text
);
--> statement-breakpoint
CREATE TABLE "payments" (
	"id" serial PRIMARY KEY NOT NULL,
	"child_id" integer,
	"month" text NOT NULL,
	"amount" numeric(12, 2) DEFAULT '0' NOT NULL,
	"method" "payment_method",
	"paid_at" text NOT NULL,
	"receipt_key" text,
	"note" text
);
--> statement-breakpoint
CREATE TABLE "relatives" (
	"id" serial PRIMARY KEY NOT NULL,
	"child_id" integer,
	"full_name" text NOT NULL,
	"relation" text NOT NULL,
	"phone" text,
	"email" text
);
--> statement-breakpoint
CREATE TABLE "salary_payments" (
	"id" serial PRIMARY KEY NOT NULL,
	"staff_id" integer,
	"month" text NOT NULL,
	"kind" "salary_kind" NOT NULL,
	"amount" numeric(12, 2) NOT NULL,
	"paid_at" text NOT NULL
);
--> statement-breakpoint
CREATE TABLE "staff" (
	"id" serial PRIMARY KEY NOT NULL,
	"branch_id" integer,
	"full_name" text NOT NULL,
	"role" text NOT NULL,
	"salary" numeric(12, 2) DEFAULT '0' NOT NULL,
	"active" boolean DEFAULT true NOT NULL
);
--> statement-breakpoint
CREATE TABLE "transactions" (
	"id" serial PRIMARY KEY NOT NULL,
	"branch_id" integer,
	"type" "transaction_type" NOT NULL,
	"category" text NOT NULL,
	"amount" numeric(12, 2) NOT NULL,
	"occurred_at" text NOT NULL,
	"note" text
);
--> statement-breakpoint
CREATE TABLE "users" (
	"id" serial PRIMARY KEY NOT NULL,
	"external_id" text NOT NULL,
	"email" text NOT NULL,
	"name" text,
	"role" text DEFAULT 'admin' NOT NULL
);
--> statement-breakpoint
ALTER TABLE "children" ADD CONSTRAINT "children_branch_id_branches_id_fk" FOREIGN KEY ("branch_id") REFERENCES "public"."branches"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "children" ADD CONSTRAINT "children_group_id_groups_id_fk" FOREIGN KEY ("group_id") REFERENCES "public"."groups"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "groups" ADD CONSTRAINT "groups_branch_id_branches_id_fk" FOREIGN KEY ("branch_id") REFERENCES "public"."branches"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "payments" ADD CONSTRAINT "payments_child_id_children_id_fk" FOREIGN KEY ("child_id") REFERENCES "public"."children"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "relatives" ADD CONSTRAINT "relatives_child_id_children_id_fk" FOREIGN KEY ("child_id") REFERENCES "public"."children"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "salary_payments" ADD CONSTRAINT "salary_payments_staff_id_staff_id_fk" FOREIGN KEY ("staff_id") REFERENCES "public"."staff"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "staff" ADD CONSTRAINT "staff_branch_id_branches_id_fk" FOREIGN KEY ("branch_id") REFERENCES "public"."branches"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "transactions" ADD CONSTRAINT "transactions_branch_id_branches_id_fk" FOREIGN KEY ("branch_id") REFERENCES "public"."branches"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "idx_children_branch_group" ON "children" USING btree ("branch_id","group_id");--> statement-breakpoint
CREATE INDEX "idx_groups_branch" ON "groups" USING btree ("branch_id");--> statement-breakpoint
CREATE INDEX "idx_payments_child_month" ON "payments" USING btree ("child_id","month");--> statement-breakpoint
CREATE INDEX "idx_relatives_child" ON "relatives" USING btree ("child_id");--> statement-breakpoint
CREATE INDEX "idx_salary_staff_month" ON "salary_payments" USING btree ("staff_id","month");--> statement-breakpoint
CREATE INDEX "idx_staff_branch" ON "staff" USING btree ("branch_id");--> statement-breakpoint
CREATE INDEX "idx_transactions_branch_date" ON "transactions" USING btree ("branch_id","occurred_at");--> statement-breakpoint
CREATE UNIQUE INDEX "idx_users_external" ON "users" USING btree ("external_id");