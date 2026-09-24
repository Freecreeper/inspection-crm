import { prisma } from "@/lib/prisma";
import { createTransaction } from "../actions";
import { CustomerCombobox } from "../../customers/CustomerCombobox";
import { PropertyCombobox } from "../../properties/PropertyCombobox";
import { ReferralSourceCombobox } from "../../referral-sources/ReferralSourceCombobox";

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
          <div className="mt-1">
            <CustomerCombobox
              name="customerId"
              defaultValue={customerId ?? ""}
              options={customers.map((c) => ({ id: c.id, label: `${c.firstName} ${c.lastName}`, sublabel: c.email ?? undefined }))}
            />
          </div>
        </div>
        <div>
          <label className="block text-sm font-medium text-slate-700">Property (optional)</label>
          <div className="mt-1">
            <PropertyCombobox
              name="propertyId"
              options={properties.map((p) => ({ id: p.id, label: `${p.addressLine1}, ${p.city}` }))}
            />
          </div>
        </div>
        <div>
          <label className="block text-sm font-medium text-slate-700">Referral source (optional)</label>
          <div className="mt-1">
            <ReferralSourceCombobox
              name="referralSourceId"
              options={referralSources.map((r) => ({ id: r.id, label: r.name, sublabel: r.type }))}
            />
          </div>
        </div>
        <button type="submit" className="w-full rounded-md bg-slate-900 px-3 py-2 text-sm font-medium text-white hover:bg-slate-800">
          Create transaction
        </button>
      </form>
    </div>
  );
}
