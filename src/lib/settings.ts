import { OUTREACH_FROM } from "astro:env/server";
import { getSql } from "./db";
import { PHONE } from "./site";

// Small key/value store for dashboard settings (table: settings)

export type SettingKey = "display_name" | "email_signature" | "password_hash" | "session_epoch" | "sheet_last_sync";

export async function getSettings(keys: SettingKey[]): Promise<Partial<Record<SettingKey, any>>> {
  const sql = getSql();
  if (!sql) return {};
  const rows = (await sql`SELECT key, value FROM settings WHERE key = ANY(${keys})`) as { key: SettingKey; value: unknown }[];
  return Object.fromEntries(rows.map((r) => [r.key, r.value]));
}

export async function setSetting(key: SettingKey, value: unknown) {
  const sql = getSql();
  if (!sql) throw new Error("Database is not configured");
  await sql`
    INSERT INTO settings (key, value, updated_at) VALUES (${key}, ${JSON.stringify(value)}::jsonb, now())
    ON CONFLICT (key) DO UPDATE SET value = EXCLUDED.value, updated_at = now()
  `;
}

export async function deleteSetting(key: SettingKey) {
  const sql = getSql();
  if (sql) await sql`DELETE FROM settings WHERE key = ${key}`;
}

export const senderAddress = () => OUTREACH_FROM?.match(/<([^>]+)>/)?.[1] ?? OUTREACH_FROM ?? "";

export const defaultSignature = (name?: string | null) =>
  `Best regards,\n${name ? `${name}\n` : ""}Mhal Studio\n${senderAddress()} · ${PHONE}\nmhalstudio.com`;

// The {signature} used in emails: your saved one, or the default
export async function emailSignature() {
  const s = await getSettings(["email_signature", "display_name"]).catch(() => ({}) as Record<string, any>);
  return (s.email_signature as string) || defaultSignature(s.display_name as string | undefined);
}

// "Minhal Jafar" → "MJ"
export const initials = (name: string) =>
  name
    .split(/\s+/)
    .filter(Boolean)
    .slice(0, 2)
    .map((w) => w[0]!.toUpperCase())
    .join("") || "SA";
