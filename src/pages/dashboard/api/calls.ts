import type { APIRoute } from "astro";
import { getSql } from "../../../lib/db";
import { isOutcome, outcomeFromResult } from "../../../lib/calls";

export const prerender = false;

// Receives Zoom Phone Smart Embed events relayed by the dialer page (session-protected by middleware).
//   start   → a call began ringing; remembers which lead it's for
//   log     → Zoom's call log (result, duration); sets the outcome and moves New leads to Contacted
//   summary → AI Companion summary / next steps
//   outcome → your manual outcome + notes (never overwritten by later automatic results)

const json = (status: number, body: object) => Response.json(body, { status });
const str = (v: unknown, max: number) => {
  const s = String(v ?? "").trim();
  return s ? s.slice(0, max) : null;
};
const leadIdOf = (v: unknown) => (/^\d{1,18}$/.test(String(v ?? "")) ? String(v) : null);
const dateOf = (v: unknown) => {
  const d = new Date(String(v ?? ""));
  return isNaN(d.getTime()) ? new Date().toISOString() : d.toISOString();
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

  const callId = str(body.callId, 120);
  if (!callId) return json(400, { ok: false, error: "callId is required" });
  const number = str(body.number, 40);
  const direction = body.direction === "inbound" ? "inbound" : "outbound";

  switch (body.type) {
    case "start": {
      await sql`
        INSERT INTO calls (call_id, lead_id, started_at, direction, number)
        VALUES (${callId}, ${leadIdOf(body.leadId)}, ${dateOf(body.dateTime)}, ${direction}, ${number})
        ON CONFLICT (call_id) DO UPDATE SET lead_id = COALESCE(calls.lead_id, EXCLUDED.lead_id), updated_at = now()
      `;
      return json(200, { ok: true });
    }

    case "log": {
      const result = str(body.result, 80) ?? "";
      const duration = Math.max(0, Math.min(86400, Math.round(Number(body.duration) || 0)));
      const outcome = outcomeFromResult(result, duration);
      // Lead: the one the dialer called, else match the other party's number (last 10 digits)
      const rows = (await sql`
        WITH matched AS (
          SELECT COALESCE(
            ${leadIdOf(body.leadId)}::bigint,
            (SELECT id FROM leads
             WHERE length(regexp_replace(coalesce(${number}::text, ''), '\\D', '', 'g')) >= 7
               AND right(regexp_replace(coalesce(phone, ''), '\\D', '', 'g'), 10) = right(regexp_replace(${number}::text, '\\D', '', 'g'), 10)
             ORDER BY id DESC LIMIT 1)
          ) AS id
        ),
        up AS (
          INSERT INTO calls (call_id, lead_id, started_at, direction, number, result, outcome, duration_seconds, call_log_id)
          VALUES (${callId}, (SELECT id FROM matched), ${dateOf(body.dateTime)}, ${direction}, ${number}, ${result}, ${outcome}, ${duration}, ${str(body.callLogId, 120)})
          ON CONFLICT (call_id) DO UPDATE SET
            lead_id = COALESCE(calls.lead_id, EXCLUDED.lead_id),
            result = EXCLUDED.result,
            duration_seconds = EXCLUDED.duration_seconds,
            call_log_id = COALESCE(EXCLUDED.call_log_id, calls.call_log_id),
            outcome = CASE WHEN calls.outcome_source = 'manual' THEN calls.outcome ELSE EXCLUDED.outcome END,
            updated_at = now()
          RETURNING lead_id, direction
        ),
        flagged AS (
          UPDATE leads SET status = 'contacted', updated_at = now()
          WHERE id IN (SELECT lead_id FROM up WHERE direction = 'outbound') AND status = 'new'
          RETURNING id
        ),
        logged AS (
          INSERT INTO lead_activity (lead_id, kind, meta)
          SELECT id, 'status', jsonb_build_object('from', 'new', 'to', 'contacted', 'auto', 'call') FROM flagged
          RETURNING 1
        )
        SELECT (SELECT lead_id FROM up) AS lead_id
      `) as { lead_id: string | null }[];
      return json(200, { ok: true, leadId: rows[0]?.lead_id ?? null, outcome });
    }

    case "summary": {
      const deleted = body.deleted === true;
      await sql`
        INSERT INTO calls (call_id, lead_id, summary, next_steps, detailed_summary)
        VALUES (${callId}, ${leadIdOf(body.leadId)},
                ${deleted ? null : str(body.callSummary, 20000)}, ${deleted ? null : str(body.nextSteps, 20000)}, ${deleted ? null : str(body.detailedSummary, 50000)})
        ON CONFLICT (call_id) DO UPDATE SET
          lead_id = COALESCE(calls.lead_id, EXCLUDED.lead_id),
          summary = EXCLUDED.summary, next_steps = EXCLUDED.next_steps, detailed_summary = EXCLUDED.detailed_summary,
          updated_at = now()
      `;
      return json(200, { ok: true });
    }

    case "outcome": {
      if (!isOutcome(body.outcome)) return json(400, { ok: false, error: "Unknown outcome" });
      const notes = str(body.notes, 5000);
      await sql`
        INSERT INTO calls (call_id, lead_id, direction, number, outcome, outcome_source, notes)
        VALUES (${callId}, ${leadIdOf(body.leadId)}, ${direction}, ${number}, ${body.outcome}, 'manual', ${notes})
        ON CONFLICT (call_id) DO UPDATE SET
          lead_id = COALESCE(calls.lead_id, EXCLUDED.lead_id),
          outcome = EXCLUDED.outcome, outcome_source = 'manual', notes = EXCLUDED.notes, updated_at = now()
      `;
      return json(200, { ok: true });
    }

    default:
      return json(400, { ok: false, error: "Unknown type" });
  }
};
