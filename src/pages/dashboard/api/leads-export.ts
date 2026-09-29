import type { APIRoute } from "astro";
import { getSql } from "../../../lib/db";

export const prerender = false;

// Downloads every lead as CSV (session-protected by middleware)

const COLUMNS = ["id", "created_at", "source", "status", "business_name", "name", "position", "email", "phone", "website", "service", "message"] as const;

// Quote every cell; neutralise values a spreadsheet would treat as a formula
const cell = (v: unknown) => {
  let s = v instanceof Date ? v.toISOString() : String(v ?? "");
  if (/^[=+\-@\t\r]/.test(s)) s = `'${s}`;
  return `"${s.replace(/"/g, '""')}"`;
};

export const GET: APIRoute = async () => {
  const sql = getSql();
  if (!sql) return new Response("Database not configured", { status: 503 });
  const rows = (await sql.query(`SELECT ${COLUMNS.join(", ")} FROM leads ORDER BY created_at DESC, id DESC`)) as Record<string, unknown>[];
  const csv = [COLUMNS.join(","), ...rows.map((r) => COLUMNS.map((c) => cell(r[c])).join(","))].join("\r\n");
  const date = new Date().toISOString().slice(0, 10);
  return new Response("﻿" + csv, {
    headers: {
      "Content-Type": "text/csv; charset=utf-8",
      "Content-Disposition": `attachment; filename="mhal-leads-${date}.csv"`,
      "Cache-Control": "private, no-store",
    },
  });
};
