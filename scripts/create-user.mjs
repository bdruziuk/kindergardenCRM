#!/usr/bin/env node
/**
 * Creates or updates a staff account.
 *
 *   npm run user:create -- <email> <password> [ім'я] [роль]
 *
 * Roles: admin (default) | manager | teacher.
 * The password is hashed with bcrypt before it touches the database. Passing it
 * as an argument leaves it in your shell history — change it after first login,
 * or export MALECHA_PASSWORD instead of passing it here.
 */
import { readFileSync } from "node:fs";
import bcrypt from "bcryptjs";
import pg from "pg";

const ROLES = ["admin", "manager", "teacher"];

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

const [email, passwordArg, name = null, role = "admin"] = process.argv.slice(2);
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

const pool = new pg.Pool({ connectionString: databaseUrl(), max: 1 });
try {
  const passwordHash = await bcrypt.hash(password, 12);
  const { rows } = await pool.query(
    `INSERT INTO users (email, password_hash, name, role)
     VALUES ($1, $2, $3, $4)
     ON CONFLICT (email) DO UPDATE
       SET password_hash = EXCLUDED.password_hash,
           name = EXCLUDED.name,
           role = EXCLUDED.role
     RETURNING id, email, name, role`,
    [email.trim().toLowerCase(), passwordHash, name, role],
  );
  const user = rows[0];
  console.log(
    `Готово: #${user.id} ${user.email} (${user.name ?? "без імені"}) — ${user.role}`,
  );
} finally {
  await pool.end();
}
