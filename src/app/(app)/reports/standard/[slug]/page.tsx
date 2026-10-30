import Link from "next/link";
import { notFound } from "next/navigation";
import { requireReportAccess } from "@/lib/reports/access";
import { can } from "@/lib/rbac";
import { getCalendarConfig } from "@/lib/calendar/config";
import { toDayKey } from "@/lib/calendar/time";
import { PERIOD_OPTIONS, resolvePeriod } from "@/lib/reports/crossEntity";
import { buildCrossEntityReport, CROSS_ENTITY_REPORTS, isCrossEntitySlug } from "@/lib/reports/crossEntityData";

// The cross-entity Standard Reports (by Realtor, Brokerage, Referral
// Source). Plain GET forms, no client JS, like the rest of Reports.
export default async function CrossEntityReportPage({ params, searchParams }: { params: Promise<{ slug: string }>; searchParams: Promise<{ period?: string; from?: string; to?: string }> }) {
  const { role } = await requireReportAccess();
  const { slug } = await params;
  if (!isCrossEntitySlug(slug)) notFound();
  const sp = await searchParams;
  const { timeZone } = getCalendarConfig();
  const range = resolvePeriod(sp, toDayKey(new Date(), timeZone), timeZone);
  const report = await buildCrossEntityReport(slug, range, { includeFinancials: can(role, "financial:read") });

  const query = new URLSearchParams({ period: range.key, ...(range.key === "custom" && range.from && range.to ? { from: range.from, to: range.to } : {}) });
  const input = "mt-1 block rounded-md border border-input px-2 py-1.5 text-sm";

  return (
    <div className="max-w-5xl space-y-4">
      <Link href="/reports" className="text-xs text-muted-foreground hover:underline">
        ← Reports
      </Link>
      <div>
        <h1 className="text-xl font-semibold text-foreground">{report.title}</h1>
        <p className="mt-1 text-sm text-muted-foreground">{CROSS_ENTITY_REPORTS[slug].blurb}</p>
      </div>

      <form method="get" className="flex flex-wrap items-end gap-3 rounded-lg border border-border bg-surface p-3">
        <label className="text-xs font-medium text-neutral-700">
          Period
          <select name="period" defaultValue={range.key} className={input}>
            {PERIOD_OPTIONS.map((o) => (
              <option key={o.key} value={o.key}>
                {o.label}
              </option>
            ))}
          </select>
        </label>
        <label className="text-xs font-medium text-neutral-700">
          From <span className="font-normal text-muted-foreground">(custom)</span>
          <input type="date" name="from" defaultValue={range.key === "custom" ? (range.from ?? "") : ""} className={input} />
        </label>
        <label className="text-xs font-medium text-neutral-700">
          To <span className="font-normal text-muted-foreground">(custom)</span>
          <input type="date" name="to" defaultValue={range.key === "custom" ? (range.to ?? "") : ""} className={input} />
        </label>
        <button type="submit" className="rounded-md bg-primary px-3 py-1.5 text-sm font-medium text-primary-foreground hover:bg-primary-hover">
          Apply
        </button>
        <a href={`/api/reports/standard/${slug}?${query}`} className="ml-auto text-sm text-info-strong hover:underline">
          Export CSV
        </a>
      </form>

      <p className="text-sm text-neutral-600">{range.label}</p>

      <div className="overflow-x-auto rounded-lg border border-border bg-surface">
        <table className="w-full text-sm">
          <thead className="bg-surface-secondary text-left text-xs uppercase tracking-wide text-muted-foreground">
            <tr>
              {report.columns.map((c) => (
                <th key={c.key} scope="col" className={`px-3 py-2 font-medium ${c.numeric ? "text-right" : ""}`}>
                  {c.label}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {report.rows.map((row, idx) => (
              <tr key={idx} className={`border-t border-neutral-100 ${row.muted ? "text-muted-foreground" : "text-neutral-800"}`}>
                {report.columns.map((c, cIdx) => (
                  <td key={c.key} className={`px-3 py-2 ${c.numeric ? "text-right tabular-nums" : ""}`}>
                    {cIdx === 0 && row.href ? (
                      <Link href={row.href} className="font-medium text-foreground hover:underline">
                        {row.cells[c.key]}
                      </Link>
                    ) : (
                      row.cells[c.key]
                    )}
                  </td>
                ))}
              </tr>
            ))}
            {report.rows.length === 0 && (
              <tr>
                <td colSpan={report.columns.length} className="px-3 py-8 text-center text-subtle">
                  Nothing in this period.
                </td>
              </tr>
            )}
          </tbody>
          {report.totals && report.rows.length > 0 && (
            <tfoot className="border-t-2 border-border bg-surface-secondary font-medium text-foreground">
              <tr>
                {report.columns.map((c) => (
                  <td key={c.key} className={`px-3 py-2 ${c.numeric ? "text-right tabular-nums" : ""}`}>
                    {report.totals![c.key]}
                  </td>
                ))}
              </tr>
            </tfoot>
          )}
        </table>
      </div>

      <ul className="list-disc space-y-1 pl-5 text-xs text-muted-foreground">
        {report.notes.map((n) => (
          <li key={n}>{n}</li>
        ))}
      </ul>
    </div>
  );
}
