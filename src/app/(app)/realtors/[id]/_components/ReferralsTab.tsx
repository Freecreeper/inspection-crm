import Link from "next/link";
import { prisma } from "@/lib/prisma";
import { formatShortDate } from "@/lib/dates";
import { formatCurrency } from "@/lib/realtors/display";
import { getRealtorMetrics } from "@/lib/realtors/metrics";
import { countCompletedReferralInspections, loadReferredTransactions } from "@/lib/realtors/record";
import { ReferralSourceLinker } from "./RecordClient";
import { Card, Empty, Metric, humanStatus, type RecordPermissions } from "./ui";

const MAX_ROWS = 200;

// Referral attribution comes only from a transaction's recorded referral
// source being linked to this realtor. Deals they merely worked on are on
// the Transactions tab and are deliberately not counted here.
export async function ReferralsTab({ realtorId, permissions }: { realtorId: string; permissions: RecordPermissions }) {
  const [sources, metrics, completedInspections, rows, unlinked] = await Promise.all([
    prisma.referralSource.findMany({ where: { realtorId }, orderBy: { createdAt: "asc" } }),
    getRealtorMetrics(realtorId, { includeFinancials: permissions.canViewFinancials }),
    countCompletedReferralInspections(realtorId),
    loadReferredTransactions(realtorId, { take: MAX_ROWS, includeFinancials: permissions.canViewFinancials }),
    permissions.canWrite
      ? prisma.referralSource.findMany({ where: { realtorId: null, active: true }, orderBy: { name: "asc" }, select: { id: true, name: true, type: true } })
      : Promise.resolve([]),
  ]);

  return (
    <div className="space-y-6">
      <dl className="grid grid-cols-2 gap-4 sm:grid-cols-4">
        <Metric label="Referrals" value={String(metrics.referrals)} />
        <Metric label="Customers referred" value={String(metrics.customersReferred)} />
        <Metric label="Completed inspections" value={String(completedInspections)} />
        {permissions.canViewFinancials && (
          <Metric label="Referral revenue" value={formatCurrency(metrics.referralRevenue)} hint="Billed on deals they referred" />
        )}
      </dl>

      <Card title="Referral source">
        {sources.length > 0 ? (
          <p className="text-sm text-slate-700">
            Referrals are counted when a transaction&apos;s referral source is{" "}
            {sources.map((s, i) => (
              <span key={s.id}>
                {i > 0 && (i === sources.length - 1 ? " or " : ", ")}
                <span className="font-medium text-slate-900">{s.name}</span>
                {!s.active && <span className="text-slate-500"> (inactive)</span>}
              </span>
            ))}
            .
          </p>
        ) : (
          <div className="space-y-3">
            <Empty>
              No referral source is linked to this realtor yet, so no business can be attributed to them as a referral. Being on a
              transaction doesn&apos;t count as referring it.
            </Empty>
            {permissions.canWrite && (
              <ReferralSourceLinker realtorId={realtorId} unlinkedSources={unlinked.map((s) => ({ id: s.id, label: s.name, sublabel: s.type }))} />
            )}
          </div>
        )}
      </Card>

      {rows.length > 0 ? (
        <div className="overflow-x-auto rounded-lg border border-slate-200 bg-white">
          <table className="w-full min-w-[680px] text-sm">
            <caption className="sr-only">Transactions referred by this realtor</caption>
            <thead className="border-b border-slate-200 text-left text-xs uppercase tracking-wide text-slate-500">
              <tr>
                <th scope="col" className="px-3 py-2.5 font-medium">Customer</th>
                <th scope="col" className="px-3 py-2.5 font-medium">Property</th>
                <th scope="col" className="px-3 py-2.5 font-medium">Transaction</th>
                <th scope="col" className="px-3 py-2.5 font-medium">Inspection</th>
                <th scope="col" className="px-3 py-2.5 font-medium">Referred</th>
                {permissions.canViewFinancials && <th scope="col" className="px-3 py-2.5 text-right font-medium">Revenue</th>}
              </tr>
            </thead>
            <tbody>
              {rows.map((t) => (
                <tr key={t.id} className="border-t border-slate-100 first:border-t-0">
                  <td className="px-3 py-2.5 font-medium text-slate-900">{t.customers.length ? t.customers.join(", ") : <span className="font-normal text-slate-400">Not yet recorded</span>}</td>
                  <td className="px-3 py-2.5 text-slate-600">{t.property ?? <span className="text-slate-400">No property yet</span>}</td>
                  <td className="px-3 py-2.5">
                    <Link href={`/transactions/${t.id}`} className="text-slate-700 hover:underline">
                      {humanStatus(t.status)}
                    </Link>
                  </td>
                  <td className="px-3 py-2.5 text-slate-600">
                    {t.inspectionStatus ? `${humanStatus(t.inspectionStatus)}${t.inspectionDate ? ` · ${formatShortDate(t.inspectionDate)}` : ""}` : <span className="text-slate-400">None</span>}
                  </td>
                  <td className="px-3 py-2.5 tabular-nums text-slate-600">{formatShortDate(t.createdAt)}</td>
                  {permissions.canViewFinancials && <td className="px-3 py-2.5 text-right tabular-nums text-slate-700">{formatCurrency(t.revenue)}</td>}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      ) : (
        sources.length > 0 && <p className="rounded-lg border border-slate-200 bg-white p-8 text-center text-sm text-slate-500">No referred business recorded yet.</p>
      )}
    </div>
  );
}
