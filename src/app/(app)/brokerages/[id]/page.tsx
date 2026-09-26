import Link from "next/link";
import { notFound } from "next/navigation";
import { prisma } from "@/lib/prisma";
import { formatShortDate } from "@/lib/dates";
import { formatPhone } from "@/lib/phone";
import { realtorDisplayName } from "@/lib/realtors/display";

// The brokerage as a relationship: who's there now, and who was there
// before (from RealtorBrokerageHistory, which is never rewritten).
export default async function BrokerageDetailPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const brokerage = await prisma.brokerage.findUnique({
    where: { id },
    include: {
      realtors: {
        where: { archivedAt: null },
        orderBy: [{ lastName: "asc" }, { firstName: "asc" }],
        select: { id: true, firstName: true, lastName: true, preferredName: true, phone: true, email: true },
      },
      history: {
        where: { endDate: { not: null } },
        orderBy: { endDate: "desc" },
        take: 50,
        include: { realtor: { select: { id: true, firstName: true, lastName: true, preferredName: true, brokerageId: true } } },
      },
    },
  });
  if (!brokerage) notFound();

  const address = [brokerage.addressLine1, [brokerage.city, brokerage.state].filter(Boolean).join(", "), brokerage.zip].filter(Boolean).join(" · ");
  // Someone who left and came back is a current realtor, not a former one.
  const former = brokerage.history.filter((h) => h.realtor.brokerageId !== brokerage.id);

  return (
    <div className="max-w-3xl space-y-6">
      <div>
        <Link href="/brokerages" className="text-xs text-slate-500 hover:underline">
          ← Back to brokerages
        </Link>
        <h1 className="mt-2 text-2xl font-semibold text-slate-900">{brokerage.name}</h1>
        <p className="mt-1 text-sm text-slate-600">
          {[brokerage.phone && formatPhone(brokerage.phone), brokerage.email, address].filter(Boolean).join(" · ") || (
            <span className="text-slate-400">No contact details on file</span>
          )}
        </p>
        {brokerage.archivedAt && <p className="mt-1 text-xs text-amber-700">This brokerage is archived.</p>}
      </div>

      <section aria-labelledby="current-realtors" className="rounded-lg border border-slate-200 bg-white p-5">
        <h2 id="current-realtors" className="text-sm font-semibold text-slate-900">
          Realtors <span className="font-normal text-slate-500">{brokerage.realtors.length}</span>
        </h2>
        {brokerage.realtors.length > 0 ? (
          <ul className="mt-3 divide-y divide-slate-100">
            {brokerage.realtors.map((r) => (
              <li key={r.id} className="flex flex-wrap items-center justify-between gap-2 py-2 text-sm">
                <Link href={`/realtors/${r.id}`} className="font-medium text-slate-900 hover:underline">
                  {realtorDisplayName(r)}
                </Link>
                <span className="text-xs text-slate-500">
                  {[r.phone && formatPhone(r.phone), r.email].filter(Boolean).join(" · ")}
                </span>
              </li>
            ))}
          </ul>
        ) : (
          <p className="mt-2 text-sm text-slate-500">No current realtors.</p>
        )}
      </section>

      {former.length > 0 && (
        <section aria-labelledby="former-realtors" className="rounded-lg border border-slate-200 bg-white p-5">
          <h2 id="former-realtors" className="text-sm font-semibold text-slate-900">
            Former realtors
          </h2>
          <ul className="mt-3 divide-y divide-slate-100">
            {former.map((h) => (
              <li key={h.id} className="flex flex-wrap items-center justify-between gap-2 py-2 text-sm">
                <Link href={`/realtors/${h.realtor.id}`} className="text-slate-800 hover:underline">
                  {realtorDisplayName(h.realtor)}
                </Link>
                <span className="text-xs tabular-nums text-slate-500">
                  {formatShortDate(h.startDate)} – {formatShortDate(h.endDate)}
                </span>
              </li>
            ))}
          </ul>
        </section>
      )}
    </div>
  );
}
