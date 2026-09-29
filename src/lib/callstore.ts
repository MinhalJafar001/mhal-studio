import { getSql } from "./db";
import { outcomeFromResult } from "./calls";

// Server-side call records. Calls started from the dashboard are "pending" (call_id = local_ref = "dash-…")
// until Zoom's webhook reports the real call; they're merged by number within 30 minutes.

type Sql = NonNullable<ReturnType<typeof getSql>>;

export type ZoomCallLog = {
  callId: string;
  direction: "outbound" | "inbound";
  number: string | null; // the other party
  result: string;
  duration: number;
  startedAt: string | null;
  callLogId: string | null;
};

// Folds a pending dashboard call for the same number into the Zoom call row (keeping your outcome/notes)
async function mergePending(sql: Sql, log: ZoomCallLog) {
  if (log.direction !== "outbound" || !log.number) return;
  const [pending] = (await sql`
    SELECT call_id, lead_id, local_ref, outcome, outcome_source, notes FROM calls
    WHERE local_ref IS NOT NULL AND zoom_logged = false AND call_id <> ${log.callId}
      AND right(regexp_replace(coalesce(number, ''), '\\D', '', 'g'), 10) = right(regexp_replace(${log.number}::text, '\\D', '', 'g'), 10)
      AND created_at > COALESCE(${log.startedAt}::timestamptz, now()) - interval '30 minutes'
    ORDER BY created_at DESC LIMIT 1
  `) as { call_id: string; lead_id: string | null; local_ref: string; outcome: string | null; outcome_source: string; notes: string | null }[];
  if (!pending) return;

  const [zoomRow] = (await sql`SELECT call_id FROM calls WHERE call_id = ${log.callId}`) as { call_id: string }[];
  if (!zoomRow) {
    await sql`UPDATE calls SET call_id = ${log.callId}, updated_at = now() WHERE call_id = ${pending.call_id}`;
    return;
  }
  // Zoom row already exists (e.g. AI summary arrived first): move the pending details onto it
  await sql`DELETE FROM calls WHERE call_id = ${pending.call_id}`;
  await sql`
    UPDATE calls SET
      lead_id = COALESCE(lead_id, ${pending.lead_id}::bigint),
      local_ref = ${pending.local_ref},
      notes = COALESCE(notes, ${pending.notes}),
      outcome = CASE WHEN ${pending.outcome_source} = 'manual' THEN ${pending.outcome} ELSE outcome END,
      outcome_source = CASE WHEN ${pending.outcome_source} = 'manual' THEN 'manual' ELSE outcome_source END,
      updated_at = now()
    WHERE call_id = ${log.callId}
  `;
}

// Records Zoom's completed call; sets the outcome (unless you set one), links the lead, moves New → Contacted
export async function recordZoomCall(sql: Sql, log: ZoomCallLog) {
  await mergePending(sql, log);
  const outcome = outcomeFromResult(log.result, log.duration);
  const [row] = (await sql`
    WITH matched AS (
      SELECT id FROM leads
      WHERE length(regexp_replace(coalesce(${log.number}::text, ''), '\\D', '', 'g')) >= 7
        AND right(regexp_replace(coalesce(phone, ''), '\\D', '', 'g'), 10) = right(regexp_replace(${log.number}::text, '\\D', '', 'g'), 10)
      ORDER BY id DESC LIMIT 1
    ),
    up AS (
      INSERT INTO calls (call_id, lead_id, started_at, direction, number, result, outcome, duration_seconds, call_log_id, zoom_logged)
      VALUES (${log.callId}, (SELECT id FROM matched), ${log.startedAt}::timestamptz, ${log.direction}, ${log.number}, ${log.result},
              ${outcome}, ${log.duration}, ${log.callLogId}, true)
      ON CONFLICT (call_id) DO UPDATE SET
        lead_id = COALESCE(calls.lead_id, EXCLUDED.lead_id),
        started_at = COALESCE(EXCLUDED.started_at, calls.started_at),
        direction = EXCLUDED.direction,
        number = COALESCE(calls.number, EXCLUDED.number),
        result = EXCLUDED.result,
        duration_seconds = EXCLUDED.duration_seconds,
        call_log_id = COALESCE(EXCLUDED.call_log_id, calls.call_log_id),
        outcome = CASE WHEN calls.outcome_source = 'manual' THEN calls.outcome ELSE EXCLUDED.outcome END,
        zoom_logged = true,
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
  return { leadId: row?.lead_id ?? null, outcome };
}

export async function recordSummary(
  sql: Sql,
  s: { callId: string; summaryId: string | null; summary: string | null; nextSteps: string | null; detailed: string | null }
) {
  await sql`
    INSERT INTO calls (call_id, ai_summary_id, summary, next_steps, detailed_summary)
    VALUES (${s.callId}, ${s.summaryId}, ${s.summary}, ${s.nextSteps}, ${s.detailed})
    ON CONFLICT (call_id) DO UPDATE SET
      ai_summary_id = COALESCE(EXCLUDED.ai_summary_id, calls.ai_summary_id),
      summary = EXCLUDED.summary, next_steps = EXCLUDED.next_steps, detailed_summary = EXCLUDED.detailed_summary,
      updated_at = now()
  `;
}
