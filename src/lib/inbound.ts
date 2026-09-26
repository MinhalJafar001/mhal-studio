import { RESEND_API_KEY, RESEND_WEBHOOK_SECRET } from "astro:env/server";
import { safeEqual } from "./auth";

// Helpers for Resend inbound email (reply tracking).

const TOLERANCE_SECONDS = 5 * 60;

// Verifies a Resend (Svix) webhook: HMAC-SHA256 over "<id>.<timestamp>.<raw body>" with the
// base64 key after "whsec_", compared against every "v1,<sig>" entry in svix-signature.
export async function verifyWebhook(headers: Headers, rawBody: string) {
  if (!RESEND_WEBHOOK_SECRET?.startsWith("whsec_")) return false;
  const id = headers.get("svix-id");
  const timestamp = headers.get("svix-timestamp");
  const signatures = headers.get("svix-signature");
  if (!id || !timestamp || !signatures || !/^\d+$/.test(timestamp)) return false;
  if (Math.abs(Date.now() / 1000 - Number(timestamp)) > TOLERANCE_SECONDS) return false;

  const key = await crypto.subtle.importKey(
    "raw",
    Buffer.from(RESEND_WEBHOOK_SECRET.slice("whsec_".length), "base64"),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign"]
  );
  const mac = await crypto.subtle.sign("HMAC", key, new TextEncoder().encode(`${id}.${timestamp}.${rawBody}`));
  const expected = Buffer.from(mac).toString("base64");

  return signatures
    .split(" ")
    .map((s) => s.split(","))
    .some(([version, sig]) => version === "v1" && sig !== undefined && safeEqual(sig, expected));
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
