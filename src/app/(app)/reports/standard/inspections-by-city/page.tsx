import Link from "next/link";
import { prisma } from "@/lib/prisma";
import { ReportTable } from "../../ReportTable";

// Grouping by a related field (property.city) is out of scope for the
// generic reporting service's groupBy mode on purpose (Prisma's groupBy
// can't aggregate across a relation without raw SQL — see reporting.ts).
// That restriction only applies to the *dynamic*, user-driven query path;
// this is a fixed, developer-authored report, so a direct query + in-app
// aggregation is the correct tool here, not a workaround.
export default async function InspectionsByCityPage() {
  const inspections = await prisma.inspection.findMany({
    include: { property: { select: { city: true } } },
    take: 1000,
  });

  const counts = new Map<string, number>();
  for (const i of inspections) {
    const city = i.property.city || "Unknown";
    counts.set(city, (counts.get(city) ?? 0) + 1);
  }

  const rows = Array.from(counts.entries())
    .map(([city, count]) => ({ city, count }))
    .sort((a, b) => b.count - a.count);
  const reconciledTotal = inspections.length;

  return (
    <div className="max-w-2xl space-y-4">
      <Link href="/reports" className="text-xs text-slate-500 hover:underline">
        ← Reports
      </Link>
      <h1 className="text-xl font-semibold text-slate-900">Inspections by City</h1>
      <ReportTable rows={rows} reconciledTotal={reconciledTotal} />
    </div>
  );
}
