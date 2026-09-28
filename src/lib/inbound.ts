import { RESEND_API_KEY, RESEND_WEBHOOK_SECRET } from "astro:env/server";
import { safeEqual } from "./auth";

// Helpers for Resend inbound email (reply tracking).

const TOLERANCE_SECONDS = 5 * 60;

// Verifies a Resend (Svix / Standard Webhooks) webhook: HMAC-SHA256 over "<id>.<timestamp>.<raw body>"
// with the base64 key after "whsec_", compared against every "v1,<sig>" entry in the signature header.
// Returns null when valid, otherwise a short reason (safe to show: never includes the secret).
export async function verifyWebhook(headers: Headers, rawBody: string): Promise<string | null> {
  const secret = RESEND_WEBHOOK_SECRET?.trim().replace(/^["']|["']$/g, "");
  if (!secret) return "webhook secret not configured";
  if (!secret.startsWith("whsec_")) return "webhook secret should start with whsec_";

  const header = (name: string) => headers.get(`svix-${name}`) ?? headers.get(`webhook-${name}`);
  const id = header("id");
  const timestamp = header("timestamp");
  const signatures = header("signature");
  if (!id || !timestamp || !signatures) return "missing signature headers";
  if (!/^\d+$/.test(timestamp) || Math.abs(Date.now() / 1000 - Number(timestamp)) > TOLERANCE_SECONDS) {
    return "timestamp outside 5-minute window";
  }

  const key = await crypto.subtle.importKey(
    "raw",
    Buffer.from(secret.slice("whsec_".length), "base64"),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign"]
  );
  const mac = await crypto.subtle.sign("HMAC", key, new TextEncoder().encode(`${id}.${timestamp}.${rawBody}`));
  const expected = Buffer.from(mac).toString("base64");

  const valid = signatures
    .split(" ")
    .map((s) => s.split(","))
    .some(([version, sig]) => version === "v1" && sig !== undefined && safeEqual(sig, expected));
  return valid ? null : "signature mismatch (check RESEND_WEBHOOK_SECRET matches this webhook)";
}

export type ReceivedEmail = {
  id: string;
  from: string;
  to: string[];
  subject: string | null;
  text: string | null;
  html: string | null;
  message_id: string | null;
  created_at: string;
};

export async function getReceivedEmail(id: string): Promise<ReceivedEmail | null> {
  if (!RESEND_API_KEY) return null;
  const res = await fetch(`https://api.resend.com/emails/receiving/${encodeURIComponent(id)}`, {
    headers: { Authorization: `Bearer ${RESEND_API_KEY}` },
    signal: AbortSignal.timeout(8000),
  });
  if (!res.ok) throw new Error(`Resend receiving API returned ${res.status}: ${await res.text()}`);
  return res.json();
}

// "Jane Doe <jane@x.com>" → { name: "Jane Doe", address: "jane@x.com" }
export function parseAddress(from: string) {
  const match = from.match(/^\s*"?([^"<]*?)"?\s*<([^>]+)>\s*$/);
  const address = (match ? match[2] : from).trim().toLowerCase();
  return { name: match?.[1]?.trim() || null, address };
}

// Plain text of an email, falling back to stripped HTML (which may arrive as a data: URI)
export function emailText(email: Pick<ReceivedEmail, "text" | "html">) {
  if (email.text?.trim()) return email.text.replace(/\r\n/g, "\n").trim();
  let html = email.html ?? "";
  if (html.startsWith("data:")) {
    const [meta, data = ""] = html.split(",", 2);
    html = meta.includes(";base64") ? Buffer.from(data, "base64").toString("utf8") : decodeURIComponent(data);
  }
  return html
    .replace(/<(style|script)[\s\S]*?<\/\1>/gi, "")
    .replace(/<br\s*\/?>/gi, "\n")
    .replace(/<\/(p|div|li|tr|h\d|blockquote)>/gi, "\n")
    .replace(/<[^>]+>/g, "")
    .replace(/&nbsp;/g, " ")
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}

// Drops the quoted thread below a reply ("On … wrote:", "-----Original Message-----", "> " lines)
export function stripQuoted(text: string) {
  const lines = text.split("\n");
  const cut = lines.findIndex(
    (line, i) =>
      /^On .+wrote:\s*$/i.test(line.trim()) ||
      /^On .+$/i.test(line.trim()) && /wrote:\s*$/i.test(lines[i + 1]?.trim() ?? "") ||
      /^-{2,}\s*Original Message\s*-{2,}/i.test(line.trim()) ||
      /^From: .+/i.test(line.trim()) && /^(Sent|Date): /i.test(lines[i + 1]?.trim() ?? "") ||
      line.startsWith(">")
  );
  const reply = (cut === -1 ? lines : lines.slice(0, cut)).join("\n").trim();
  return reply || text.trim();
}
