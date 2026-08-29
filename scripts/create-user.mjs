#!/usr/bin/env node
/**
 * Creates or updates a staff account.
 *
 *   npm run user:create -- <email> <password> [ім'я] [роль] [садочок]
 *
 * Roles: superadmin | admin (default) | manager | teacher.
 * Садочок — його назва; обов'язковий для всіх ролей, крім superadmin, бо той
 * стоїть над садочками й до жодного не належить. Решта без садочка не пройде
 * resolveScope() і побачить лише помилку.
 * The password is hashed with bcrypt before it touches the database. Passing it
 * as an argument leaves it in your shell history — change it after first login,
 * or export MALECHA_PASSWORD instead of passing it here.
 */
import { readFileSync } from "node:fs";
import bcrypt from "bcryptjs";
import pg from "pg";

const ROLES = ["superadmin", "admin", "manager", "teacher"];

function databaseUrl() {
  if (process.env.DATABASE_URL) return process.env.DATABASE_URL;
  try {
    const match = readFileSync(".env.local", "utf8").match(
      /^DATABASE_URL=(.*)$/m,
    );
    if (match) return match[1].trim();
  } catch {
    /* fall through */
  }
  throw new Error("DATABASE_URL is not set (env or .env.local)");
}

const [email, passwordArg, name = null, role = "admin", kindergarten = null] =
  process.argv.slice(2);
const password = passwordArg ?? process.env.MALECHA_PASSWORD;

if (!email || !password) {
  console.error(
    "Usage: npm run user:create -- <email> <password> [ім'я] [роль]",
  );
  process.exit(1);
}
if (!ROLES.includes(role)) {
  console.error(`Невідома роль "${role}". Доступні: ${ROLES.join(", ")}`);
  process.exit(1);
}
if (password.length < 8) {
  console.error("Пароль має бути щонайменше 8 символів.");
  process.exit(1);
}
if (role !== "superadmin" && !kindergarten) {
  console.error(
    `Ролі "${role}" потрібен садочок: npm run user:create -- <email> <пароль> "<ім'я>" ${role} "<назва садочка>"`,
  );
  process.exit(1);
}

const pool = new pg.Pool({ connectionString: databaseUrl(), max: 1 });
try {
  let kindergartenId = null;
  if (kindergarten) {
    const found = await pool.query(
      "SELECT id FROM kindergartens WHERE name = $1",
      [kindergarten],
    );
    if (!found.rows.length) {
      console.error(`Садочка "${kindergarten}" немає.`);
      process.exit(1);
    }
    kindergartenId = found.rows[0].id;
  }

  const passwordHash = await bcrypt.hash(password, 12);
  const { rows } = await pool.query(
    `INSERT INTO users (email, password_hash, name, role, kindergarten_id)
     VALUES ($1, $2, $3, $4, $5)
     ON CONFLICT (email) DO UPDATE
       SET password_hash = EXCLUDED.password_hash,
           name = EXCLUDED.name,
           role = EXCLUDED.role,
           kindergarten_id = EXCLUDED.kindergarten_id
     RETURNING id, email, name, role`,
    [email.trim().toLowerCase(), passwordHash, name, role, kindergartenId],
  );
  const user = rows[0];
  console.log(
    `Готово: #${user.id} ${user.email} (${user.name ?? "без імені"}) — ${user.role}`,
  );
} finally {
  await pool.end();
}
