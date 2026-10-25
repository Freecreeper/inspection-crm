import { NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { assertCan, ForbiddenError } from "@/lib/rbac";
import { searchParamsToConfig, runReport, ReportValidationError } from "@/lib/reporting";
import { toCsv } from "@/lib/reports/csv";
import type { Role } from "@prisma/client";

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

  let result;
  try {
    result = await runReport(config);
  } catch (err) {
    if (err instanceof ReportValidationError) return NextResponse.json({ error: err.message }, { status: 400 });
    throw err;
  }

  return new NextResponse(toCsv(result.rows), {
    headers: {
      "Content-Type": "text/csv; charset=utf-8",
      "Content-Disposition": 'attachment; filename="report.csv"',
      "Cache-Control": "private, no-store",
    },
  });
}
