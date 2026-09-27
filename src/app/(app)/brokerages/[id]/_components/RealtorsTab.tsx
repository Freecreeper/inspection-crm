import Link from "next/link";
import { formatShortDate } from "@/lib/dates";
import { formatPhone } from "@/lib/phone";
import { loadBrokerageRealtors } from "@/lib/brokerages/record";

// Who's here now, and who was here before (from RealtorBrokerageHistory,
// which is never rewritten).
export async function RealtorsTab({ brokerageId }: { brokerageId: string }) {
  const { current, former } = await loadBrokerageRealtors(brokerageId);
  const none = <span className="text-slate-400">—</span>;

  return (
    <div className="space-y-8">
      <section aria-labelledby="current-realtors">
        <h2 id="current-realtors" className="mb-3 text-sm font-semibold text-slate-900">
          Current realtors <span className="font-normal text-slate-500">{current.length}</span>
        </h2>
        {current.length === 0 ? (
          <p className="rounded-lg border border-slate-200 bg-white p-8 text-center text-sm text-slate-500">No current realtors.</p>
        ) : (
          <div className="overflow-x-auto rounded-lg border border-slate-200 bg-white">
            <table className="w-full min-w-[640px] text-sm">
              <thead className="border-b border-slate-200 text-left text-xs uppercase tracking-wide text-slate-500">
                <tr>
                  <th scope="col" className="px-3 py-2.5 font-medium">Realtor</th>
                  <th scope="col" className="px-3 py-2.5 font-medium">Phone</th>
                  <th scope="col" className="px-3 py-2.5 font-medium">Email</th>
                  <th scope="col" className="px-3 py-2.5 text-right font-medium">Transactions here</th>
                  <th scope="col" className="px-3 py-2.5 font-medium">Since</th>
                </tr>
              </thead>
              <tbody>
                {current.map((r) => (
                  <tr key={r.id} className="border-t border-slate-100 first:border-t-0">
                    <td className="px-3 py-2.5">
                      <Link href={`/realtors/${r.id}`} className="font-medium text-slate-900 hover:underline">
                        {r.name}
                      </Link>
                    </td>
                    <td className="px-3 py-2.5 tabular-nums text-slate-600">{r.phone ? formatPhone(r.phone) : none}</td>
                    <td className="px-3 py-2.5 text-slate-600">{r.email ?? none}</td>
                    <td className="px-3 py-2.5 text-right tabular-nums text-slate-700">{r.transactions}</td>
                    <td className="px-3 py-2.5 tabular-nums text-slate-600">{r.since ? formatShortDate(r.since) : none}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </section>

      <section aria-labelledby="former-realtors">
        <h2 id="former-realtors" className="mb-3 text-sm font-semibold text-slate-900">
          Former realtors <span className="font-normal text-slate-500">{former.length}</span>
        </h2>
        {former.length === 0 ? (
          <p className="rounded-lg border border-slate-200 bg-white p-8 text-center text-sm text-slate-500">No former realtors on record.</p>
        ) : (
          <div className="overflow-x-auto rounded-lg border border-slate-200 bg-white">
            <table className="w-full min-w-[560px] text-sm">
              <thead className="border-b border-slate-200 text-left text-xs uppercase tracking-wide text-slate-500">
                <tr>
                  <th scope="col" className="px-3 py-2.5 font-medium">Realtor</th>
                  <th scope="col" className="px-3 py-2.5 font-medium">Here</th>
                  <th scope="col" className="px-3 py-2.5 font-medium">Now at</th>
                </tr>
              </thead>
              <tbody>
                {former.map((h) => (
                  <tr key={h.historyId} className="border-t border-slate-100 first:border-t-0">
                    <td className="px-3 py-2.5">
                      <Link href={`/realtors/${h.id}`} className="text-slate-800 hover:underline">
                        {h.name}
                      </Link>
                    </td>
                    <td className="px-3 py-2.5 tabular-nums text-slate-600">
                      {formatShortDate(h.startDate)} – {formatShortDate(h.endDate)}
                    </td>
                    <td className="px-3 py-2.5 text-slate-600">
                      {h.nowAt ? (
                        <Link href={`/brokerages/${h.nowAt.id}`} className="hover:text-slate-900 hover:underline">
                          {h.nowAt.name}
                        </Link>
                      ) : (
                        <span className="text-slate-400">No brokerage</span>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </section>
    </div>
  );
}
