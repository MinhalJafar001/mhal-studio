import type { APIRoute } from "astro";
import { ALERT_EMAIL_FROM, INBOX_FORWARD_TO } from "astro:env/server";
import { getSql } from "../../../lib/db";
import { sendEmail } from "../../../lib/email";
import { emailText, getReceivedEmail, parseAddress, stripQuoted, verifyWebhook } from "../../../lib/inbound";

export const prerender = false;

// Resend `email.received` webhook. Logs replies from known leads on their timeline and forwards
// every received email to INBOX_FORWARD_TO. Non-2xx responses make Resend retry, so failures that
// could lose a reply return 500; duplicates and irrelevant events return 200.

export const POST: APIRoute = async ({ request, url }) => {
  const raw = await request.text();
  if (!(await verifyWebhook(request.headers, raw))) return new Response("Invalid signature", { status: 401 });

  let event: { type?: string; data?: { email_id?: string } };
  try {
    event = JSON.parse(raw);
  } catch {
    return new Response("Bad JSON", { status: 400 });
  }
  if (event.type !== "email.received" || !event.data?.email_id) return new Response("Ignored", { status: 200 });

  const sql = getSql();
  if (!sql) return new Response("Database not configured", { status: 503 });

  let email;
  try {
    email = await getReceivedEmail(event.data.email_id);
  } catch (err) {
    console.error("[inbound] could not fetch email", err);
    return new Response("Fetch failed", { status: 500 });
  }
  if (!email) return new Response("Resend not configured", { status: 503 });

  const sender = parseAddress(email.from);
  const subject = email.subject?.trim() || "(no subject)";
  const fullText = emailText(email);
  const reply = stripQuoted(fullText);

  // Match the sender to a lead (most recently emailed first, if the address appears more than once)
  const [lead] = (await sql`
    SELECT l.id, COALESCE(l.business_name, l.name, l.email) AS label
    FROM leads l
    WHERE lower(l.email) = ${sender.address}
    ORDER BY (SELECT max(created_at) FROM lead_activity a WHERE a.lead_id = l.id AND a.kind = 'email') DESC NULLS LAST, l.id DESC
    LIMIT 1
  `) as { id: string; label: string }[];

  if (lead) {
    await sql`
      INSERT INTO lead_activity (lead_id, kind, body, meta)
      VALUES (${lead.id}, 'reply', ${reply}, jsonb_build_object(
        'inbound_id', ${email.id}::text, 'subject', ${subject}::text, 'from', ${email.from}::text,
        'full_text', ${fullText === reply ? null : fullText}::text, 'message_id', ${email.message_id}::text))
      ON CONFLICT ((meta->>'inbound_id')) WHERE kind = 'reply' DO NOTHING
    `;
  }

  // Forward to the real inbox; replying to the forward goes straight to the sender
  const leadUrl = lead ? `${url.origin}/dashboard/leads/${lead.id}` : null;
  const forwarded = await sendEmail({
    from: ALERT_EMAIL_FROM!,
    to: INBOX_FORWARD_TO!.split(",").map((s) => s.trim()).filter(Boolean),
    replyTo: sender.address,
    subject: `${lead ? "Reply" : "Email"} from ${sender.name ?? sender.address}: ${subject}`,
    text: [
      `From: ${email.from}`,
      `Subject: ${subject}`,
      lead ? `Lead: ${lead.label} (logged in dashboard: ${leadUrl})` : "Not matched to a lead.",
      "",
      fullText || "(empty message)",
    ].join("\n"),
    idempotencyKey: `inbound-forward-${email.id}`,
  });
  if (!forwarded.ok) {
    console.error("[inbound] forward failed:", forwarded.error);
    return new Response("Forward failed", { status: 500 });
  }

  return new Response("OK", { status: 200 });
};
