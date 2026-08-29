CREATE TABLE "job_titles" (
	"id" serial PRIMARY KEY NOT NULL,
	"kindergarten_id" integer NOT NULL,
	"branch_id" integer,
	"name" text NOT NULL,
	"added_by_owner" boolean DEFAULT true NOT NULL
);
--> statement-breakpoint
ALTER TABLE "job_titles" ADD CONSTRAINT "job_titles_kindergarten_id_kindergartens_id_fk" FOREIGN KEY ("kindergarten_id") REFERENCES "public"."kindergartens"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "job_titles" ADD CONSTRAINT "job_titles_branch_id_branches_id_fk" FOREIGN KEY ("branch_id") REFERENCES "public"."branches"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "idx_job_titles_library" ON "job_titles" USING btree ("kindergarten_id","name") WHERE "job_titles"."branch_id" is null;--> statement-breakpoint
CREATE UNIQUE INDEX "idx_job_titles_branch" ON "job_titles" USING btree ("branch_id","name") WHERE "job_titles"."branch_id" is not null;--> statement-breakpoint
-- Наповнюємо бібліотеку кожного садочка тим самим списком, який досі був
-- захардкоджений у сторінці «Колектив», — щоб після оновлення випадайка не
-- виявилась порожньою.
INSERT INTO "job_titles" ("kindergarten_id", "branch_id", "name")
SELECT k."id", NULL, t."name"
FROM "kindergartens" k
CROSS JOIN (VALUES
  ('Вихователь'),
  ('Помічник вихователя'),
  ('Вчитель'),
  ('Кухар'),
  ('Помічник кухаря')
) AS t("name")
ON CONFLICT DO NOTHING;
--> statement-breakpoint
-- Той самий набір — у кожну наявну філію.
INSERT INTO "job_titles" ("kindergarten_id", "branch_id", "name")
SELECT b."kindergarten_id", b."id", t."name"
FROM "branches" b
CROSS JOIN (VALUES
  ('Вихователь'),
  ('Помічник вихователя'),
  ('Вчитель'),
  ('Кухар'),
  ('Помічник кухаря')
) AS t("name")
ON CONFLICT DO NOTHING;
--> statement-breakpoint
-- І посади, які вже стоять у картках працівників: серед них є ті, яких у
-- захардкодженому списку не було, і без цього вони зникли б із вибору.
INSERT INTO "job_titles" ("kindergarten_id", "branch_id", "name")
SELECT b."kindergarten_id", s."branch_id", s."role"
FROM "staff" s
JOIN "branches" b ON b."id" = s."branch_id"
WHERE s."role" <> ''
ON CONFLICT DO NOTHING;
