import type { APIRoute } from "astro";
import { getSql } from "../../lib/db";
import { HONEYPOT_FIELD, SERVICE_OPTIONS } from "../../lib/contact";

export const prerender = false;

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

// fetch() from the contact page asks for JSON; a plain form post (no JS) gets redirected
const wantsJson = (request: Request) => request.headers.get("accept")?.includes("application/json");

function fail(request: Request, status: number, error: string) {
  if (wantsJson(request)) return Response.json({ ok: false, error }, { status });
  return new Response(`${error}\n\nPlease go back and try again, or email hello@mhalstudio.com.`, {
    status,
    headers: { "Content-Type": "text/plain; charset=utf-8" },
  });
}

function succeed(request: Request) {
  if (wantsJson(request)) return Response.json({ ok: true });
  return new Response(null, { status: 303, headers: { Location: "/contact/thanks" } });
}

export const POST: APIRoute = async ({ request }) => {
  let form: FormData;
  try {
    form = await request.formData();
  } catch {
    return fail(request, 400, "Invalid form submission.");
  }
  const field = (name: string) => String(form.get(name) ?? "").trim();

  // Bots fill every field; pretend it worked so they don't adapt
  if (field(HONEYPOT_FIELD)) return succeed(request);

  const lead = {
    name: field("name"),
    businessName: field("business_name"),
    email: field("email").toLowerCase(),
    phone: field("phone"),
    service: field("service"),
    message: field("message"),
  };

  if (!lead.name || lead.name.length > 120) return fail(request, 400, "Please enter your name.");
  if (lead.businessName.length > 160) return fail(request, 400, "That business name looks too long.");
  if (!EMAIL_RE.test(lead.email) || lead.email.length > 254) return fail(request, 400, "Please enter a valid email address.");
  if (lead.phone.length > 40) return fail(request, 400, "That phone number looks too long.");
  if (!SERVICE_OPTIONS.includes(lead.service)) return fail(request, 400, "Please choose a service.");
  if (lead.message.length > 5000) return fail(request, 400, "Your message is too long (5,000 characters max).");

  const sql = getSql();
  if (!sql) {
    console.error("[contact] DATABASE_URL is not set; enquiry not stored");
    return fail(request, 503, "Sorry, the form isn't available right now.");
  }

  try {
    await sql`
      INSERT INTO leads (source, name, business_name, email, phone, service, message)
      VALUES ('website', ${lead.name}, ${lead.businessName || null}, ${lead.email}, ${lead.phone || null}, ${lead.service}, ${lead.message || null})
    `;
  } catch (err) {
    console.error("[contact] failed to store lead", err);
    return fail(request, 500, "Sorry, something went wrong sending your enquiry.");
  }

  return succeed(request);
};
