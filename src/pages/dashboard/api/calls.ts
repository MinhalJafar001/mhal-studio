import type { APIRoute } from "astro";
import { getSql } from "../../../lib/db";
import { isOutcome } from "../../../lib/calls";

export const prerender = false;

// Dialer endpoints (session-protected by middleware; cookie is scoped to /dashboard).
//   POST { type: "dial", leadId?, number }        → records a pending call, returns its ref ("dash-…")
//   POST { type: "outcome", ref, outcome, notes } → your outcome + notes (never overwritten by Zoom's result)
//   GET  ?ref=dash-…                              → whether Zoom has logged the call yet, and its details
// Zoom's own record arrives separately via /api/zoom/webhook and is merged into the pending call.

const json = (status: number, body: object) => Response.json(body, { status });
const str = (v: unknown, max: number) => {
  const s = String(v ?? "").trim();
  return s ? s.slice(0, max) : null;
};
const leadIdOf = (v: unknown) => (/^\d{1,18}$/.test(String(v ?? "")) ? String(v) : null);
const refOf = (v: unknown) => (/^dash-[0-9a-f-]{36}$/.test(String(v ?? "")) ? String(v) : null);

export const GET: APIRoute = async ({ url }) => {
  const ref = refOf(url.searchParams.get("ref"));
  const sql = getSql();
  if (!ref || !sql) return json(400, { ok: false });
  const [call] = (await sql`
    SELECT call_id, zoom_logged, result, outcome, outcome_source, duration_seconds, summary IS NOT NULL AS has_summary
    FROM calls WHERE local_ref = ${ref}
  `) as Record<string, unknown>[];
  return json(200, { ok: true, call: call ?? null });
};

export const POST: APIRoute = async ({ request }) => {
  // JSON only: cross-site pages can't send this without a CORS preflight
  if (!request.headers.get("content-type")?.includes("application/json")) return json(415, { ok: false, error: "Expected JSON" });
  const sql = getSql();
  if (!sql) return json(503, { ok: false, error: "Database not configured" });

  let body: Record<string, unknown>;
  try {
    body = await request.json();
  } catch {
    return json(400, { ok: false, error: "Invalid JSON" });
  }

  if (body.type === "dial") {
    const number = str(body.number, 40);
    if (!number || number.replace(/\D/g, "").length < 7) return json(400, { ok: false, error: "Enter a valid number" });
    const ref = `dash-${crypto.randomUUID()}`;
    await sql`
      INSERT INTO calls (call_id, local_ref, lead_id, started_at, direction, number)
      VALUES (${ref}, ${ref}, ${leadIdOf(body.leadId)}, now(), 'outbound', ${number})
    `;
    return json(200, { ok: true, ref });
  }

  if (body.type === "outcome") {
    const ref = refOf(body.ref);
    if (!ref) return json(400, { ok: false, error: "Unknown call" });
    if (!isOutcome(body.outcome)) return json(400, { ok: false, error: "Unknown outcome" });
    const rows = await sql`
      UPDATE calls SET outcome = ${body.outcome}, outcome_source = 'manual', notes = ${str(body.notes, 5000)}, updated_at = now()
      WHERE local_ref = ${ref} RETURNING call_id
    `;
    return rows.length ? json(200, { ok: true }) : json(404, { ok: false, error: "Call not found" });
  }

  return json(400, { ok: false, error: "Unknown type" });
};
