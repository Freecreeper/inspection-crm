import Link from "next/link";
import { prisma } from "@/lib/prisma";
import { getPrimaryCustomer } from "@/lib/transactions";

export default async function InspectionsPage() {
  const inspections = await prisma.inspection.findMany({
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
                    {i.scheduledAt ? i.scheduledAt.toLocaleString() : <span className="text-slate-400">Not set</span>}
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
                  No inspections scheduled yet — schedule one from a transaction.
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>
    </div>
  );
}
