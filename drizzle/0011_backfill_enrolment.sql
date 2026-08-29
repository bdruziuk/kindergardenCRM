-- Заповнення дат зарахування й вибуття для дітей, заведених до появи цих полів.
-- Найраніший місяць, за який дитині нарахували оплату, — найкраще наближення
-- дати зарахування, яке в нас є.
UPDATE "children" AS c
SET "enrolled_at" = p.first_month
FROM (
  SELECT "child_id", min("billing_month") AS first_month
  FROM "payments"
  GROUP BY "child_id"
) AS p
WHERE p."child_id" = c."id" AND c."enrolled_at" IS NULL;
--> statement-breakpoint
-- Тим, хто вже позначений як вибулий, датою вибуття стає кінець останнього
-- оплаченого місяця: після нього дитина в жодному звіті вже не рахується.
UPDATE "children" AS c
SET "left_at" = (p.last_month + interval '1 month' - interval '1 day')::date
FROM (
  SELECT "child_id", max("billing_month") AS last_month
  FROM "payments"
  GROUP BY "child_id"
) AS p
WHERE p."child_id" = c."id" AND c."status" = 'left' AND c."left_at" IS NULL;
