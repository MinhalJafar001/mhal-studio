import { websiteLabel } from "./leads";

// Placeholders available in email templates, with the fallback used when a lead is missing the value
export const PLACEHOLDERS = [
  { key: "first_name", label: "Contact's first name", fallback: "there" },
  { key: "name", label: "Contact's full name", fallback: "there" },
  { key: "business_name", label: "Business name", fallback: "your business" },
  { key: "position", label: "Contact's position", fallback: "" },
  { key: "website", label: "Their website (without https://)", fallback: "your website" },
  { key: "signature", label: "Your sign-off: name, email, phone, site", fallback: "" },
] as const;

type LeadFields = {
  name: string | null;
  business_name: string | null;
  position: string | null;
  website: string | null;
};

const PATTERN = /\{(first_name|name|business_name|position|website|signature)\}/g;

export function placeholderValues(lead: LeadFields, signature: string): Record<string, string> {
  const values: Record<string, string | null> = {
    first_name: lead.name?.trim().split(/\s+/)[0] ?? null,
    name: lead.name?.trim() || null,
    business_name: lead.business_name,
    position: lead.position,
    website: lead.website ? websiteLabel(lead.website) : null,
    signature,
  };
  return Object.fromEntries(PLACEHOLDERS.map((p) => [p.key, values[p.key] || p.fallback]));
}

// Replaces known {placeholders}; anything else in braces is left untouched
export const fillTemplate = (text: string, values: Record<string, string>) =>
  text.replace(PATTERN, (_, key: string) => values[key] ?? "");

// Known placeholders still present in text (used to block sending unfilled templates)
export const unfilledPlaceholders = (text: string) => [...new Set([...text.matchAll(PATTERN)].map((m) => m[0]))];
