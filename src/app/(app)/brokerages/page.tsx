import Link from "next/link";
import { prisma } from "@/lib/prisma";
import { formatPhone } from "@/lib/phone";
import { createBrokerage } from "./actions";

export default async function BrokeragesPage() {
  const brokerages = await prisma.brokerage.findMany({
    where: { archivedAt: null },
    orderBy: { name: "asc" },
  });
  const notProvided = <span className="text-slate-400">Not provided</span>;

  return (
    <div>
      <h1 className="text-xl font-semibold text-slate-900">Brokerages</h1>
      <div className="mt-6 grid grid-cols-1 gap-6 lg:grid-cols-3">
        <div className="lg:col-span-2">
          <div className="overflow-x-auto rounded-lg border border-slate-200 bg-white">
            <table className="w-full min-w-[40rem] text-sm">
              <thead className="bg-slate-50 text-left text-xs uppercase tracking-wide text-slate-500">
                <tr>
                  <th className="px-4 py-2 font-medium">Name</th>
                  <th className="px-4 py-2 font-medium">Phone</th>
                  <th className="px-4 py-2 font-medium">Email</th>
                  <th className="px-4 py-2 font-medium">Address</th>
                </tr>
              </thead>
              <tbody>
                {brokerages.map((b) => (
                  <tr key={b.id} className="border-t border-slate-100">
                    <td className="px-4 py-2 font-medium text-slate-900">
                      <Link href={`/brokerages/${b.id}`} className="hover:underline">
                        {b.name}
                      </Link>
                    </td>
                    <td className="whitespace-nowrap px-4 py-2 tabular-nums text-slate-600">{formatPhone(b.phone) || notProvided}</td>
                    <td className="whitespace-nowrap px-4 py-2 text-slate-600">{b.email || notProvided}</td>
                    <td className="min-w-[12rem] px-4 py-2 text-slate-600">{formatAddress(b) || notProvided}</td>
                  </tr>
                ))}
                {brokerages.length === 0 && (
                  <tr>
                    <td colSpan={4} className="px-4 py-6 text-center text-slate-400">
                      No brokerages yet.
                    </td>
                  </tr>
                )}
              </tbody>
            </table>
          </div>
        </div>
        <div className="rounded-lg border border-slate-200 bg-white p-4">
          <h2 className="text-sm font-semibold text-slate-900">New brokerage</h2>
          <form action={createBrokerage} className="mt-3 space-y-3">
            <input name="name" placeholder="Brokerage name" required className="w-full rounded-md border border-slate-300 px-2 py-1.5 text-sm" />
            <input name="phone" placeholder="Phone (optional)" className="w-full rounded-md border border-slate-300 px-2 py-1.5 text-sm" />
            <input name="email" type="email" placeholder="Email (optional)" className="w-full rounded-md border border-slate-300 px-2 py-1.5 text-sm" />
            <input name="addressLine1" placeholder="Street address (optional)" className="w-full rounded-md border border-slate-300 px-2 py-1.5 text-sm" />
            <div className="grid grid-cols-[minmax(0,1fr)_4.5rem_5.5rem] gap-2">
              <input name="city" placeholder="City" aria-label="City (optional)" className="min-w-0 rounded-md border border-slate-300 px-2 py-1.5 text-sm" />
              <input name="state" placeholder="State" aria-label="State (optional)" maxLength={2} className="min-w-0 rounded-md border border-slate-300 px-2 py-1.5 text-sm uppercase" />
              <input name="zip" placeholder="ZIP" aria-label="ZIP (optional)" inputMode="numeric" className="min-w-0 rounded-md border border-slate-300 px-2 py-1.5 text-sm" />
            </div>
            <button type="submit" className="w-full rounded-md bg-slate-900 px-3 py-1.5 text-sm font-medium text-white hover:bg-slate-800">
              Add brokerage
            </button>
          </form>
        </div>
      </div>
    </div>
  );
}

// "123 Main St, Hickory, NC 28601" — skipping whatever parts aren't on file.
function formatAddress(b: { addressLine1: string | null; city: string | null; state: string | null; zip: string | null }): string {
  const stateZip = [b.state, b.zip].filter(Boolean).join(" ");
  return [b.addressLine1, b.city, stateZip].filter(Boolean).join(", ");
}
