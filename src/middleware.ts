import { defineMiddleware } from "astro:middleware";
import { SESSION_COOKIE, verifySession } from "./lib/auth";

// Routes that render on demand but must stay reachable without a session
// (/api/leads/import authenticates with its own SHEET_SYNC_SECRET token instead)
const PUBLIC_ROUTES = new Set(["/dashboard/login", "/api/contact", "/api/leads/import"]);

// Deny by default: every on-demand route requires a valid admin session unless allowlisted.
// Prerendered public pages skip this entirely. Matching on the resolved route pattern (not the
// raw URL) means encoded or oddly-cased paths can't slip past the check.
export const onRequest = defineMiddleware(async (context, next) => {
  if (context.isPrerendered || PUBLIC_ROUTES.has(context.routePattern)) return next();

  if (!(await verifySession(context.cookies.get(SESSION_COOKIE)?.value))) {
    const target = context.url.pathname + context.url.search;
    return context.redirect(`/dashboard/login?next=${encodeURIComponent(target)}`);
  }

  const response = await next();
  response.headers.set("Cache-Control", "private, no-store");
  response.headers.set("X-Robots-Tag", "noindex, nofollow");
  return response;
});
