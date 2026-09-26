import Link from "next/link";
import { notFound } from "next/navigation";
import type { Role } from "@prisma/client";
import { prisma } from "@/lib/prisma";
import { auth } from "@/lib/auth";
import { can } from "@/lib/rbac";
import { formatShortDate } from "@/lib/dates";
import { formatCurrency, realtorDisplayName } from "@/lib/realtors/display";
import { getRealtorMetrics } from "@/lib/realtors/metrics";
import { loadRealtorAnalytics } from "@/lib/realtors/record";
import { Card, Empty, Metric } from "../_components/ui";

// Deeper, derived numbers kept off the everyday record. Every figure is a
// deterministic database aggregate; referral and associated values are
// always reported side by side but never combined.
export default async function RealtorAnalyticsPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const session = await auth();
  const includeFinancials = can(session?.user?.role as Role | undefined, "financial:read");

  const realtor = await prisma.realtor.findFirst({ where: { id, archivedAt: null } });
  if (!realtor) notFound();

  const [metrics, analytics] = await Promise.all([
    getRealtorMetrics(id, { includeFinancials }),
    loadRealtorAnalytics(id, { includeFinancials }),
  ]);
  const peak = Math.max(1, ...analytics.referralsByMonth.map((m) => m.count));

  return (
    <div className="max-w-5xl space-y-6">
      <div>
        <Link href={`/realtors/${id}`} className="text-xs text-slate-500 hover:underline">
          ← Back to {realtorDisplayName(realtor)}
        </Link>
        <h1 className="mt-2 text-2xl font-semibold text-slate-900">Relationship analytics</h1>
        <p className="mt-1 text-sm text-slate-500">{realtorDisplayName(realtor)}</p>
      </div>

      <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
        <Card title="As a referral source">
          <p className="-mt-1 mb-4 text-xs text-slate-500">Transactions whose recorded referral source is this realtor.</p>
          <dl className="grid grid-cols-2 gap-4">
            <Metric label="Referrals" value={String(metrics.referrals)} />
            <Metric label="Completed inspections" value={String(analytics.completedReferralInspections)} />
            <Metric label="Customers referred" value={String(metrics.customersReferred)} />
            {includeFinancials && <Metric label="Referral revenue" value={formatCurrency(metrics.referralRevenue)} />}
          </dl>
        </Card>
        <Card title="As an associated realtor">
          <p className="-mt-1 mb-4 text-xs text-slate-500">Transactions they had a role on, whether or not they referred them.</p>
          <dl className="grid grid-cols-2 gap-4">
            <Metric label="Associated transactions" value={String(metrics.associatedTransactions)} />
            {includeFinancials && <Metric label="Associated revenue" value={formatCurrency(metrics.associatedRevenue)} />}
            {includeFinancials && (
              <Metric
                label="Average inspection value"
                value={analytics.averageInspectionValue ? formatCurrency(analytics.averageInspectionValue) : "—"}
                hint={analytics.averageInspectionValue ? "Completed inspections, by service price" : "No priced, completed inspections yet"}
              />
            )}
          </dl>
        </Card>
      </div>

      {includeFinancials && (
        <p className="text-xs text-slate-500">
          Revenue is billed revenue: invoice line items on invoices that have been sent, paid, or are overdue (drafts and voided invoices
          are excluded). A deal they both worked and referred counts toward both figures.
        </p>
      )}

      <Card title="Referrals over the last 12 months">
        {metrics.referrals === 0 ? (
          <Empty>No referrals recorded.</Empty>
        ) : (
          <table className="w-full text-sm">
            <caption className="sr-only">Referred transactions per month</caption>
            <thead className="sr-only">
              <tr>
                <th scope="col">Month</th>
                <th scope="col">Referrals</th>
              </tr>
            </thead>
            <tbody>
              {analytics.referralsByMonth.map((m) => (
                <tr key={m.month}>
                  <th scope="row" className="w-16 py-1 pr-3 text-left text-xs font-normal text-slate-500">
                    {m.label}
                  </th>
                  <td className="py-1">
                    <div className="flex items-center gap-2">
                      <div className="h-3 rounded-sm bg-slate-700" style={{ width: `${(m.count / peak) * 100}%`, minWidth: m.count ? "4px" : 0 }} aria-hidden="true" />
                      <span className="text-xs tabular-nums text-slate-600">{m.count}</span>
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </Card>

      <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
        <Card title="Services on referred transactions">
          {analytics.servicesOnReferred.length === 0 ? (
            <Empty>No services recorded on referred transactions.</Empty>
          ) : (
            <table className="w-full text-sm">
              <thead className="text-left text-xs text-slate-500">
                <tr>
                  <th scope="col" className="pb-2 font-medium">Service</th>
                  <th scope="col" className="pb-2 text-right font-medium">Count</th>
                  {includeFinancials && <th scope="col" className="pb-2 text-right font-medium">Priced at</th>}
                </tr>
              </thead>
              <tbody>
                {analytics.servicesOnReferred.map((s) => (
                  <tr key={s.name} className="border-t border-slate-100">
                    <td className="py-1.5 text-slate-800">{s.name}</td>
                    <td className="py-1.5 text-right tabular-nums text-slate-700">{s.count}</td>
                    {includeFinancials && <td className="py-1.5 text-right tabular-nums text-slate-700">{formatCurrency(s.total)}</td>}
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </Card>

        <Card title="Recently referred customers">
          {analytics.recentReferredCustomers.length === 0 ? (
            <Empty>No referred customers yet.</Empty>
          ) : (
            <ul className="divide-y divide-slate-100">
              {analytics.recentReferredCustomers.map((c) => (
                <li key={c.id} className="flex justify-between gap-3 py-2 text-sm first:pt-0 last:pb-0">
                  <div className="min-w-0">
                    <Link href={`/customers/${c.customerId}`} className="font-medium text-slate-900 hover:underline">
                      {c.name}
                    </Link>
                    <p className="truncate text-xs text-slate-500">{c.property ?? "No property yet"}</p>
                  </div>
                  <Link href={`/transactions/${c.transactionId}`} className="shrink-0 text-xs tabular-nums text-slate-500 hover:underline">
                    {formatShortDate(c.date)}
                  </Link>
                </li>
              ))}
            </ul>
          )}
        </Card>
      </div>
    </div>
  );
}
