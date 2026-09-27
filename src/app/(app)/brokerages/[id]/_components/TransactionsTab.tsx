import Link from "next/link";
import { prisma } from "@/lib/prisma";
import { formatShortDate } from "@/lib/dates";
import { formatCurrency } from "@/lib/realtors/display";
import { brokerageTransactionWhere, loadBrokerageTransactions } from "@/lib/brokerages/record";
import { humanStatus } from "../../../realtors/[id]/_components/ui";

const MAX_ROWS = 200;

// Every deal one of its realtors worked while at this brokerage.
export async function TransactionsTab({ brokerageId, permissions }: { brokerageId: string; permissions: { canViewFinancials: boolean } }) {
  const [rows, total] = await Promise.all([
    loadBrokerageTransactions(brokerageId, { take: MAX_ROWS, includeFinancials: permissions.canViewFinancials }),
    prisma.transaction.count({ where: brokerageTransactionWhere(brokerageId) }),
  ]);

  if (rows.length === 0) {
    return <p className="rounded-lg border border-slate-200 bg-white p-8 text-center text-sm text-slate-500">No transactions with this brokerage&apos;s realtors yet.</p>;
  }

  return (
    <div>
      <p className="mb-3 text-sm text-slate-600">
        {total} transaction{total === 1 ? "" : "s"} worked by realtors while at this brokerage.{" "}
        <span className="text-slate-500">A realtor who has since moved still counts here for deals they worked here.</span>
      </p>
      <div className="overflow-x-auto rounded-lg border border-slate-200 bg-white">
        <table className="w-full min-w-[760px] text-sm">
          <thead className="border-b border-slate-200 text-left text-xs uppercase tracking-wide text-slate-500">
            <tr>
              <th scope="col" className="px-3 py-2.5 font-medium">Property</th>
              <th scope="col" className="px-3 py-2.5 font-medium">Customer(s)</th>
              <th scope="col" className="px-3 py-2.5 font-medium">Realtor(s)</th>
              <th scope="col" className="px-3 py-2.5 font-medium">Inspection</th>
              <th scope="col" className="px-3 py-2.5 font-medium">Status</th>
              {permissions.canViewFinancials && <th scope="col" className="px-3 py-2.5 text-right font-medium">Revenue</th>}
            </tr>
          </thead>
          <tbody>
            {rows.map((t) => (
              <tr key={t.id} className="border-t border-slate-100 first:border-t-0">
                <td className="px-3 py-2.5">
                  <Link href={`/transactions/${t.id}`} className="font-medium text-slate-900 hover:underline">
                    {t.property ?? "No property yet"}
                  </Link>
                </td>
                <td className="px-3 py-2.5 text-slate-600">{t.customers.length ? t.customers.join(", ") : <span className="text-slate-400">None yet</span>}</td>
                <td className="px-3 py-2.5 text-slate-600">
                  {t.realtors.map((r, i) => (
                    <span key={`${r.id}-${i}`}>
                      {i > 0 && ", "}
                      <Link href={`/realtors/${r.id}`} className="hover:text-slate-900 hover:underline">
                        {r.name}
                      </Link>
                      <span className="text-slate-500"> ({r.role})</span>
                    </span>
                  ))}
                </td>
                <td className="px-3 py-2.5 text-slate-600">
                  {t.inspectionStatus ? (
                    <>
                      {humanStatus(t.inspectionStatus)}
                      {t.inspectionDate && <span className="text-slate-500"> · {formatShortDate(t.inspectionDate)}</span>}
                    </>
                  ) : (
                    <span className="text-slate-400">None</span>
                  )}
                </td>
                <td className="px-3 py-2.5 text-slate-600">{humanStatus(t.status)}</td>
                {permissions.canViewFinancials && <td className="px-3 py-2.5 text-right tabular-nums text-slate-700">{formatCurrency(t.revenue)}</td>}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      {total > rows.length && <p className="mt-2 text-xs text-slate-500">Showing the {rows.length} most recent of {total}.</p>}
    </div>
  );
}
