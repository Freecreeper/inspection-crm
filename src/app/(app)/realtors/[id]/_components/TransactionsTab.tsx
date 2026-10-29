import Link from "next/link";
import { prisma } from "@/lib/prisma";
import { formatShortDate } from "@/lib/dates";
import { formatCurrency } from "@/lib/realtors/display";
import { associatedTransactionWhere } from "@/lib/realtors/metrics";
import { loadAssociatedTransactions } from "@/lib/realtors/record";
import { humanStatus, type RecordPermissions } from "./ui";

const MAX_ROWS = 200;

// Every transaction they were on in a Realtor role. Whether they also
// referred it is a separate question, answered on the Referrals tab.
export async function TransactionsTab({ realtorId, permissions }: { realtorId: string; permissions: RecordPermissions }) {
  const [rows, total] = await Promise.all([
    loadAssociatedTransactions(realtorId, { take: MAX_ROWS, includeFinancials: permissions.canViewFinancials }),
    prisma.transaction.count({ where: associatedTransactionWhere(realtorId) }),
  ]);

  if (rows.length === 0) {
    return <p className="rounded-lg border border-neutral-200 bg-surface p-8 text-center text-sm text-neutral-500">Not on any transactions yet.</p>;
  }

  return (
    <div>
      <p className="mb-3 text-sm text-neutral-600">
        {total} transaction{total === 1 ? "" : "s"} where this realtor had a role.{" "}
        <span className="text-neutral-500">Brokerage shown is the one they were with when added to that deal.</span>
      </p>
      <div className="overflow-x-auto rounded-lg border border-neutral-200 bg-surface">
        <table className="w-full min-w-[760px] text-sm">
          <thead className="border-b border-neutral-200 text-left text-xs uppercase tracking-wide text-neutral-500">
            <tr>
              <th scope="col" className="px-3 py-2.5 font-medium">Property</th>
              <th scope="col" className="px-3 py-2.5 font-medium">Customer(s)</th>
              <th scope="col" className="px-3 py-2.5 font-medium">Role</th>
              <th scope="col" className="px-3 py-2.5 font-medium">Brokerage then</th>
              <th scope="col" className="px-3 py-2.5 font-medium">Inspection</th>
              <th scope="col" className="px-3 py-2.5 font-medium">Status</th>
              {permissions.canViewFinancials && <th scope="col" className="px-3 py-2.5 text-right font-medium">Revenue</th>}
            </tr>
          </thead>
          <tbody>
            {rows.map((t) => (
              <tr key={t.id} className="border-t border-neutral-100 first:border-t-0">
                <td className="px-3 py-2.5">
                  <Link href={`/transactions/${t.id}`} className="font-medium text-neutral-900 hover:underline">
                    {t.property ?? "No property yet"}
                  </Link>
                </td>
                <td className="px-3 py-2.5 text-neutral-600">{t.customers.length ? t.customers.join(", ") : <span className="text-neutral-400">None yet</span>}</td>
                <td className="px-3 py-2.5 text-neutral-600">{t.roles.join(", ")}</td>
                <td className="px-3 py-2.5 text-neutral-600">{t.brokerageAtTheTime ?? <span className="text-neutral-400">—</span>}</td>
                <td className="px-3 py-2.5 text-neutral-600">
                  {t.inspectionStatus ? (
                    <>
                      {humanStatus(t.inspectionStatus)}
                      {t.inspectionDate && <span className="text-neutral-500"> · {formatShortDate(t.inspectionDate)}</span>}
                    </>
                  ) : (
                    <span className="text-neutral-400">None</span>
                  )}
                </td>
                <td className="px-3 py-2.5 text-neutral-600">{humanStatus(t.status)}</td>
                {permissions.canViewFinancials && <td className="px-3 py-2.5 text-right tabular-nums text-neutral-700">{formatCurrency(t.revenue)}</td>}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      {total > rows.length && <p className="mt-2 text-xs text-neutral-500">Showing the {rows.length} most recent of {total}.</p>}
    </div>
  );
}
