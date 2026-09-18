import { notFound } from "next/navigation";
import { prisma } from "@/lib/prisma";
import { addParticipant, setTransactionProperty } from "../actions";

export default async function TransactionDetailPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const [transaction, properties, realtors] = await Promise.all([
    prisma.transaction.findUnique({
      where: { id },
      include: {
        customer: true,
        property: true,
        referralSource: true,
        participants: { include: { realtor: { include: { brokerage: true } } } },
        inspections: true,
      },
    }),
    prisma.property.findMany({ orderBy: { addressLine1: "asc" } }),
    prisma.realtor.findMany({ where: { archivedAt: null }, orderBy: { lastName: "asc" } }),
  ]);
  if (!transaction) notFound();

  const setPropertyAction = setTransactionProperty.bind(null, transaction.id);
  const addParticipantAction = addParticipant.bind(null, transaction.id);

  return (
    <div className="max-w-3xl space-y-6">
      <div>
        <p className="font-mono text-xs uppercase tracking-wide text-slate-500">Transaction</p>
        <h1 className="text-xl font-semibold text-slate-900">
          {transaction.customer.firstName} {transaction.customer.lastName}
        </h1>
        <span className="mt-1 inline-block rounded-full bg-slate-100 px-2 py-0.5 font-mono text-[11px] text-slate-600">
          {transaction.status}
        </span>
      </div>

      <section className="rounded-lg border border-slate-200 bg-white p-4">
        <h2 className="text-sm font-semibold text-slate-900">Property</h2>
        {transaction.property ? (
          <p className="mt-2 text-sm text-slate-700">
            {transaction.property.addressLine1}, {transaction.property.city}, {transaction.property.state}{" "}
            {transaction.property.zip}
          </p>
        ) : (
          <>
            <p className="mt-1 text-sm text-slate-400">Not set — this never blocks other work on the transaction (§7).</p>
            <form action={setPropertyAction} className="mt-3 flex gap-2">
              <select name="propertyId" required className="flex-1 rounded-md border border-slate-300 px-2 py-1.5 text-sm">
                <option value="" disabled selected>
                  Select a property
                </option>
                {properties.map((p) => (
                  <option key={p.id} value={p.id}>
                    {p.addressLine1}, {p.city}
                  </option>
                ))}
              </select>
              <button type="submit" className="rounded-md bg-slate-900 px-3 py-1.5 text-sm font-medium text-white hover:bg-slate-800">
                Set
              </button>
            </form>
          </>
        )}
      </section>

      <section className="rounded-lg border border-slate-200 bg-white p-4">
        <h2 className="text-sm font-semibold text-slate-900">Referral source</h2>
        <p className="mt-2 text-sm text-slate-700">
          {transaction.referralSource?.name ?? <span className="text-slate-400">Unknown — reportable as such (§7, §9)</span>}
        </p>
      </section>

      <section className="rounded-lg border border-slate-200 bg-white p-4">
        <h2 className="text-sm font-semibold text-slate-900">Realtors on this transaction</h2>
        <ul className="mt-2 space-y-1 text-sm">
          {transaction.participants.map((p) => (
            <li key={p.id} className="flex items-center justify-between rounded-md bg-slate-50 px-3 py-2">
              <span className="text-slate-800">
                {p.realtor ? `${p.realtor.firstName} ${p.realtor.lastName}` : "Unknown"}
                {p.realtor?.brokerage ? ` — ${p.realtor.brokerage.name}` : ""}
              </span>
              <span className="font-mono text-[11px] text-slate-500">{p.role}</span>
            </li>
          ))}
          {transaction.participants.length === 0 && <p className="text-sm text-slate-400">None associated yet.</p>}
        </ul>
        <form action={addParticipantAction} className="mt-3 flex gap-2">
          <select name="realtorId" required className="flex-1 rounded-md border border-slate-300 px-2 py-1.5 text-sm">
            <option value="" disabled selected>
              Select a realtor
            </option>
            {realtors.map((r) => (
              <option key={r.id} value={r.id}>
                {r.firstName} {r.lastName}
              </option>
            ))}
          </select>
          <select name="role" required className="rounded-md border border-slate-300 px-2 py-1.5 text-sm">
            <option value="BUYERS_AGENT">Buyer&apos;s agent</option>
            <option value="LISTING_AGENT">Listing agent</option>
            <option value="OTHER">Other</option>
          </select>
          <button type="submit" className="rounded-md bg-slate-900 px-3 py-1.5 text-sm font-medium text-white hover:bg-slate-800">
            Add
          </button>
        </form>
      </section>

      <section className="rounded-lg border border-amber-200 bg-amber-50 p-4 text-sm text-amber-900">
        Scheduling an Inspection and building the Inspection Report are Phase 2–3 — not part of this
        foundation pass. This transaction record is ready for them once built.
      </section>
    </div>
  );
}
