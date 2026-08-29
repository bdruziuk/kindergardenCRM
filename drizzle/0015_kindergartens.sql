ALTER TYPE "public"."user_role" ADD VALUE 'superadmin' BEFORE 'admin';--> statement-breakpoint
CREATE TABLE "kindergartens" (
	"id" serial PRIMARY KEY NOT NULL,
	"name" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX "idx_kindergartens_name" ON "kindergartens" USING btree ("name");--> statement-breakpoint
ALTER TABLE "invites" ADD COLUMN "kindergarten_id" integer;--> statement-breakpoint
ALTER TABLE "users" ADD COLUMN "kindergarten_id" integer;--> statement-breakpoint
-- Колонку додаємо nullable: у філій уже є рядки, а значення для них треба
-- спершу створити. NOT NULL ставимо нижче, коли всі заповнені.
ALTER TABLE "branches" ADD COLUMN "kindergarten_id" integer;--> statement-breakpoint
-- Усе, що вже є, належало одному садочку — заводимо його й переносимо туди
-- філії, людей і чинні запрошення.
INSERT INTO "kindergartens" ("name")
SELECT 'Малеча'
WHERE EXISTS (SELECT 1 FROM "branches")
   OR EXISTS (SELECT 1 FROM "users");
--> statement-breakpoint
UPDATE "branches" SET "kindergarten_id" = (SELECT min("id") FROM "kindergartens")
WHERE "kindergarten_id" IS NULL;--> statement-breakpoint
UPDATE "users" SET "kindergarten_id" = (SELECT min("id") FROM "kindergartens")
WHERE "kindergarten_id" IS NULL;--> statement-breakpoint
UPDATE "invites" SET "kindergarten_id" = (SELECT min("id") FROM "kindergartens")
WHERE "kindergarten_id" IS NULL;--> statement-breakpoint
ALTER TABLE "branches" ALTER COLUMN "kindergarten_id" SET NOT NULL;--> statement-breakpoint
ALTER TABLE "branches" ADD CONSTRAINT "branches_kindergarten_id_kindergartens_id_fk" FOREIGN KEY ("kindergarten_id") REFERENCES "public"."kindergartens"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "invites" ADD CONSTRAINT "invites_kindergarten_id_kindergartens_id_fk" FOREIGN KEY ("kindergarten_id") REFERENCES "public"."kindergartens"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "users" ADD CONSTRAINT "users_kindergarten_id_kindergartens_id_fk" FOREIGN KEY ("kindergarten_id") REFERENCES "public"."kindergartens"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
DROP INDEX "idx_branches_name";--> statement-breakpoint
CREATE UNIQUE INDEX "idx_branches_name" ON "branches" USING btree ("kindergarten_id","name");
