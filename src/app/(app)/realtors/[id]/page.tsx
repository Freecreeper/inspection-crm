import Link from "next/link";
import { notFound } from "next/navigation";
import { prisma } from "@/lib/prisma";
import { changeRealtorBrokerage } from "../actions";

export default async function RealtorDetailPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const [realtor, brokerages] = await Promise.all([
    prisma.realtor.findUnique({
      where: { id },
      include: {
        brokerage: true,
        history: { include: { brokerage: true }, orderBy: { startDate: "desc" } },
        participations: {
          include: { transaction: { include: { customer: true } } },
          orderBy: { createdAt: "desc" },
          take: 20,
        },
      },
    }),
    prisma.brokerage.findMany({ where: { archivedAt: null }, orderBy: { name: "asc" } }),
  ]);
  if (!realtor) notFound();

  const changeBrokerageAction = changeRealtorBrokerage.bind(null, realtor.id);

  return (
    <div className="max-w-2xl space-y-6">
      <div>
        <h1 className="text-xl font-semibold text-slate-900">
          {realtor.firstName} {realtor.lastName}
        </h1>
        <p className="mt-1 text-sm text-slate-500">
          {realtor.email || <span className="text-slate-400">No email</span>} ·{" "}
          {realtor.phone || <span className="text-slate-400">No phone</span>}
        </p>
      </div>

      <section className="rounded-lg border border-slate-200 bg-white p-4">
        <h2 className="text-sm font-semibold text-slate-900">Current brokerage</h2>
        <p className="mt-2 text-sm text-slate-700">
          {realtor.brokerage?.name || <span className="text-slate-400">Not set</span>}
        </p>
        <form action={changeBrokerageAction} className="mt-3 flex gap-2">
          <select name="brokerageId" required className="flex-1 rounded-md border border-slate-300 px-2 py-1.5 text-sm">
            <option value="" disabled selected>
              Select a brokerage
            </option>
            {brokerages.map((b) => (
              <option key={b.id} value={b.id}>
                {b.name}
              </option>
            ))}
          </select>
          <button type="submit" className="rounded-md bg-slate-900 px-3 py-1.5 text-sm font-medium text-white hover:bg-slate-800">
            {realtor.brokerage ? "Move" : "Set"}
          </button>
        </form>
        <p className="mt-2 text-xs text-slate-500">
          Moving a realtor closes their current brokerage history entry and opens a new one — past
          transactions keep showing the brokerage that was current at the time.
        </p>
      </section>

      <section className="rounded-lg border border-slate-200 bg-white p-4">
        <h2 className="text-sm font-semibold text-slate-900">Brokerage history</h2>
        <ul className="mt-2 space-y-1 text-sm">
          {realtor.history.map((h) => (
            <li key={h.id} className="flex items-center justify-between rounded-md bg-slate-50 px-3 py-2">
              <span className="text-slate-800">{h.brokerage.name}</span>
              <span className="text-xs text-slate-500">
                {h.startDate.toLocaleDateString()} – {h.endDate ? h.endDate.toLocaleDateString() : "present"}
              </span>
            </li>
          ))}
          {realtor.history.length === 0 && <p className="text-sm text-slate-400">No history recorded yet.</p>}
        </ul>
      </section>

      <section className="rounded-lg border border-slate-200 bg-white p-4">
        <h2 className="text-sm font-semibold text-slate-900">Transactions</h2>
        <ul className="mt-2 space-y-1 text-sm">
          {realtor.participations.map((p) => (
            <li key={p.id} className="flex items-center justify-between rounded-md bg-slate-50 px-3 py-2">
              <Link href={`/transactions/${p.transaction.id}`} className="text-slate-800 hover:underline">
                {p.transaction.customer.firstName} {p.transaction.customer.lastName}
              </Link>
              <span className="font-mono text-[11px] text-slate-500">{p.role}</span>
            </li>
          ))}
          {realtor.participations.length === 0 && <p className="text-sm text-slate-400">No transactions yet.</p>}
        </ul>
      </section>
    </div>
  );
}
