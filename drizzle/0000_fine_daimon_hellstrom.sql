CREATE TYPE "public"."child_status" AS ENUM('active', 'paused', 'left');--> statement-breakpoint
CREATE TYPE "public"."payment_method" AS ENUM('cash', 'iban', 'card');--> statement-breakpoint
CREATE TYPE "public"."salary_type" AS ENUM('monthly', 'daily');--> statement-breakpoint
CREATE TYPE "public"."transaction_type" AS ENUM('income', 'expense');--> statement-breakpoint
CREATE TYPE "public"."user_role" AS ENUM('admin', 'manager', 'teacher');--> statement-breakpoint
CREATE TABLE "branches" (
	"id" serial PRIMARY KEY NOT NULL,
	"name" text NOT NULL,
	"address" text,
	"monthly_fee" numeric(12, 2) DEFAULT 0 NOT NULL
);
--> statement-breakpoint
CREATE TABLE "children" (
	"id" serial PRIMARY KEY NOT NULL,
	"branch_id" integer NOT NULL,
	"group_id" integer,
	"full_name" text NOT NULL,
	"birth_date" date,
	"custom_fee" numeric(12, 2),
	"status" "child_status" DEFAULT 'active' NOT NULL
);
--> statement-breakpoint
CREATE TABLE "groups" (
	"id" serial PRIMARY KEY NOT NULL,
	"branch_id" integer NOT NULL,
	"name" text NOT NULL,
	"age_range" text DEFAULT '' NOT NULL,
	"icon" text DEFAULT '✦' NOT NULL,
	"color" text DEFAULT 'star' NOT NULL
);
--> statement-breakpoint
CREATE TABLE "payments" (
	"id" serial PRIMARY KEY NOT NULL,
	"child_id" integer NOT NULL,
	"billing_month" date NOT NULL,
	"amount" numeric(12, 2) NOT NULL,
	"method" "payment_method" NOT NULL,
	"paid_at" date NOT NULL,
	"note" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "relatives" (
	"id" serial PRIMARY KEY NOT NULL,
	"child_id" integer NOT NULL,
	"full_name" text NOT NULL,
	"relation" text DEFAULT 'Родич' NOT NULL,
	"phone" text,
	"email" text
);
--> statement-breakpoint
CREATE TABLE "staff" (
	"id" serial PRIMARY KEY NOT NULL,
	"branch_id" integer NOT NULL,
	"full_name" text NOT NULL,
	"role" text NOT NULL,
	"salary_type" "salary_type" DEFAULT 'monthly' NOT NULL,
	"monthly_rate" numeric(12, 2) DEFAULT 0 NOT NULL,
	"daily_rate" numeric(12, 2) DEFAULT 0 NOT NULL,
	"benefit_enabled" boolean DEFAULT false NOT NULL,
	"benefit_salary" numeric(12, 2) DEFAULT 0 NOT NULL,
	"benefit_note" text DEFAULT '' NOT NULL,
	"active" boolean DEFAULT true NOT NULL
);
--> statement-breakpoint
CREATE TABLE "staff_attendance" (
	"id" serial PRIMARY KEY NOT NULL,
	"staff_id" integer NOT NULL,
	"work_date" date NOT NULL,
	"worked" boolean NOT NULL
);
--> statement-breakpoint
CREATE TABLE "transactions" (
	"id" serial PRIMARY KEY NOT NULL,
	"branch_id" integer NOT NULL,
	"type" "transaction_type" NOT NULL,
	"category" text NOT NULL,
	"amount" numeric(12, 2) NOT NULL,
	"occurred_at" date NOT NULL,
	"note" text
);
--> statement-breakpoint
CREATE TABLE "users" (
	"id" serial PRIMARY KEY NOT NULL,
	"email" text NOT NULL,
	"password_hash" text NOT NULL,
	"name" text,
	"role" "user_role" DEFAULT 'admin' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "children" ADD CONSTRAINT "children_branch_id_branches_id_fk" FOREIGN KEY ("branch_id") REFERENCES "public"."branches"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "children" ADD CONSTRAINT "children_group_id_groups_id_fk" FOREIGN KEY ("group_id") REFERENCES "public"."groups"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "groups" ADD CONSTRAINT "groups_branch_id_branches_id_fk" FOREIGN KEY ("branch_id") REFERENCES "public"."branches"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "payments" ADD CONSTRAINT "payments_child_id_children_id_fk" FOREIGN KEY ("child_id") REFERENCES "public"."children"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "relatives" ADD CONSTRAINT "relatives_child_id_children_id_fk" FOREIGN KEY ("child_id") REFERENCES "public"."children"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "staff" ADD CONSTRAINT "staff_branch_id_branches_id_fk" FOREIGN KEY ("branch_id") REFERENCES "public"."branches"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "staff_attendance" ADD CONSTRAINT "staff_attendance_staff_id_staff_id_fk" FOREIGN KEY ("staff_id") REFERENCES "public"."staff"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "transactions" ADD CONSTRAINT "transactions_branch_id_branches_id_fk" FOREIGN KEY ("branch_id") REFERENCES "public"."branches"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "idx_branches_name" ON "branches" USING btree ("name");--> statement-breakpoint
CREATE INDEX "idx_children_branch_group" ON "children" USING btree ("branch_id","group_id");--> statement-breakpoint
CREATE UNIQUE INDEX "idx_groups_branch_name" ON "groups" USING btree ("branch_id","name");--> statement-breakpoint
CREATE INDEX "idx_payments_month_child" ON "payments" USING btree ("billing_month","child_id");--> statement-breakpoint
CREATE INDEX "idx_relatives_child" ON "relatives" USING btree ("child_id");--> statement-breakpoint
CREATE INDEX "idx_staff_branch" ON "staff" USING btree ("branch_id");--> statement-breakpoint
CREATE UNIQUE INDEX "idx_attendance_staff_date" ON "staff_attendance" USING btree ("staff_id","work_date");--> statement-breakpoint
CREATE INDEX "idx_transactions_branch_date" ON "transactions" USING btree ("branch_id","occurred_at");--> statement-breakpoint
CREATE UNIQUE INDEX "idx_users_email" ON "users" USING btree ("email");