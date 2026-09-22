import Link from "next/link";
import { prisma } from "@/lib/prisma";
import { runReport } from "@/lib/reporting";
import { ReportTable } from "../../ReportTable";

export default async function FindingsByCategoryPage() {
  const [result, categories] = await Promise.all([
    runReport({
      entity: "Finding",
      columns: [],
      filters: [],
      groupBy: ["categoryId"],
      aggregations: [{ fieldKey: "id", fn: "count" }],
    }),
    prisma.findingCategory.findMany(),
  ]);

  // groupBy returns only the raw scalar (categoryId), never a joined label —
  // resolve it here rather than in the generic reporting service, which
  // deliberately never joins across a relation for a group key.
  const labelById = new Map(categories.map((c) => [c.id, c.label]));
  const rows = result.rows.map((row) => ({
    category: row.categoryId ? (labelById.get(row.categoryId as string) ?? "Unknown") : "Uncategorized",
    count: row._count,
  }));

  return (
    <div className="max-w-2xl space-y-4">
      <Link href="/reports" className="text-xs text-slate-500 hover:underline">
        ← Reports
      </Link>
      <h1 className="text-xl font-semibold text-slate-900">Findings by Category</h1>
      <p className="text-sm text-slate-500">
        Operational/business analytics only — frequency here is not proof of safety, defect severity, or property
        quality.
      </p>
      <ReportTable rows={rows} reconciledTotal={result.reconciledTotal} />
    </div>
  );
}
