import { readFileSync } from "node:fs";
import { defineConfig } from "drizzle-kit";

// drizzle-kit does not read .env.local, so load it here. Real deployments set
// DATABASE_URL in the environment and this file is simply absent.
function databaseUrl() {
  if (process.env.DATABASE_URL) return process.env.DATABASE_URL;
  try {
    const match = readFileSync(".env.local", "utf8").match(
      /^DATABASE_URL=(.*)$/m,
    );
    if (match) return match[1].trim();
  } catch {
    // fall through to the error below
  }
  throw new Error("DATABASE_URL is not set (env or .env.local)");
}

export default defineConfig({
  out: "./drizzle",
  schema: "./db/schema.ts",
  dialect: "postgresql",
  dbCredentials: { url: databaseUrl() },
});
