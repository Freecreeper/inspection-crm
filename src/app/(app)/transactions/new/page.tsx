import { prisma } from "@/lib/prisma";
import { createTransaction } from "../actions";

export default async function NewTransactionPage({
  searchParams,
}: {
  searchParams: Promise<{ customerId?: string }>;
}) {
  const { customerId } = await searchParams;
  const [customers, properties, referralSources] = await Promise.all([
    prisma.customer.findMany({ where: { archivedAt: null }, orderBy: { lastName: "asc" } }),
    prisma.property.findMany({ orderBy: { addressLine1: "asc" } }),
    prisma.referralSource.findMany({ where: { active: true }, orderBy: { name: "asc" } }),
  ]);

  return (
    <div className="max-w-md">
      <h1 className="text-xl font-semibold text-slate-900">New transaction</h1>
      <form action={createTransaction} className="mt-6 space-y-4 rounded-lg border border-slate-200 bg-white p-5">
        <div>
          <label className="block text-sm font-medium text-slate-700">Primary customer (optional)</label>
          <select
            name="customerId"
            defaultValue={customerId ?? ""}
            className="mt-1 w-full rounded-md border border-slate-300 px-2 py-1.5 text-sm"
          >
            <option value="">Not set yet — add customers from the transaction</option>
            {customers.map((c) => (
              <option key={c.id} value={c.id}>
                {c.firstName} {c.lastName}
              </option>
            ))}
          </select>
        </div>
        <div>
          <label className="block text-sm font-medium text-slate-700">Property (optional)</label>
          <select name="propertyId" className="mt-1 w-full rounded-md border border-slate-300 px-2 py-1.5 text-sm">
            <option value="">Not set yet</option>
            {properties.map((p) => (
              <option key={p.id} value={p.id}>
                {p.addressLine1}, {p.city}
              </option>
            ))}
          </select>
        </div>
        <div>
          <label className="block text-sm font-medium text-slate-700">Referral source (optional)</label>
          <select name="referralSourceId" className="mt-1 w-full rounded-md border border-slate-300 px-2 py-1.5 text-sm">
            <option value="">Unknown</option>
            {referralSources.map((r) => (
              <option key={r.id} value={r.id}>
                {r.name}
              </option>
            ))}
          </select>
        </div>
        <button type="submit" className="w-full rounded-md bg-slate-900 px-3 py-2 text-sm font-medium text-white hover:bg-slate-800">
          Create transaction
        </button>
      </form>
    </div>
  );
}
