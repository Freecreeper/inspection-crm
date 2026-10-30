import { NextResponse } from "next/server";
import type { Role } from "@prisma/client";
import { auth } from "@/lib/auth";
import { can } from "@/lib/rbac";
import { getCalendarConfig } from "@/lib/calendar/config";
import { toDayKey } from "@/lib/calendar/time";
import { resolvePeriod } from "@/lib/reports/crossEntity";
import { buildCrossEntityReport, isCrossEntitySlug, reportToCsvRows } from "@/lib/reports/crossEntityData";
import { toCsv } from "@/lib/reports/csv";

// CSV of a cross-entity Standard Report: exactly the rows and columns the
// page shows for the same period, totals last.
export async function GET(req: Request, { params }: { params: Promise<{ slug: string }> }) {
  const session = await auth();
  if (!session?.user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  const role = session.user.role as Role | undefined;
  if (!can(role, "report-builder:use")) return NextResponse.json({ error: "Forbidden" }, { status: 403 });

  const { slug } = await params;
  if (!isCrossEntitySlug(slug)) return NextResponse.json({ error: "Unknown report" }, { status: 404 });

  const url = new URL(req.url);
  const { timeZone } = getCalendarConfig();
  const range = resolvePeriod(
    { period: url.searchParams.get("period") ?? undefined, from: url.searchParams.get("from") ?? undefined, to: url.searchParams.get("to") ?? undefined },
    toDayKey(new Date(), timeZone),
    timeZone
  );
  const report = await buildCrossEntityReport(slug, range, { includeFinancials: can(role, "financial:read") });
  const suffix = range.from && range.to ? `${range.from}_to_${range.to}` : "all-time";

  return new NextResponse(toCsv(reportToCsvRows(report)), {
    headers: {
      "Content-Type": "text/csv; charset=utf-8",
      "Content-Disposition": `attachment; filename="${slug}_${suffix}.csv"`,
      "Cache-Control": "private, no-store",
    },
  });
}
