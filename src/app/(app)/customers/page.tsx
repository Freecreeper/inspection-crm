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
      <h1 className="text-xl font-semibold text-neutral-900">Customers</h1>
      <div className="mt-6 overflow-hidden rounded-lg border border-neutral-200 bg-surface">
        <table className="w-full text-sm">
          <thead className="bg-neutral-50 text-left text-xs uppercase tracking-wide text-neutral-500">
            <tr>
              <th className="px-4 py-2 font-medium">Name</th>
              <th className="px-4 py-2 font-medium">Contact</th>
              <th className="px-4 py-2 font-medium">Transactions</th>
            </tr>
          </thead>
          <tbody>
            {customers.map((c) => (
              <tr key={c.id} className="border-t border-neutral-100 hover:bg-neutral-50">
                <td className="px-4 py-2">
                  <Link href={`/customers/${c.id}`} className="font-medium text-neutral-900 hover:underline">
                    {c.firstName} {c.lastName}
                  </Link>
                </td>
                <td className="px-4 py-2 text-neutral-600">
                  {c.email || c.phone || <span className="text-neutral-400">Not provided</span>}
                </td>
                <td className="px-4 py-2 tabular-nums text-neutral-600">{c._count.transactions}</td>
              </tr>
            ))}
            {customers.length === 0 && (
              <tr>
                <td colSpan={3} className="px-4 py-6 text-center text-neutral-400">
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
