import Link from "next/link";
import { prisma } from "@/lib/prisma";
import { getPrimaryCustomer } from "@/lib/transactions";

export default async function TransactionsPage() {
  const transactions = await prisma.transaction.findMany({
    where: { archivedAt: null },
    orderBy: { createdAt: "desc" },
    include: { customers: { include: { customer: true } }, property: true },
    take: 50,
  });

  return (
    <div>
      <div className="flex items-center justify-between">
        <h1 className="text-xl font-semibold text-slate-900">Transactions</h1>
        <Link href="/transactions/new" className="rounded-md bg-slate-900 px-3 py-1.5 text-sm font-medium text-white hover:bg-slate-800">
          + New transaction
        </Link>
      </div>
      <div className="mt-6 overflow-hidden rounded-lg border border-slate-200 bg-white">
        <table className="w-full text-sm">
          <thead className="bg-slate-50 text-left text-xs uppercase tracking-wide text-slate-500">
            <tr>
              <th className="px-4 py-2 font-medium">Customer</th>
              <th className="px-4 py-2 font-medium">Property</th>
              <th className="px-4 py-2 font-medium">Status</th>
            </tr>
          </thead>
          <tbody>
            {transactions.map((t) => {
              const primaryCustomer = getPrimaryCustomer(t.customers);
              return (
                <tr key={t.id} className="border-t border-slate-100 hover:bg-slate-50">
                  <td className="px-4 py-2">
                    <Link href={`/transactions/${t.id}`} className="font-medium text-slate-900 hover:underline">
                      {primaryCustomer ? (
                        `${primaryCustomer.firstName} ${primaryCustomer.lastName}`
                      ) : (
                        <span className="text-slate-400">No customer yet</span>
                      )}
                    </Link>
                  </td>
                  <td className="px-4 py-2 text-slate-600">
                    {t.property ? `${t.property.addressLine1}, ${t.property.city}` : <span className="text-slate-400">Not set</span>}
                  </td>
                  <td className="px-4 py-2">
                    <span className="rounded-full bg-slate-100 px-2 py-0.5 font-mono text-[11px] text-slate-600">
                      {t.status}
                    </span>
                  </td>
                </tr>
              );
            })}
            {transactions.length === 0 && (
              <tr>
                <td colSpan={3} className="px-4 py-6 text-center text-slate-400">
                  No transactions yet.
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>
    </div>
  );
}
