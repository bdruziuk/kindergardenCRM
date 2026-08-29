-- One-off import of the legacy display-oriented `ui_*` tables into the
-- normalised schema. Safe to run once against a freshly migrated database;
-- it aborts if the target tables already hold rows.
--
-- Run with:
--   docker exec -i malecha-postgres psql -U malecha -d malecha < scripts/import-ui-data.sql
--
-- The legacy ids are preserved so foreign keys map across without lookup
-- tables; sequences are re-synced at the end.

BEGIN;

DO $$
BEGIN
  IF (SELECT COUNT(*) FROM children) > 0 OR (SELECT COUNT(*) FROM branches) > 0
  THEN
    RAISE EXCEPTION 'Target tables are not empty — import already ran';
  END IF;
END $$;

-- 1. Branches. Only "Центральна" ever held data; the other two exist because
--    the UI branch selector offers them.
INSERT INTO branches (id, name, address, monthly_fee) VALUES
  (1, 'Центральна', NULL, 12500),
  (2, 'На Лісовій', NULL, 12500),
  (3, 'Поділ',      NULL, 12500);

-- 2. Groups.
INSERT INTO groups (id, branch_id, name, age_range, icon, color)
SELECT id, 1, name, COALESCE(age_range, ''), COALESCE(icon, '✦'),
       COALESCE(color, 'star')
FROM ui_groups;

-- 3. Children.
--    * age_label ("4 роки") carried no real date of birth, so it is turned
--      into 1 January of the implied birth year, which reproduces the same
--      displayed age. "—" becomes NULL.
--    * fee_label ("12 500 ₴") is parsed to a number; when it equals the
--      branch fee it becomes NULL, so a non-null custom_fee now genuinely
--      means "individual fee".
INSERT INTO children (id, branch_id, group_id, full_name, birth_date,
                      custom_fee, status)
SELECT
  c.id,
  1,
  g.id,
  c.full_name,
  CASE
    WHEN NULLIF(regexp_replace(c.age_label, '[^0-9]', '', 'g'), '') IS NULL
      THEN NULL
    ELSE make_date(
      EXTRACT(YEAR FROM CURRENT_DATE)::int
        - regexp_replace(c.age_label, '[^0-9]', '', 'g')::int,
      1, 1)
  END,
  NULLIF(
    NULLIF(regexp_replace(c.fee_label, '[^0-9]', '', 'g'), '')::numeric,
    12500),
  CASE c.status
    WHEN 'Пауза'  THEN 'paused'
    WHEN 'Вибула' THEN 'left'
    ELSE 'active'
  END::child_status
FROM ui_children c
LEFT JOIN ui_groups g ON g.name = c.group_name;

-- 4. Relatives. The duplicated relative_name/phone columns on ui_children are
--    dropped: ui_relatives already holds the same first contact.
INSERT INTO relatives (id, child_id, full_name, relation, phone, email)
SELECT id, child_id, full_name, COALESCE(NULLIF(relation_note, ''), 'Родич'),
       NULLIF(phone, '—'), NULL
FROM ui_relatives;

-- 5. Payments.
INSERT INTO payments (id, child_id, billing_month, amount, method, paid_at,
                      note, created_at)
SELECT id, child_id, billing_month, amount,
  CASE method
    WHEN 'Готівка' THEN 'cash'
    WHEN 'IBAN'    THEN 'iban'
    WHEN 'Карта'   THEN 'card'
  END::payment_method,
  paid_at, NULL, created_at
FROM ui_payments;

-- 6. Staff.
INSERT INTO staff (id, branch_id, full_name, role, salary_type, monthly_rate,
                   daily_rate, benefit_enabled, benefit_salary, benefit_note,
                   active)
SELECT s.id, COALESCE(b.id, 1), s.full_name, s.role, s.salary_type::salary_type,
       s.monthly_rate, s.daily_rate, s.benefit_enabled, s.benefit_salary,
       COALESCE(s.benefit_note, ''), s.active
FROM ui_staff s
LEFT JOIN branches b ON b.name = s.branch;

-- 7. Attendance.
INSERT INTO staff_attendance (id, staff_id, work_date, worked)
SELECT id, staff_id, work_date, worked FROM ui_staff_attendance;

-- 8. Re-sync sequences so future inserts do not collide with the copied ids.
SELECT setval(pg_get_serial_sequence('branches', 'id'),
              GREATEST((SELECT MAX(id) FROM branches), 1));
SELECT setval(pg_get_serial_sequence('groups', 'id'),
              GREATEST((SELECT MAX(id) FROM groups), 1));
SELECT setval(pg_get_serial_sequence('children', 'id'),
              GREATEST((SELECT MAX(id) FROM children), 1));
SELECT setval(pg_get_serial_sequence('relatives', 'id'),
              GREATEST((SELECT MAX(id) FROM relatives), 1));
SELECT setval(pg_get_serial_sequence('payments', 'id'),
              GREATEST((SELECT MAX(id) FROM payments), 1));
SELECT setval(pg_get_serial_sequence('staff', 'id'),
              GREATEST((SELECT MAX(id) FROM staff), 1));
SELECT setval(pg_get_serial_sequence('staff_attendance', 'id'),
              GREATEST((SELECT MAX(id) FROM staff_attendance), 1));

COMMIT;
