import { prisma } from "@/lib/prisma";
import { createTransaction } from "../actions";
import { CustomerCombobox } from "../../customers/CustomerCombobox";
import { PropertyCombobox } from "../../properties/PropertyCombobox";
import { ReferralSourceCombobox } from "../../referral-sources/ReferralSourceCombobox";

export default async function NewTransactionPage({
  searchParams,
}: {
  searchParams: Promise<{ customerId?: string; realtorId?: string }>;
}) {
  const { customerId, realtorId } = await searchParams;
  const [customers, properties, referralSources, realtor] = await Promise.all([
    prisma.customer.findMany({ where: { archivedAt: null }, orderBy: { lastName: "asc" } }),
    prisma.property.findMany({ orderBy: { addressLine1: "asc" } }),
    prisma.referralSource.findMany({ where: { active: true }, orderBy: { name: "asc" } }),
    realtorId
      ? prisma.realtor.findFirst({ where: { id: realtorId, archivedAt: null }, include: { brokerage: true } })
      : null,
  ]);

  return (
    <div className="max-w-md">
      <h1 className="text-xl font-semibold text-slate-900">New transaction</h1>
      <form action={createTransaction} className="mt-6 space-y-4 rounded-lg border border-slate-200 bg-white p-5">
        {realtor && (
          <div className="rounded-md bg-slate-50 p-3">
            <input type="hidden" name="realtorId" value={realtor.id} />
            <p className="text-sm text-slate-700">
              Realtor: <span className="font-medium text-slate-900">{realtor.firstName} {realtor.lastName}</span>
              {realtor.brokerage && <span className="text-slate-500"> · {realtor.brokerage.name}</span>}
            </p>
            <label htmlFor="realtorRole" className="mt-2 block text-sm font-medium text-slate-700">
              Their role on this transaction
            </label>
            <select id="realtorRole" name="realtorRole" required defaultValue="BUYER_AGENT" className="mt-1 w-full rounded-md border border-slate-300 px-2 py-1.5 text-sm">
              <option value="BUYER_AGENT">Buyer agent</option>
              <option value="LISTING_AGENT">Listing agent</option>
              <option value="TRANSACTION_COORDINATOR">Transaction coordinator</option>
              <option value="OTHER">Other</option>
            </select>
            <p className="mt-1 text-xs text-slate-500">
              This associates them with the deal. It doesn&apos;t record them as the referral source — pick that below if they referred it.
            </p>
          </div>
        )}
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
