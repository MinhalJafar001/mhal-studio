// Shared call helpers for the Zoom Phone dialer

export const OUTCOMES = [
  { key: "connected", label: "Connected", badge: "bg-emerald-100 text-emerald-800" },
  { key: "voicemail", label: "Voicemail", badge: "bg-amber-100 text-amber-800" },
  { key: "no_answer", label: "No answer", badge: "bg-ink/5 text-slate" },
  { key: "busy", label: "Busy", badge: "bg-ink/5 text-slate" },
  { key: "failed", label: "Call failed", badge: "bg-red-100 text-red-800" },
  { key: "wrong_number", label: "Wrong number", badge: "bg-red-100 text-red-800" },
  { key: "other", label: "Other", badge: "bg-ink/5 text-slate" },
] as const;

export type Outcome = (typeof OUTCOMES)[number]["key"];
export const isOutcome = (o: unknown): o is Outcome => OUTCOMES.some((x) => x.key === o);
export const outcomeLabel = (o: string | null) => OUTCOMES.find((x) => x.key === o)?.label ?? "—";
export const outcomeBadge = (o: string | null) => OUTCOMES.find((x) => x.key === o)?.badge ?? "bg-ink/5 text-slate";

// Zoom reports results like "connected", "canceled", "call_failed", "No Answer", "Voicemail", "Busy"
export function outcomeFromResult(result: string, durationSeconds: number): Outcome {
  const r = result.toLowerCase();
  if (r.includes("voicemail")) return "voicemail";
  if (r.includes("fail")) return "failed";
  if (r.includes("busy")) return "busy";
  if (r.includes("no answer") || r.includes("missed") || r.includes("cancel") || r.includes("reject") || r.includes("unavailable")) return "no_answer";
  if (r.includes("connect") || r.includes("answer") || r.includes("recorded") || durationSeconds > 0) return "connected";
  return "other";
}

// Dialable E.164: keep a leading +, otherwise assume US/Canada for 10-digit numbers
export function toDialable(phone: string) {
  const digits = phone.replace(/\D/g, "");
  if (phone.trim().startsWith("+")) return `+${digits}`;
  if (digits.length === 10) return `+1${digits}`;
  if (digits.length === 11 && digits.startsWith("1")) return `+${digits}`;
  return digits ? `+${digits}` : "";
}

export function formatDuration(seconds: number | null) {
  if (!seconds) return "0s";
  const m = Math.floor(seconds / 60);
  const s = seconds % 60;
  return m ? `${m}m ${s.toString().padStart(2, "0")}s` : `${s}s`;
}
