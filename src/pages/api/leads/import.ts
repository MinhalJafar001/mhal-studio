import type { APIRoute } from "astro";
import { SHEET_SYNC_SECRET } from "astro:env/server";
import { getSql } from "../../../lib/db";
import { safeEqual } from "../../../lib/auth";

export const prerender = false;

// Receives rows from the Google Sheet script (scripts/google-sheet-sync.gs) and upserts them
// as 'manual' leads, keyed by the sheet's stable row ID. Auth: `Authorization: Bearer <SHEET_SYNC_SECRET>`.

const MAX_ROWS = 2000;
const LIMITS = { business_name: 160, name: 120, position: 120, email: 254, phone: 40, website: 300 } as const;

type Row = Record<keyof typeof LIMITS | "external_id", string | null>;

const json = (status: number, body: object) => Response.json(body, { status });

function clean(raw: Record<string, unknown>): Row | null {
  const text = (v: unknown, max: number) => {
    const s = String(v ?? "").trim().replace(/\s+/g, " ");
    return s ? s.slice(0, max) : null;
  };
  const external_id = text(raw.id, 64);
  const row: Row = {
    external_id,
    business_name: text(raw.business_name, LIMITS.business_name),
    name: text(raw.contact_person, LIMITS.name),
    position: text(raw.position, LIMITS.position),
    email: text(raw.email, LIMITS.email)?.toLowerCase() ?? null,
    phone: text(raw.phone, LIMITS.phone),
    website: text(raw.website, LIMITS.website),
  };
  // Needs an ID and at least something to identify the lead by
  if (!external_id || !(row.business_name || row.name || row.email)) return null;
  return row;
}

export const POST: APIRoute = async ({ request }) => {
  if (!SHEET_SYNC_SECRET || SHEET_SYNC_SECRET.length < 32) return json(503, { ok: false, error: "Sheet sync is not configured." });

  const token = request.headers.get("authorization")?.replace(/^Bearer\s+/i, "") ?? "";
  if (!safeEqual(token, SHEET_SYNC_SECRET)) return json(401, { ok: false, error: "Unauthorized." });

  let body: { leads?: unknown };
  try {
    body = await request.json();
  } catch {
    return json(400, { ok: false, error: "Body must be JSON." });
  }
  if (!Array.isArray(body.leads)) return json(400, { ok: false, error: "Expected { leads: [...] }." });
  if (body.leads.length > MAX_ROWS) return json(413, { ok: false, error: `Too many rows (max ${MAX_ROWS}).` });

  // Last occurrence wins if the same row ID appears twice
  const rows = new Map<string, Row>();
  for (const raw of body.leads) {
    const row = raw && typeof raw === "object" ? clean(raw as Record<string, unknown>) : null;
    if (row) rows.set(row.external_id!, row);
  }
  const skipped = body.leads.length - rows.size;
  if (rows.size === 0) return json(200, { ok: true, received: body.leads.length, inserted: 0, updated: 0, skipped });

  const sql = getSql();
  if (!sql) return json(503, { ok: false, error: "Database is not configured." });

  try {
    const result = await sql.query(
      `INSERT INTO leads (external_id, source, business_name, name, position, email, phone, website)
       SELECT external_id, 'manual', business_name, name, position, email, phone, website
       FROM jsonb_to_recordset($1::jsonb)
         AS x(external_id text, business_name text, name text, position text, email text, phone text, website text)
       ON CONFLICT (external_id) DO UPDATE SET
         business_name = EXCLUDED.business_name, name = EXCLUDED.name, position = EXCLUDED.position,
         email = EXCLUDED.email, phone = EXCLUDED.phone, website = EXCLUDED.website, updated_at = now()
       WHERE (leads.business_name, leads.name, leads.position, leads.email, leads.phone, leads.website)
         IS DISTINCT FROM (EXCLUDED.business_name, EXCLUDED.name, EXCLUDED.position, EXCLUDED.email, EXCLUDED.phone, EXCLUDED.website)
       RETURNING (xmax = 0) AS inserted`,
      [JSON.stringify([...rows.values()])]
    ) as { inserted: boolean }[];

    const inserted = result.filter((r) => r.inserted).length;
    return json(200, { ok: true, received: body.leads.length, inserted, updated: result.length - inserted, skipped });
  } catch (err) {
    console.error("[leads/import] upsert failed", err);
    return json(500, { ok: false, error: "Failed to save leads." });
  }
};
