import Link from "next/link";
import { prisma } from "@/lib/prisma";

export default async function CustomersPage() {
  const customers = await prisma.customer.findMany({
    where: { archivedAt: null },
    orderBy: { createdAt: "desc" },
    include: { _count: { select: { transactions: true } } },
    take: 50,
  });

  return (
    <div>
      <h1 className="text-xl font-semibold text-slate-900">Customers</h1>
      <div className="mt-6 overflow-hidden rounded-lg border border-slate-200 bg-white">
        <table className="w-full text-sm">
          <thead className="bg-slate-50 text-left text-xs uppercase tracking-wide text-slate-500">
            <tr>
              <th className="px-4 py-2 font-medium">Name</th>
              <th className="px-4 py-2 font-medium">Contact</th>
              <th className="px-4 py-2 font-medium">Transactions</th>
            </tr>
          </thead>
          <tbody>
            {customers.map((c) => (
              <tr key={c.id} className="border-t border-slate-100 hover:bg-slate-50">
                <td className="px-4 py-2">
                  <Link href={`/customers/${c.id}`} className="font-medium text-slate-900 hover:underline">
                    {c.firstName} {c.lastName}
                  </Link>
                </td>
                <td className="px-4 py-2 text-slate-600">
                  {c.email || c.phone || <span className="text-slate-400">Not provided</span>}
                </td>
                <td className="px-4 py-2 tabular-nums text-slate-600">{c._count.transactions}</td>
              </tr>
            ))}
            {customers.length === 0 && (
              <tr>
                <td colSpan={3} className="px-4 py-6 text-center text-slate-400">
                  No customers yet — convert a lead to create one.
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>
    </div>
  );
}
