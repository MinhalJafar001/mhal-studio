import { ALERT_EMAIL_FROM, ALERT_EMAIL_TO, RESEND_API_KEY } from "astro:env/server";

type LeadAlert = {
  id: string;
  name: string;
  businessName: string;
  email: string;
  phone: string;
  service: string;
  message: string;
};

const escape = (s: string) =>
  s.replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]!);

export const emailConfigured = () => Boolean(RESEND_API_KEY);
export const alertsConfigured = () => Boolean(RESEND_API_KEY && ALERT_EMAIL_TO);

type SendArgs = {
  from: string;
  to: string | string[];
  subject: string;
  text: string;
  html?: string;
  replyTo?: string;
  idempotencyKey?: string;
};
type SendResult = { ok: true; id: string } | { ok: false; error: string };

// Sends one email through Resend. Never throws; returns a readable error instead.
export async function sendEmail(args: SendArgs): Promise<SendResult> {
  if (!RESEND_API_KEY) return { ok: false, error: "Email sending isn't configured (RESEND_API_KEY missing)." };
  try {
    const res = await fetch("https://api.resend.com/emails", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${RESEND_API_KEY}`,
        "Content-Type": "application/json",
        ...(args.idempotencyKey ? { "Idempotency-Key": args.idempotencyKey } : {}),
      },
      body: JSON.stringify({
        from: args.from,
        to: args.to,
        subject: args.subject.replace(/\s+/g, " ").trim(),
        text: args.text,
        ...(args.html ? { html: args.html } : {}),
        ...(args.replyTo ? { reply_to: args.replyTo } : {}),
      }),
      signal: AbortSignal.timeout(8000),
    });
    const body = await res.json().catch(() => ({}));
    if (!res.ok) return { ok: false, error: body.message || `Resend returned ${res.status}` };
    return { ok: true, id: body.id };
  } catch (err) {
    return { ok: false, error: err instanceof Error ? err.message : "Network error" };
  }
}

// Emails a new-website-lead alert via Resend. Never throws: a failed alert must not lose the lead.
export async function sendLeadAlert(lead: LeadAlert, origin: string) {
  if (!alertsConfigured()) return;

  const rows: [string, string][] = [
    ["Name", lead.name],
    ["Business", lead.businessName],
    ["Email", lead.email],
    ["Phone", lead.phone],
    ["Service", lead.service],
  ].filter(([, v]) => v) as [string, string][];

  const dashboard = `${origin}/dashboard/leads?source=website`;
  const text = [
    "New enquiry from the website:",
    "",
    ...rows.map(([k, v]) => `${k}: ${v}`),
    ...(lead.message ? ["", "Message:", lead.message] : []),
    "",
    `View in dashboard: ${dashboard}`,
    "Reply to this email to answer them directly.",
  ].join("\n");

  const html = `
<div style="font-family:-apple-system,Segoe UI,Helvetica,Arial,sans-serif;font-size:15px;color:#0e1116;max-width:560px">
  <p style="margin:0 0 16px;color:#1e3a8a;font-weight:600">New website enquiry</p>
  <table style="border-collapse:collapse;width:100%">
    ${rows.map(([k, v]) => `<tr><td style="padding:6px 16px 6px 0;color:#5a606b;white-space:nowrap;vertical-align:top">${k}</td><td style="padding:6px 0">${escape(v)}</td></tr>`).join("")}
  </table>
  ${lead.message ? `<p style="margin:20px 0 6px;color:#5a606b">Message</p><p style="margin:0;white-space:pre-wrap;background:#f6f5f1;border-radius:10px;padding:12px 14px">${escape(lead.message)}</p>` : ""}
  <p style="margin:24px 0 0"><a href="${escape(dashboard)}" style="display:inline-block;background:#1e3a8a;color:#fff;text-decoration:none;border-radius:999px;padding:10px 18px">View in dashboard</a></p>
  <p style="margin:16px 0 0;color:#5a606b;font-size:13px">Reply to this email to answer ${escape(lead.name)} directly.</p>
</div>`;

  const result = await sendEmail({
    from: ALERT_EMAIL_FROM!,
    to: ALERT_EMAIL_TO!.split(",").map((s) => s.trim()).filter(Boolean),
    replyTo: lead.email,
    subject: `New enquiry: ${lead.name}${lead.businessName ? ` (${lead.businessName})` : ""}${lead.service ? ` · ${lead.service}` : ""}`,
    text,
    html,
    idempotencyKey: `lead-alert-${lead.id}`,
  });
  if (!result.ok) console.error("[email] lead alert failed:", result.error);
}
