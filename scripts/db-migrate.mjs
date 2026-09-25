// Applies db/schema.sql to the database in DATABASE_URL (read from .env if present).
import { readFileSync, existsSync } from "node:fs";
import { neon } from "@neondatabase/serverless";

if (existsSync(".env")) process.loadEnvFile(".env");
if (!process.env.DATABASE_URL) {
  console.error("DATABASE_URL is not set. Add it to .env (see .env.example).");
  process.exit(1);
}

const sql = neon(process.env.DATABASE_URL);
const statements = readFileSync("db/schema.sql", "utf8")
  .replace(/^--.*$/gm, "")
  .split(";")
  .map((s) => s.trim())
  .filter(Boolean);

for (const statement of statements) {
  await sql.query(statement);
  console.log("✓", statement.split("\n")[0]);
}
console.log("Schema is up to date.");
