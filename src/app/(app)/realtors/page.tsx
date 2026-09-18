import { prisma } from "@/lib/prisma";
import { createRealtor } from "./actions";

export default async function RealtorsPage() {
  const [realtors, brokerages] = await Promise.all([
    prisma.realtor.findMany({
      where: { archivedAt: null },
      orderBy: { lastName: "asc" },
      include: { brokerage: true },
    }),
    prisma.brokerage.findMany({ where: { archivedAt: null }, orderBy: { name: "asc" } }),
  ]);

  return (
    <div>
      <h1 className="text-xl font-semibold text-slate-900">Realtors</h1>
      <div className="mt-6 grid grid-cols-1 gap-6 lg:grid-cols-3">
        <div className="lg:col-span-2">
          <div className="overflow-hidden rounded-lg border border-slate-200 bg-white">
            <table className="w-full text-sm">
              <thead className="bg-slate-50 text-left text-xs uppercase tracking-wide text-slate-500">
                <tr>
                  <th className="px-4 py-2 font-medium">Name</th>
                  <th className="px-4 py-2 font-medium">Brokerage</th>
                  <th className="px-4 py-2 font-medium">Contact</th>
                </tr>
              </thead>
              <tbody>
                {realtors.map((r) => (
                  <tr key={r.id} className="border-t border-slate-100">
                    <td className="px-4 py-2 font-medium text-slate-900">
                      {r.firstName} {r.lastName}
                    </td>
                    <td className="px-4 py-2 text-slate-600">
                      {r.brokerage?.name || <span className="text-slate-400">Not provided</span>}
                    </td>
                    <td className="px-4 py-2 text-slate-600">
                      {r.email || r.phone || <span className="text-slate-400">Not provided</span>}
                    </td>
                  </tr>
                ))}
                {realtors.length === 0 && (
                  <tr>
                    <td colSpan={3} className="px-4 py-6 text-center text-slate-400">
                      No realtors yet.
                    </td>
                  </tr>
                )}
              </tbody>
            </table>
          </div>
        </div>
        <div className="rounded-lg border border-slate-200 bg-white p-4">
          <h2 className="text-sm font-semibold text-slate-900">New realtor</h2>
          <form action={createRealtor} className="mt-3 space-y-3">
            <div className="grid grid-cols-2 gap-2">
              <input name="firstName" placeholder="First name" required className="rounded-md border border-slate-300 px-2 py-1.5 text-sm" />
              <input name="lastName" placeholder="Last name" required className="rounded-md border border-slate-300 px-2 py-1.5 text-sm" />
            </div>
            <input name="email" type="email" placeholder="Email (optional)" className="w-full rounded-md border border-slate-300 px-2 py-1.5 text-sm" />
            <input name="phone" placeholder="Phone (optional)" className="w-full rounded-md border border-slate-300 px-2 py-1.5 text-sm" />
            <select name="brokerageId" className="w-full rounded-md border border-slate-300 px-2 py-1.5 text-sm text-slate-700">
              <option value="">No brokerage (optional)</option>
              {brokerages.map((b) => (
                <option key={b.id} value={b.id}>
                  {b.name}
                </option>
              ))}
            </select>
            <button type="submit" className="w-full rounded-md bg-slate-900 px-3 py-1.5 text-sm font-medium text-white hover:bg-slate-800">
              Add realtor
            </button>
          </form>
        </div>
      </div>
    </div>
  );
}
