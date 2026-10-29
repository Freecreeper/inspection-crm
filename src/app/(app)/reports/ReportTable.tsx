import { formatBusinessDate } from "@/lib/businessTime";
function formatCell(value: unknown): string {
  if (value === null || value === undefined) return "Unknown";
  if (value instanceof Date) return formatBusinessDate(value);
  if (typeof value === "object") {
    // Prisma's groupBy aggregation buckets (_count/_sum/_avg) come back as
    // single-key objects like { _all: 5 } or { squareFootage: 1800 } — show
    // the number itself, not the raw wrapper object.
    const entries = Object.entries(value as Record<string, unknown>);
    if (entries.length === 1 && typeof entries[0][1] !== "object") return String(entries[0][1]);
    return JSON.stringify(value);
  }
  return String(value);
}

// Shared read-only results table for both the custom builder and the fixed
// standard reports — reconciledTotal is always shown so a grouped report
// never looks like it silently dropped NULL/"Unknown" rows from the total.
export function ReportTable({ rows, reconciledTotal }: { rows: Record<string, unknown>[]; reconciledTotal: number }) {
  return (
    <>
      <p className="text-xs text-muted-foreground">
        {reconciledTotal} total record{reconciledTotal === 1 ? "" : "s"} — every matching row is counted, including
        ones with an unknown value for the fields shown.
      </p>
      <div className="mt-2 overflow-x-auto rounded-lg border border-border bg-surface">
        <table className="w-full text-sm">
          <thead className="bg-surface-secondary text-left text-xs uppercase tracking-wide text-muted-foreground">
            <tr>{rows[0] && Object.keys(rows[0]).map((key) => <th key={key} className="px-3 py-2 font-medium">{key}</th>)}</tr>
          </thead>
          <tbody>
            {rows.map((row, idx) => (
              <tr key={idx} className="border-t border-neutral-100">
                {Object.values(row).map((value, vIdx) => (
                  <td key={vIdx} className="px-3 py-2 text-neutral-700">
                    {formatCell(value)}
                  </td>
                ))}
              </tr>
            ))}
            {rows.length === 0 && (
              <tr>
                <td className="px-3 py-6 text-center text-subtle">No matching records.</td>
              </tr>
            )}
          </tbody>
        </table>
      </div>
    </>
  );
}
