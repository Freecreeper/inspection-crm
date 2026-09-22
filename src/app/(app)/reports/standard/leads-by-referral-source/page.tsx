import Link from "next/link";
import { prisma } from "@/lib/prisma";
import { runReport } from "@/lib/reporting";
import { ReportTable } from "../../ReportTable";

export default async function LeadsByReferralSourcePage() {
  const [result, sources] = await Promise.all([
    runReport({
      entity: "Lead",
      columns: [],
      filters: [],
      groupBy: ["referralSourceId"],
      aggregations: [{ fieldKey: "id", fn: "count" }],
    }),
    prisma.referralSource.findMany(),
  ]);

  const nameById = new Map(sources.map((s) => [s.id, s.name]));
  const rows = result.rows.map((row) => ({
    referralSource: row.referralSourceId ? (nameById.get(row.referralSourceId as string) ?? "Unknown") : "Unknown",
    count: row._count,
  }));

  return (
    <div className="max-w-2xl space-y-4">
      <Link href="/reports" className="text-xs text-slate-500 hover:underline">
        ← Reports
      </Link>
      <h1 className="text-xl font-semibold text-slate-900">Leads by Referral Source</h1>
      <p className="text-sm text-slate-500">
        Grouped by referral source — a null group is a real &quot;Unknown&quot; bucket, not a dropped record.
      </p>
      <ReportTable rows={rows} reconciledTotal={result.reconciledTotal} />
    </div>
  );
}
