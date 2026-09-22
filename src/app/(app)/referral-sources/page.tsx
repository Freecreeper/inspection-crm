import { prisma } from "@/lib/prisma";
import { createReferralSource, toggleReferralSourceActive } from "./actions";

export default async function ReferralSourcesPage() {
  const sources = await prisma.referralSource.findMany({
    orderBy: { name: "asc" },
    include: { _count: { select: { leads: true, transactions: true } } },
  });

  return (
    <div>
      <h1 className="text-xl font-semibold text-slate-900">Referral sources</h1>
      <p className="mt-1 text-sm text-slate-500">
        The relationship network behind lead and transaction attribution. Deactivating a source keeps
        its history intact — every past lead and transaction still reports against it.
      </p>

      <div className="mt-6 grid grid-cols-1 gap-6 lg:grid-cols-3">
        <div className="lg:col-span-2">
          <div className="overflow-hidden rounded-lg border border-slate-200 bg-white">
            <table className="w-full text-sm">
              <thead className="bg-slate-50 text-left text-xs uppercase tracking-wide text-slate-500">
                <tr>
                  <th className="px-4 py-2 font-medium">Name</th>
                  <th className="px-4 py-2 font-medium">Type</th>
                  <th className="px-4 py-2 font-medium">Leads</th>
                  <th className="px-4 py-2 font-medium">Transactions</th>
                  <th className="px-4 py-2 font-medium">Status</th>
                  <th className="px-4 py-2 font-medium" />
                </tr>
              </thead>
              <tbody>
                {sources.map((s) => {
                  const toggleAction = toggleReferralSourceActive.bind(null, s.id);
                  return (
                    <tr key={s.id} className="border-t border-slate-100">
                      <td className="px-4 py-2 font-medium text-slate-900">{s.name}</td>
                      <td className="px-4 py-2 text-slate-600">{s.type}</td>
                      <td className="px-4 py-2 tabular-nums text-slate-600">{s._count.leads}</td>
                      <td className="px-4 py-2 tabular-nums text-slate-600">{s._count.transactions}</td>
                      <td className="px-4 py-2">
                        <span
                          className={`rounded-full px-2 py-0.5 font-mono text-[11px] ${
                            s.active ? "bg-emerald-100 text-emerald-700" : "bg-slate-100 text-slate-500"
                          }`}
                        >
                          {s.active ? "ACTIVE" : "INACTIVE"}
                        </span>
                      </td>
                      <td className="px-4 py-2 text-right">
                        <form action={toggleAction}>
                          <input type="hidden" name="nextActive" value={(!s.active).toString()} />
                          <button type="submit" className="text-xs text-blue-700 hover:underline">
                            {s.active ? "Deactivate" : "Reactivate"}
                          </button>
                        </form>
                      </td>
                    </tr>
                  );
                })}
                {sources.length === 0 && (
                  <tr>
                    <td colSpan={6} className="px-4 py-6 text-center text-slate-400">
                      No referral sources yet.
                    </td>
                  </tr>
                )}
              </tbody>
            </table>
          </div>
        </div>

        <div className="rounded-lg border border-slate-200 bg-white p-4">
          <h2 className="text-sm font-semibold text-slate-900">New referral source</h2>
          <form action={createReferralSource} className="mt-3 space-y-3">
            <input name="name" placeholder="Name" required className="w-full rounded-md border border-slate-300 px-2 py-1.5 text-sm" />
            <input name="type" placeholder="Type (e.g. Realtor, Past Customer, Online)" required className="w-full rounded-md border border-slate-300 px-2 py-1.5 text-sm" />
            <button type="submit" className="w-full rounded-md bg-slate-900 px-3 py-1.5 text-sm font-medium text-white hover:bg-slate-800">
              Add referral source
            </button>
          </form>
        </div>
      </div>
    </div>
  );
}
