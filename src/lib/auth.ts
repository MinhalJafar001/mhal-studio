import { randomBytes, scrypt as scryptCb, timingSafeEqual } from "node:crypto";
import { promisify } from "node:util";
import { ADMIN_PASSWORD, SESSION_SECRET } from "astro:env/server";
import { getSettings, setSetting } from "./settings";

// Single-admin password auth with an HMAC-signed session cookie.
// Password: a hash saved from the Settings page (scrypt) if present, otherwise ADMIN_PASSWORD.
// Cookie value: "<expiry ms>.<HMAC(expiry + credential + epoch)>", so changing the password,
// SESSION_SECRET, or "sign out everywhere" (epoch) invalidates every existing session.

export const SESSION_COOKIE = "mhal_admin";
export const SESSION_MAX_AGE = 60 * 60 * 24 * 7; // 7 days, in seconds

const scrypt = promisify(scryptCb) as (password: string, salt: Buffer, keylen: number) => Promise<Buffer>;
const encoder = new TextEncoder();
let keyPromise: Promise<CryptoKey> | undefined;

type PasswordHash = { alg: "scrypt"; salt: string; hash: string };
type AuthState = { passwordHash: PasswordHash | null; epoch: number };

// Cached briefly so the middleware doesn't query the database on every request
let cached: { state: AuthState; at: number } | undefined;
const CACHE_MS = 30_000;

async function authState(): Promise<AuthState> {
  if (cached && Date.now() - cached.at < CACHE_MS) return cached.state;
  let state: AuthState = { passwordHash: null, epoch: 0 };
  try {
    const s = await getSettings(["password_hash", "session_epoch"]);
    state = { passwordHash: (s.password_hash as PasswordHash) ?? null, epoch: Number(s.session_epoch) || 0 };
  } catch (err) {
    console.error("[auth] could not read settings; using ADMIN_PASSWORD", err);
  }
  cached = { state, at: Date.now() };
  return state;
}
export const invalidateAuthCache = () => (cached = undefined);

export function authConfigured() {
  return Boolean(SESSION_SECRET && SESSION_SECRET.length >= 32);
}

async function sign(value: string) {
  keyPromise ??= crypto.subtle.importKey("raw", encoder.encode(SESSION_SECRET), { name: "HMAC", hash: "SHA-256" }, false, ["sign"]);
  const sig = await crypto.subtle.sign("HMAC", await keyPromise, encoder.encode(value));
  return Buffer.from(sig).toString("base64url");
}

// Constant-time comparison for equal-length strings
export function safeEqual(a: string, b: string) {
  if (a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i++) diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return diff === 0;
}

export async function checkPassword(input: string) {
  if (!authConfigured()) return false;
  const { passwordHash } = await authState();
  if (passwordHash) {
    const actual = await scrypt(input, Buffer.from(passwordHash.salt, "base64"), 32);
    return timingSafeEqual(actual, Buffer.from(passwordHash.hash, "base64"));
  }
  if (!ADMIN_PASSWORD) return false;
  // Compare HMACs so both sides are the same length regardless of input
  return safeEqual(await sign(`pw:${input}`), await sign(`pw:${ADMIN_PASSWORD}`));
}

async function sessionMessage(expires: string | number) {
  const { passwordHash, epoch } = await authState();
  return `session:${expires}:${passwordHash?.hash ?? ADMIN_PASSWORD ?? ""}:${epoch}`;
}

export async function createSession() {
  const expires = Date.now() + SESSION_MAX_AGE * 1000;
  return `${expires}.${await sign(await sessionMessage(expires))}`;
}

export async function verifySession(token: string | undefined) {
  if (!token || !authConfigured()) return false;
  const [expires, sig] = token.split(".");
  if (!expires || !sig || !/^\d+$/.test(expires) || Number(expires) < Date.now()) return false;
  return safeEqual(sig, await sign(await sessionMessage(expires)));
}

// Saves a new dashboard password (replaces ADMIN_PASSWORD). Signs out every session.
export async function setPassword(password: string) {
  const salt = randomBytes(16);
  const hash = await scrypt(password, salt, 32);
  await setSetting("password_hash", { alg: "scrypt", salt: salt.toString("base64"), hash: hash.toString("base64") } satisfies PasswordHash);
  invalidateAuthCache();
}

// Invalidates every existing session ("sign out everywhere")
export async function bumpSessionEpoch() {
  invalidateAuthCache(); // read the latest epoch, not a cached one
  const { epoch } = await authState();
  await setSetting("session_epoch", epoch + 1);
  invalidateAuthCache();
}

export async function passwordSource() {
  return (await authState()).passwordHash ? "dashboard" : "vercel";
}
