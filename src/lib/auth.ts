import { ADMIN_PASSWORD, SESSION_SECRET } from "astro:env/server";

// Single-admin password auth with an HMAC-signed session cookie.
// Cookie value: "<expiry ms>.<HMAC(expiry + password)>". Changing ADMIN_PASSWORD or
// SESSION_SECRET invalidates every existing session.

export const SESSION_COOKIE = "mhal_admin";
export const SESSION_MAX_AGE = 60 * 60 * 24 * 7; // 7 days, in seconds

const encoder = new TextEncoder();
let keyPromise: Promise<CryptoKey> | undefined;

export function authConfigured() {
  return Boolean(ADMIN_PASSWORD && SESSION_SECRET && SESSION_SECRET.length >= 32);
}

async function sign(value: string) {
  keyPromise ??= crypto.subtle.importKey(
    "raw",
    encoder.encode(SESSION_SECRET),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign"]
  );
  const sig = await crypto.subtle.sign("HMAC", await keyPromise, encoder.encode(value));
  return Buffer.from(sig).toString("base64url");
}

// Constant-time comparison for equal-length strings
function safeEqual(a: string, b: string) {
  if (a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i++) diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return diff === 0;
}

export async function checkPassword(input: string) {
  if (!authConfigured()) return false;
  // Compare HMACs so both sides are the same length regardless of input
  return safeEqual(await sign(`pw:${input}`), await sign(`pw:${ADMIN_PASSWORD}`));
}

export async function createSession() {
  const expires = Date.now() + SESSION_MAX_AGE * 1000;
  return `${expires}.${await sign(`session:${expires}:${ADMIN_PASSWORD}`)}`;
}

export async function verifySession(token: string | undefined) {
  if (!token || !authConfigured()) return false;
  const [expires, sig] = token.split(".");
  if (!expires || !sig || !/^\d+$/.test(expires) || Number(expires) < Date.now()) return false;
  return safeEqual(sig, await sign(`session:${expires}:${ADMIN_PASSWORD}`));
}
