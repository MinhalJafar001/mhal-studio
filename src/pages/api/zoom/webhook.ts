import type { APIRoute } from "astro";
import { getSql } from "../../../lib/db";
import { recordSummary, recordZoomCall } from "../../../lib/callstore";
import { pick, urlValidationResponse, verifyZoomWebhook, zoomApiConfigured, zoomGet } from "../../../lib/zoom";

export const prerender = false;

// Zoom webhook (Server-to-Server OAuth app event subscription). Handles:
//   endpoint.url_validation                         → challenge response
//   phone.caller_/callee_call_element_completed      → completed call (also older *_call_history/log_completed)
//   phone.ai_call_summary_changed                    → fetches the AI summary and attaches it to the call
// Every event is stored raw in zoom_events. Failures return 500 so Zoom retries.

const text = (v: unknown, max = 50000): string | null => {
  if (v === undefined || v === null || v === "") return null;
  if (Array.isArray(v)) return v.map((x) => (typeof x === "object" ? JSON.stringify(x) : String(x))).join("\n").slice(0, max) || null;
  if (typeof v === "object") return JSON.stringify(v).slice(0, max);
  return String(v).slice(0, max);
};

export const POST: APIRoute = async ({ request }) => {
  const raw = await request.text();
  let body: { event?: string; payload?: Record<string, any> };
  try {
    body = JSON.parse(raw);
  } catch {
    return new Response("Bad JSON", { status: 400 });
  }

  const invalid = await verifyZoomWebhook(request.headers, raw);
  if (invalid) {
    console.warn("[zoom] rejected webhook:", invalid);
    return new Response(`Invalid signature: ${invalid}`, { status: 401 });
  }

  if (body.event === "endpoint.url_validation") {
    return Response.json(await urlValidationResponse(String(body.payload?.plainToken ?? "")));
  }

  const sql = getSql();
  if (!sql) return new Response("Database not configured", { status: 503 });

  // Store the event; skip if already processed (a retry of an earlier failure is processed again)
  const [stored] = (await sql`
    INSERT INTO zoom_events (request_id, event, payload)
    VALUES (${request.headers.get("x-zm-request-id")}, ${body.event ?? null}, ${raw}::jsonb)
    ON CONFLICT (request_id) DO UPDATE SET error = NULL WHERE zoom_events.error IS NOT NULL
    RETURNING id
  `) as { id: string }[];
  if (!stored) return new Response("Duplicate", { status: 200 });

  try {
    const event = body.event ?? "";
    const object = body.payload?.object ?? body.payload ?? {};

    if (/call_(element|history|log)_completed$/.test(event)) {
      const outbound = event.startsWith("phone.caller_");
      const list = pick(object, ["call_elements", "call_logs", "call_history"]);
      const items: Record<string, any>[] = Array.isArray(list) ? list : [object];
      for (const item of items) {
        const callId = text(pick(item, ["call_id", "callId", "call_history_uuid"]), 200);
        if (!callId) continue;
        const party = item[outbound ? "callee" : "caller"];
        const number =
          text(pick(item, outbound ? ["callee_number", "callee_did_number", "callee_phone_number", "to"] : ["caller_number", "caller_did_number", "caller_phone_number", "from"]), 40) ??
          text(pick(party, ["phone_number", "number", "extension_number"]), 40);
        const direction = String(item.direction ?? "").toLowerCase() === "inbound" || (!outbound && !item.direction) ? "inbound" : "outbound";
        await recordZoomCall(sql, {
          callId,
          direction,
          number,
          result: text(pick(item, ["result", "call_result", "status"]), 80) ?? "",
          duration: Math.max(0, Math.round(Number(pick(item, ["duration", "talk_time", "call_duration"])) || 0)),
          startedAt: text(pick(item, ["start_time", "date_time", "call_start_time", "started_at"]), 40),
          callLogId: text(pick(item, ["call_element_id", "call_log_id", "id"]), 200),
        });
      }
    } else if (event === "phone.ai_call_summary_changed") {
      const summaryId = text(pick(object, ["ai_call_summary_id", "aiCallSummaryId", "summary_id"]), 200);
      const userId = text(pick(object, ["user_id", "userId", "owner_id"]), 200);
      let callId = text(pick(object, ["call_id", "callId"]), 200);
      const deleted = Boolean(pick(object, ["is_deleted", "deleted"]));

      let data: Record<string, unknown> = {};
      if (!deleted && summaryId && userId && zoomApiConfigured()) {
        data = await zoomGet(`/phone/user/${encodeURIComponent(userId)}/ai_call_summary/${encodeURIComponent(summaryId)}`);
        callId ??= text(pick(data, ["call_id", "callId"]), 200);
      }
      if (callId) {
        await recordSummary(sql, {
          callId,
          summaryId,
          summary: deleted ? null : text(pick(data, ["call_summary", "summary", "summary_overview", "overview"])),
          nextSteps: deleted ? null : text(pick(data, ["next_steps", "next_step"])),
          detailed: deleted ? null : text(pick(data, ["detailed_summary", "summary_details", "summary_detail"])),
        });
      }
    }
    return new Response("OK", { status: 200 });
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    console.error("[zoom] processing failed", message);
    await sql`UPDATE zoom_events SET error = ${message.slice(0, 2000)} WHERE id = ${stored.id}`;
    return new Response("Processing failed", { status: 500 });
  }
};
