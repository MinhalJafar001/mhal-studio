import type { APIRoute } from "astro";
import { SESSION_COOKIE } from "../../lib/auth";

export const prerender = false;

export const POST: APIRoute = ({ cookies, redirect }) => {
  cookies.delete(SESSION_COOKIE, { path: "/dashboard" });
  return redirect("/dashboard/login", 303);
};
