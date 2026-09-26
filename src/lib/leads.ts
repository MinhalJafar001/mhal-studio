// Shared lead helpers for the dashboard

export const STATUSES = [
  { key: "new", label: "New", badge: "bg-signal/10 text-signal", bar: "bg-signal" },
  { key: "contacted", label: "Contacted", badge: "bg-amber-100 text-amber-800", bar: "bg-amber-500" },
  { key: "won", label: "Won", badge: "bg-emerald-100 text-emerald-800", bar: "bg-emerald-600" },
  { key: "lost", label: "Lost", badge: "bg-ink/5 text-slate", bar: "bg-slate/40" },
] as const;

export type Status = (typeof STATUSES)[number]["key"];
export const isStatus = (s: unknown): s is Status => STATUSES.some((x) => x.key === s);
export const statusLabel = (s: string) => STATUSES.find((x) => x.key === s)?.label ?? s;

export const websiteHref = (w: string) => (/^https?:\/\//i.test(w) ? w : `https://${w}`);
export const websiteLabel = (w: string) => w.replace(/^https?:\/\/(www\.)?/i, "").replace(/\/$/, "");
export const telHref = (p: string) => `tel:${p.replace(/[^+\d]/g, "")}`;

const rtf = new Intl.RelativeTimeFormat("en", { numeric: "auto" });
export function ago(date: Date | string) {
  const mins = Math.round((new Date(date).getTime() - Date.now()) / 60000);
  if (Math.abs(mins) < 60) return rtf.format(mins, "minute");
  const hours = Math.round(mins / 60);
  if (Math.abs(hours) < 24) return rtf.format(hours, "hour");
  const days = Math.round(hours / 24);
  if (Math.abs(days) < 30) return rtf.format(days, "day");
  return new Date(date).toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" });
}
