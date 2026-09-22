import Link from "next/link";
import { notFound } from "next/navigation";
import { prisma } from "@/lib/prisma";

export default async function CustomerDetailPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const customer = await prisma.customer.findUnique({
    where: { id },
    include: {
      transactions: {
        include: { transaction: { include: { property: true } } },
        orderBy: { createdAt: "desc" },
      },
    },
  });
  if (!customer) notFound();

  return (
    <div className="max-w-2xl">
      <h1 className="text-xl font-semibold text-slate-900">
        {customer.firstName} {customer.lastName}
      </h1>
      <dl className="mt-4 grid grid-cols-2 gap-x-4 gap-y-2 rounded-lg border border-slate-200 bg-white p-4 text-sm">
        <dt className="text-slate-500">Email</dt>
        <dd className="text-slate-900">{customer.email || <span className="text-slate-400">Not provided</span>}</dd>
        <dt className="text-slate-500">Phone</dt>
        <dd className="text-slate-900">{customer.phone || <span className="text-slate-400">Not provided</span>}</dd>
      </dl>

      <div className="mt-6 flex items-center justify-between">
        <h2 className="text-sm font-semibold text-slate-900">Transactions</h2>
        <Link href={`/transactions/new?customerId=${customer.id}`} className="text-sm text-blue-700 hover:underline">
          + New transaction
        </Link>
      </div>
      <div className="mt-2 overflow-hidden rounded-lg border border-slate-200 bg-white">
        <table className="w-full text-sm">
          <thead className="bg-slate-50 text-left text-xs uppercase tracking-wide text-slate-500">
            <tr>
              <th className="px-4 py-2 font-medium">Property</th>
              <th className="px-4 py-2 font-medium">Status</th>
            </tr>
          </thead>
          <tbody>
            {customer.transactions.map((tc) => (
              <tr key={tc.id} className="border-t border-slate-100 hover:bg-slate-50">
                <td className="px-4 py-2">
                  <Link href={`/transactions/${tc.transaction.id}`} className="font-medium text-slate-900 hover:underline">
                    {tc.transaction.property
                      ? `${tc.transaction.property.addressLine1}, ${tc.transaction.property.city}`
                      : "No property yet"}
                  </Link>
                  <span className="ml-2 font-mono text-[11px] text-slate-400">{tc.role}</span>
                </td>
                <td className="px-4 py-2">
                  <span className="rounded-full bg-slate-100 px-2 py-0.5 font-mono text-[11px] text-slate-600">
                    {tc.transaction.status}
                  </span>
                </td>
              </tr>
            ))}
            {customer.transactions.length === 0 && (
              <tr>
                <td colSpan={2} className="px-4 py-6 text-center text-slate-400">
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
