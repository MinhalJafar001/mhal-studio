import { neon } from "@neondatabase/serverless";
import { DATABASE_URL } from "astro:env/server";

// Neon's HTTP driver: one query per request, no connection pool to manage in serverless.
// Returns null when DATABASE_URL isn't set so callers can fail gracefully.
let client: ReturnType<typeof neon> | undefined;

export function getSql() {
  if (!DATABASE_URL) return null;
  client ??= neon(DATABASE_URL);
  return client;
}
