import Link from "next/link";
import type { Brokerage, Realtor } from "@prisma/client";
import { prisma } from "@/lib/prisma";
import { formatShortDate } from "@/lib/dates";
import { formatPhone } from "@/lib/phone";
import { formatCurrency } from "@/lib/realtors/display";
import { getRealtorMetrics } from "@/lib/realtors/metrics";
import { findNextAction } from "@/lib/realtors/preview";
import { loadAssociatedTransactions } from "@/lib/realtors/record";
import { loadRealtorTimeline } from "@/lib/realtors/timeline";
import { sortAlphabetically } from "@/lib/sort";
import { BrokerageEditor, RecordProfileFields, RecordTaskActions } from "./RecordClient";
import { Card, Empty, Metric, type RecordPermissions } from "./ui";

// A summary, not the whole record: a handful of metrics, then focused
// cards that each link onward to the tab holding the full detail.
export async function OverviewTab({
  realtor,
  permissions,
}: {
  realtor: Realtor & { brokerage: Brokerage | null };
  permissions: RecordPermissions;
}) {
  const [metrics, nextAction, recentTransactions, recentActivity, history, brokerages] = await Promise.all([
    getRealtorMetrics(realtor.id, { includeFinancials: permissions.canViewFinancials }),
    findNextAction(realtor.id),
    loadAssociatedTransactions(realtor.id, { take: 5, includeFinancials: permissions.canViewFinancials }),
    loadRealtorTimeline(realtor.id, { limit: 5, includeDocuments: permissions.canReadDocuments }),
    prisma.realtorBrokerageHistory.findMany({
      where: { realtorId: realtor.id },
      orderBy: { startDate: "desc" },
      take: 10,
      include: { brokerage: { select: { id: true, name: true } } },
    }),
    permissions.canWrite ? prisma.brokerage.findMany({ where: { archivedAt: null }, select: { id: true, name: true } }) : Promise.resolve([]),
  ]);

  return (
    <div className="space-y-6">
      <dl className="grid grid-cols-2 gap-4 sm:grid-cols-4">
        <Metric label="Transactions" value={String(metrics.associatedTransactions)} />
        <Metric label="Referrals" value={String(metrics.referrals)} />
        <Metric label="Customers referred" value={String(metrics.customersReferred)} />
        {permissions.canViewFinancials && (
          <Metric label="Associated revenue" value={formatCurrency(metrics.associatedRevenue)} hint="Billed on deals they were on" />
        )}
      </dl>

      <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
        <Card title="Contact">
          <RecordProfileFields
            realtorId={realtor.id}
            values={realtor}
            fields={["phone", "email", "preferredContactMethod", "preferredName", "firstName", "lastName"]}
            canEdit={permissions.canWrite}
          />
        </Card>

        <div className="space-y-4">
          <Card title="Brokerage">
            {realtor.brokerage ? (
              <div className="space-y-1 text-sm">
                <Link href={`/brokerages/${realtor.brokerage.id}`} className="font-medium text-slate-900 hover:underline">
                  {realtor.brokerage.name}
                </Link>
                {(realtor.brokerage.city || realtor.brokerage.phone) && (
                  <p className="text-slate-600">
                    {[realtor.brokerage.city && [realtor.brokerage.city, realtor.brokerage.state].filter(Boolean).join(", "), realtor.brokerage.phone && formatPhone(realtor.brokerage.phone)]
                      .filter(Boolean)
                      .join(" · ")}
                  </p>
                )}
                <Link href={`/brokerages/${realtor.brokerage.id}`} className="inline-block text-sm text-emerald-700 hover:underline">
                  View brokerage
                </Link>
              </div>
            ) : (
              <Empty>No brokerage on file.</Empty>
            )}
            {history.length > 1 && (
              <details className="mt-3 text-sm">
                <summary className="cursor-pointer text-xs text-slate-500 hover:text-slate-700">Brokerage history ({history.length})</summary>
                <ul className="mt-2 space-y-1">
                  {history.map((h) => (
                    <li key={h.id} className="flex justify-between gap-3 text-xs">
                      <Link href={`/brokerages/${h.brokerage.id}`} className="text-slate-700 hover:underline">
                        {h.brokerage.name}
                      </Link>
                      <span className="tabular-nums text-slate-500">
                        {formatShortDate(h.startDate)} – {h.endDate ? formatShortDate(h.endDate) : "present"}
                      </span>
                    </li>
                  ))}
                </ul>
              </details>
            )}
            {permissions.canWrite && (
              <div className="mt-3">
                <BrokerageEditor
                  realtorId={realtor.id}
                  hasBrokerage={Boolean(realtor.brokerage)}
                  options={sortAlphabetically(brokerages, (b) => b.name).map((b) => ({ id: b.id, label: b.name }))}
                />
              </div>
            )}
          </Card>

          <Card title="Next action" action={{ href: "/tasks", label: "All tasks" }}>
            {nextAction ? (
              <div className="space-y-2">
                <p className="text-sm text-slate-900">
                  {nextAction.title}
                  <span className="text-slate-500"> — {nextAction.dueAt ? `due ${formatShortDate(nextAction.dueAt)}` : "no due date"}</span>
                </p>
                {permissions.canWrite && <RecordTaskActions taskId={nextAction.id} dueAt={nextAction.dueAt?.toISOString() ?? null} />}
              </div>
            ) : (
              <Empty>No upcoming follow-up. Use “+ Task” above to schedule one.</Empty>
            )}
          </Card>
        </div>
      </div>

      <Card title="Notes">
        <RecordProfileFields realtorId={realtor.id} values={realtor} fields={["notes"]} canEdit={permissions.canWrite} />
      </Card>

      <Card title="Recent transactions" action={metrics.associatedTransactions > 0 ? { href: `/realtors/${realtor.id}?tab=transactions`, label: "View all →" } : undefined}>
        {recentTransactions.length > 0 ? (
          <ul className="divide-y divide-slate-100">
            {recentTransactions.map((t) => (
              <li key={t.id} className="flex items-start justify-between gap-4 py-2.5 text-sm first:pt-0 last:pb-0">
                <div className="min-w-0">
                  <Link href={`/transactions/${t.id}`} className="font-medium text-slate-900 hover:underline">
                    {t.property ?? "No property yet"}
                  </Link>
                  <p className="text-xs text-slate-500">
                    {t.primaryCustomer ?? "No customer yet"} · {t.roles.join(", ")}
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
          <Empty>Not on any transactions yet.</Empty>
        )}
      </Card>

      <Card title="Recent activity" action={{ href: `/realtors/${realtor.id}?tab=activity`, label: "View all →" }}>
        {recentActivity.length > 0 ? (
          <ol className="space-y-2.5">
            {recentActivity.map((item) => (
              <li key={item.id} className="flex justify-between gap-4 text-sm">
                <div className="min-w-0">
                  <p className="text-slate-900">{item.title}</p>
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
