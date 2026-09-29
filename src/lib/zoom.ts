import { ZOOM_ACCOUNT_ID, ZOOM_CLIENT_ID, ZOOM_CLIENT_SECRET, ZOOM_WEBHOOK_SECRET } from "astro:env/server";
import { safeEqual } from "./auth";

// Zoom Server-to-Server OAuth + webhook helpers (call history and AI call summaries)

const TOLERANCE_SECONDS = 5 * 60;
const encoder = new TextEncoder();

async function hmacHex(secret: string, message: string) {
  const key = await crypto.subtle.importKey("raw", encoder.encode(secret), { name: "HMAC", hash: "SHA-256" }, false, ["sign"]);
  return Buffer.from(await crypto.subtle.sign("HMAC", key, encoder.encode(message))).toString("hex");
}

// x-zm-signature = "v0=" + hex(HMAC-SHA256(secret, "v0:{x-zm-request-timestamp}:{raw body}")). Returns null if valid.
export async function verifyZoomWebhook(headers: Headers, rawBody: string): Promise<string | null> {
  if (!ZOOM_WEBHOOK_SECRET) return "ZOOM_WEBHOOK_SECRET not configured";
  const timestamp = headers.get("x-zm-request-timestamp");
  const signature = headers.get("x-zm-signature");
  if (!timestamp || !signature) return "missing signature headers";
  // Zoom sends seconds; tolerate milliseconds too
  const seconds = Number(timestamp) > 1e12 ? Number(timestamp) / 1000 : Number(timestamp);
  if (!Number.isFinite(seconds) || Math.abs(Date.now() / 1000 - seconds) > TOLERANCE_SECONDS) return "timestamp outside 5-minute window";
  const expected = `v0=${await hmacHex(ZOOM_WEBHOOK_SECRET, `v0:${timestamp}:${rawBody}`)}`;
  return safeEqual(signature, expected) ? null : "signature mismatch (check ZOOM_WEBHOOK_SECRET)";
}

// Answer to Zoom's endpoint.url_validation challenge
export async function urlValidationResponse(plainToken: string) {
  return { plainToken, encryptedToken: await hmacHex(ZOOM_WEBHOOK_SECRET ?? "", plainToken) };
}

export const zoomApiConfigured = () => Boolean(ZOOM_ACCOUNT_ID && ZOOM_CLIENT_ID && ZOOM_CLIENT_SECRET);

let token: { value: string; expires: number } | undefined;

async function accessToken() {
  if (token && token.expires > Date.now() + 60_000) return token.value;
  const res = await fetch(`https://zoom.us/oauth/token?grant_type=account_credentials&account_id=${encodeURIComponent(ZOOM_ACCOUNT_ID!)}`, {
    method: "POST",
    headers: { Authorization: `Basic ${Buffer.from(`${ZOOM_CLIENT_ID}:${ZOOM_CLIENT_SECRET}`).toString("base64")}` },
    signal: AbortSignal.timeout(8000),
  });
  if (!res.ok) throw new Error(`Zoom OAuth failed: ${res.status} ${await res.text()}`);
  const body = (await res.json()) as { access_token: string; expires_in: number };
  token = { value: body.access_token, expires: Date.now() + body.expires_in * 1000 };
  return token.value;
}

export async function zoomGet<T = Record<string, unknown>>(path: string): Promise<T> {
  if (!zoomApiConfigured()) throw new Error("Zoom API credentials not configured");
  const res = await fetch(`https://api.zoom.us/v2${path}`, {
    headers: { Authorization: `Bearer ${await accessToken()}` },
    signal: AbortSignal.timeout(8000),
  });
  if (!res.ok) throw new Error(`Zoom API ${path} returned ${res.status}: ${await res.text()}`);
  return res.json() as Promise<T>;
}

// Finds the first value for any of the given keys anywhere in a nested payload (Zoom's field names vary by event)
export function pick(obj: unknown, keys: string[]): unknown {
  if (!obj || typeof obj !== "object") return undefined;
  const queue: unknown[] = [obj];
  while (queue.length) {
    const cur = queue.shift();
    if (!cur || typeof cur !== "object") continue;
    for (const k of keys) {
      const v = (cur as Record<string, unknown>)[k];
      if (v !== undefined && v !== null && v !== "") return v;
    }
    for (const v of Object.values(cur as Record<string, unknown>)) if (v && typeof v === "object") queue.push(v);
  }
  return undefined;
}
