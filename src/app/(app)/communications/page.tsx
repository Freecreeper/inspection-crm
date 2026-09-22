import Link from "next/link";
import { prisma } from "@/lib/prisma";
import { getPrimaryCustomer } from "@/lib/transactions";

export default async function CommunicationsPage() {
  const communications = await prisma.communication.findMany({
    orderBy: { occurredAt: "desc" },
    include: { transaction: { include: { customers: { include: { customer: true } } } } },
    take: 100,
  });

  return (
    <div>
      <h1 className="text-xl font-semibold text-slate-900">Communications</h1>
      <p className="mt-1 text-sm text-slate-500">
        A read-only log across every transaction. Entries are logged from the transaction they belong
        to — communication history is never edited after the fact.
      </p>

      <div className="mt-6 overflow-hidden rounded-lg border border-slate-200 bg-white">
        <table className="w-full text-sm">
          <thead className="bg-slate-50 text-left text-xs uppercase tracking-wide text-slate-500">
            <tr>
              <th className="px-4 py-2 font-medium">When</th>
              <th className="px-4 py-2 font-medium">Transaction</th>
              <th className="px-4 py-2 font-medium">Channel</th>
              <th className="px-4 py-2 font-medium">Direction</th>
              <th className="px-4 py-2 font-medium">Summary</th>
            </tr>
          </thead>
          <tbody>
            {communications.map((c) => {
              const primaryCustomer = c.transaction ? getPrimaryCustomer(c.transaction.customers) : null;
              return (
                <tr key={c.id} className="border-t border-slate-100">
                  <td className="px-4 py-2 tabular-nums text-slate-600">{c.occurredAt.toLocaleString()}</td>
                  <td className="px-4 py-2">
                    {c.transaction ? (
                      <Link href={`/transactions/${c.transaction.id}`} className="font-medium text-slate-900 hover:underline">
                        {primaryCustomer ? `${primaryCustomer.firstName} ${primaryCustomer.lastName}` : "No customer yet"}
                      </Link>
                    ) : (
                      <span className="text-slate-400">—</span>
                    )}
                  </td>
                  <td className="px-4 py-2 text-slate-600">{c.channel}</td>
                  <td className="px-4 py-2 text-slate-600">{c.direction}</td>
                  <td className="px-4 py-2 text-slate-700">{c.summary}</td>
                </tr>
              );
            })}
            {communications.length === 0 && (
              <tr>
                <td colSpan={5} className="px-4 py-6 text-center text-slate-400">
                  No communications logged yet.
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>
    </div>
  );
}
