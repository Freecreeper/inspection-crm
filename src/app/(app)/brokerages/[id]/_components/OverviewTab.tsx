import Link from "next/link";
import type { Brokerage } from "@prisma/client";
import { formatShortDate } from "@/lib/dates";
import { formatPhone } from "@/lib/phone";
import { formatCurrency } from "@/lib/realtors/display";
import { getBrokerageMetrics, loadBrokerageRealtors, loadBrokerageTimeline, loadBrokerageTransactions } from "@/lib/brokerages/record";
import { Card, Empty, Metric } from "../../../realtors/[id]/_components/ui";
import { BrokerageContactFields } from "../../_components/BrokerageShared";

const PREVIEW = 5;

// A summary, not the whole record: a few metrics, then focused cards that
// each link onward to the tab holding the full detail.
export async function OverviewTab({ brokerage, permissions }: { brokerage: Brokerage; permissions: { canWrite: boolean; canViewFinancials: boolean } }) {
  const [metrics, realtors, recentTransactions, recentActivity] = await Promise.all([
    getBrokerageMetrics(brokerage.id, { includeFinancials: permissions.canViewFinancials }),
    loadBrokerageRealtors(brokerage.id, { take: PREVIEW }),
    loadBrokerageTransactions(brokerage.id, { take: PREVIEW, includeFinancials: permissions.canViewFinancials }),
    loadBrokerageTimeline(brokerage.id, { limit: PREVIEW }),
  ]);
  const tab = (key: string) => `/brokerages/${brokerage.id}?tab=${key}`;

  return (
    <div className="space-y-6">
      <dl className="grid grid-cols-2 gap-4 sm:grid-cols-4">
        <Metric label="Current realtors" value={String(metrics.currentRealtors)} />
        <Metric label="Former realtors" value={String(metrics.formerRealtors)} />
        <Metric label="Transactions" value={String(metrics.transactions)} hint="Worked while at this brokerage" />
        {permissions.canViewFinancials && metrics.associatedRevenue !== null && (
          <Metric label="Associated revenue" value={formatCurrency(metrics.associatedRevenue)} hint="Billed on those deals" />
        )}
      </dl>

      <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
        <Card title="Contact">
          <BrokerageContactFields brokerageId={brokerage.id} values={brokerage} canEdit={permissions.canWrite} includeName />
        </Card>

        <Card title="Realtors" action={metrics.currentRealtors > 0 ? { href: tab("realtors"), label: "View all →" } : undefined}>
          {realtors.current.length > 0 ? (
            <ul className="divide-y divide-slate-100">
              {realtors.current.map((r) => (
                <li key={r.id} className="flex items-start justify-between gap-4 py-2.5 text-sm first:pt-0 last:pb-0">
                  <div className="min-w-0">
                    <Link href={`/realtors/${r.id}`} className="font-medium text-slate-900 hover:underline">
                      {r.name}
                    </Link>
                    {(r.phone || r.email) && (
                      <p className="truncate text-xs text-slate-500">{[r.phone ? formatPhone(r.phone) : null, r.email].filter(Boolean).join(" · ")}</p>
                    )}
                  </div>
                  <span className="shrink-0 text-xs tabular-nums text-slate-500">
                    {r.transactions} transaction{r.transactions === 1 ? "" : "s"}
                  </span>
                </li>
              ))}
            </ul>
          ) : (
            <Empty>No current realtors.</Empty>
          )}
          {metrics.currentRealtors > realtors.current.length && (
            <p className="mt-2 text-xs text-slate-500">
              Showing {realtors.current.length} of {metrics.currentRealtors}.
            </p>
          )}
        </Card>
      </div>

      <Card title="Recent transactions" action={metrics.transactions > 0 ? { href: tab("transactions"), label: "View all →" } : undefined}>
        {recentTransactions.length > 0 ? (
          <ul className="divide-y divide-slate-100">
            {recentTransactions.map((t) => (
              <li key={t.id} className="flex items-start justify-between gap-4 py-2.5 text-sm first:pt-0 last:pb-0">
                <div className="min-w-0">
                  <Link href={`/transactions/${t.id}`} className="font-medium text-slate-900 hover:underline">
                    {t.property ?? "No property yet"}
                  </Link>
                  <p className="text-xs text-slate-500">
                    {t.primaryCustomer ?? "No customer yet"} · {t.realtors.map((r) => r.name).join(", ")}
                  </p>
                </div>
                <div className="shrink-0 text-right text-xs text-slate-500">
                  <p>{t.inspectionDate ? `Inspection ${formatShortDate(t.inspectionDate)}` : "No inspection yet"}</p>
                  {t.revenue !== null && <p className="tabular-nums text-slate-700">{formatCurrency(t.revenue)}</p>}
                </div>
              </li>
            ))}
          </ul>
        ) : (
          <Empty>No transactions with this brokerage&apos;s realtors yet.</Empty>
        )}
      </Card>

      <Card title="Recent activity" action={{ href: tab("activity"), label: "View all →" }}>
        {recentActivity.length > 0 ? (
          <ol className="space-y-2.5">
            {recentActivity.map((item) => (
              <li key={item.id} className="flex justify-between gap-4 text-sm">
                <div className="min-w-0">
                  <p className="text-slate-900">
                    {item.href ? (
                      <Link href={item.href} className="hover:underline">
                        {item.title}
                      </Link>
                    ) : (
                      item.title
                    )}
                  </p>
                  {item.detail && <p className="truncate text-xs text-slate-500">{item.detail}</p>}
                </div>
                <time dateTime={item.at.toISOString()} className="shrink-0 text-xs tabular-nums text-slate-500">
                  {formatShortDate(item.at)}
                </time>
              </li>
            ))}
          </ol>
        ) : (
          <Empty>No activity recorded yet.</Empty>
        )}
      </Card>
    </div>
  );
}
