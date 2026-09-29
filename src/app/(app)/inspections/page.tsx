import Link from "next/link";
import type { Prisma } from "@prisma/client";
import { prisma } from "@/lib/prisma";
import { getPrimaryCustomer } from "@/lib/transactions";
import { getCalendarConfig } from "@/lib/calendar/config";
import { addDays, formatDay, formatTime, startOfDayUtc, toDayKey } from "@/lib/calendar/time";
import { unfinishedReportWhere } from "@/lib/dashboard/sources";

// Filters the Dashboard links to, using the same definitions as its KPIs.
const FILTERS = {
  "report-pending": "Completed, report not finalized",
  "agreement-unsigned": "Scheduled in the next 14 days, agreement unsigned",
} as const;
type Filter = keyof typeof FILTERS;

export default async function InspectionsPage({ searchParams }: { searchParams: Promise<{ filter?: string }> }) {
  const { filter: rawFilter } = await searchParams;
  const filter = rawFilter && rawFilter in FILTERS ? (rawFilter as Filter) : null;
  const { timeZone } = getCalendarConfig();
  const today = toDayKey(new Date(), timeZone);
  const where: Prisma.InspectionWhereInput | undefined =
    filter === "report-pending"
      ? unfinishedReportWhere()
      : filter === "agreement-unsigned"
        ? { status: "SCHEDULED", agreementSignedAt: null, scheduledAt: { gte: startOfDayUtc(today, timeZone), lt: startOfDayUtc(addDays(today, 15), timeZone) } }
        : undefined;
  const inspections = await prisma.inspection.findMany({
    where,
    orderBy: [{ scheduledAt: "asc" }, { createdAt: "desc" }],
    include: {
      property: true,
      inspector: true,
      transaction: { include: { customers: { include: { customer: true } } } },
      reports: { select: { id: true, status: true } },
    },
    take: 100,
  });

  return (
    <div>
      <h1 className="text-xl font-semibold text-slate-900">Inspections</h1>
      {filter && (
        <p className="mt-2 flex flex-wrap items-center gap-2 text-sm text-slate-600">
          <span className="rounded-full bg-slate-100 px-2.5 py-0.5 text-slate-700">Showing: {FILTERS[filter]}</span>
          <Link href="/inspections" className="text-emerald-700 hover:underline">
            Clear filter
          </Link>
        </p>
      )}
      <div className="mt-6 overflow-hidden rounded-lg border border-slate-200 bg-white">
        <table className="w-full text-sm">
          <thead className="bg-slate-50 text-left text-xs uppercase tracking-wide text-slate-500">
            <tr>
              <th className="px-4 py-2 font-medium">Property</th>
              <th className="px-4 py-2 font-medium">Customer</th>
              <th className="px-4 py-2 font-medium">Scheduled</th>
              <th className="px-4 py-2 font-medium">Inspector</th>
              <th className="px-4 py-2 font-medium">Status</th>
              <th className="px-4 py-2 font-medium">Report</th>
            </tr>
          </thead>
          <tbody>
            {inspections.map((i) => {
              const primaryCustomer = getPrimaryCustomer(i.transaction.customers);
              const report = i.reports[0];
              return (
                <tr key={i.id} className="border-t border-slate-100 hover:bg-slate-50">
                  <td className="px-4 py-2">
                    <Link href={`/inspections/${i.id}`} className="font-medium text-slate-900 hover:underline">
                      {i.property.addressLine1}, {i.property.city}
                    </Link>
                  </td>
                  <td className="px-4 py-2 text-slate-600">
                    {primaryCustomer ? `${primaryCustomer.firstName} ${primaryCustomer.lastName}` : "No customer yet"}
                  </td>
                  <td className="px-4 py-2 tabular-nums text-slate-600">
                    {i.scheduledAt ? `${formatDay(toDayKey(i.scheduledAt, timeZone), "short")}, ${formatTime(i.scheduledAt, timeZone)}` : <span className="text-slate-400">Not set</span>}
                  </td>
                  <td className="px-4 py-2 text-slate-600">
                    {i.inspector?.name || <span className="text-slate-400">Unassigned</span>}
                  </td>
                  <td className="px-4 py-2">
                    <span className="rounded-full bg-slate-100 px-2 py-0.5 font-mono text-[11px] text-slate-600">
                      {i.status}
                    </span>
                  </td>
                  <td className="px-4 py-2">
                    {report ? (
                      <span className="rounded-full bg-blue-100 px-2 py-0.5 font-mono text-[11px] text-blue-700">
                        {report.status}
                      </span>
                    ) : (
                      <span className="text-slate-400">Not started</span>
                    )}
                  </td>
                </tr>
              );
            })}
            {inspections.length === 0 && (
              <tr>
                <td colSpan={6} className="px-4 py-6 text-center text-slate-400">
                  {filter ? "No inspections match this filter." : "No inspections scheduled yet — schedule one from a transaction."}
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>
    </div>
  );
}
