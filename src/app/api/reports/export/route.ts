import { NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { assertCan, ForbiddenError } from "@/lib/rbac";
import { searchParamsToConfig, runReport } from "@/lib/reporting";
import type { Role } from "@prisma/client";

function toCsvValue(value: unknown): string {
  if (value === null || value === undefined) return "";
  const str = value instanceof Date ? value.toISOString() : typeof value === "object" ? JSON.stringify(value) : String(value);
  return `"${str.replace(/"/g, '""')}"`;
}

export async function GET(req: Request) {
  const session = await auth();
  if (!session?.user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  try {
    assertCan(session.user.role as Role | undefined, "report-builder:use");
  } catch (err) {
    if (err instanceof ForbiddenError) return NextResponse.json({ error: "Forbidden" }, { status: 403 });
    throw err;
  }

  const url = new URL(req.url);
  const sp: Record<string, string | string[]> = {};
  for (const key of url.searchParams.keys()) {
    const values = url.searchParams.getAll(key);
    sp[key] = values.length > 1 ? values : values[0];
  }

  const config = searchParamsToConfig(sp);
  if (!config) return NextResponse.json({ error: "Invalid report configuration" }, { status: 400 });

  const result = await runReport(config);
  const headers = result.rows[0] ? Object.keys(result.rows[0]) : [];
  const lines = [headers.join(","), ...result.rows.map((row) => headers.map((h) => toCsvValue(row[h])).join(","))];

  return new NextResponse(lines.join("\n"), {
    headers: {
      "Content-Type": "text/csv",
      "Content-Disposition": 'attachment; filename="report.csv"',
    },
  });
}
