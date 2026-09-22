import Link from "next/link";
import { runReport } from "@/lib/reporting";
import { ReportTable } from "../../ReportTable";

export default async function TransactionsByStatusPage() {
  const result = await runReport({
    entity: "Transaction",
    columns: [],
    filters: [],
    groupBy: ["status"],
    aggregations: [{ fieldKey: "id", fn: "count" }],
  });

  return (
    <div className="max-w-2xl space-y-4">
      <Link href="/reports" className="text-xs text-slate-500 hover:underline">
        ← Reports
      </Link>
      <h1 className="text-xl font-semibold text-slate-900">Transactions by Status</h1>
      <ReportTable rows={result.rows} reconciledTotal={result.reconciledTotal} />
    </div>
  );
}
