import Link from "next/link";
import type { Prisma, Role } from "@prisma/client";
import { prisma } from "@/lib/prisma";
import { auth } from "@/lib/auth";
import { can } from "@/lib/rbac";
import { QueueRow, QueueSection, WorkspaceHeader, rowAction } from "@/components/workspace/WorkspaceHeader";
import { DELIVERED_WINDOW_DAYS, INSPECTION_QUEUES, QUEUE_INFO, UPCOMING_WINDOW_DAYS, groupInspectionQueues, type InspectionQueue } from "@/lib/inspections/workflow";
import { updateInspectionStatus } from "./actions";
import { getPrimaryCustomer } from "@/lib/transactions";
import { getCalendarConfig } from "@/lib/calendar/config";
import { addDays, formatDay, formatTime, startOfDayUtc, toDayKey } from "@/lib/calendar/time";
import { unfinishedReportWhere } from "@/lib/dashboard/sources";

// Filters the Dashboard links to, using the same definitions as its KPIs.
const FILTERS = {
  "report-pending": "Completed, report not finalized",
  "agreement-unsigned": "Scheduled in the next 14 days, agreement unsigned",
} as const;
type Filter = keyof typeof FILTERS;
const PAGE_SIZE = 50;

// List, Schedule (the Calendar) and Workflow over the same inspections:
// List to find and review them, Workflow to work the operational queues.
export default async function InspectionsPage({ searchParams }: { searchParams: Promise<{ filter?: string; view?: string; page?: string }> }) {
  const params = await searchParams;
  const workflow = params.view === "workflow";
  const session = await auth();
  const canConduct = can(session?.user?.role as Role | undefined, "inspection:conduct");
  return (
    <div className="space-y-5">
      <WorkspaceHeader
        title="Inspections"
        modes={[
          { key: "list", label: "List", href: "/inspections" },
          { key: "schedule", label: "Schedule", href: "/calendar" },
          { key: "workflow", label: "Workflow", href: "/inspections?view=workflow" },
        ]}
        current={workflow ? "workflow" : "list"}
      />
      {workflow ? <Workflow canConduct={canConduct} /> : <List params={params} />}
    </div>
  );
}

// Default list is what's coming up (today onward, plus unscheduled), soonest
// first; Past is newest first. Both page through everything with a count,
// so nothing silently drops off after the first N rows.
async function List({ params }: { params: { filter?: string; view?: string; page?: string } }) {
  const { filter: rawFilter, view: rawView, page: rawPage } = params;
  const filter = rawFilter && rawFilter in FILTERS ? (rawFilter as Filter) : null;
  const view = rawView === "past" ? "past" : "upcoming";
  const page = Math.max(1, Math.floor(Number(rawPage) || 1));
  const { timeZone } = getCalendarConfig();
  const today = toDayKey(new Date(), timeZone);
  const startOfToday = startOfDayUtc(today, timeZone);
  const where: Prisma.InspectionWhereInput =
    filter === "report-pending"
      ? unfinishedReportWhere()
      : filter === "agreement-unsigned"
        ? { status: "SCHEDULED", agreementSignedAt: null, scheduledAt: { gte: startOfToday, lt: startOfDayUtc(addDays(today, 15), timeZone) } }
        : view === "past"
          ? { scheduledAt: { lt: startOfToday } }
          : { OR: [{ scheduledAt: { gte: startOfToday } }, { scheduledAt: null, status: { in: ["SCHEDULED", "IN_PROGRESS"] } }] };
  const orderBy: Prisma.InspectionOrderByWithRelationInput[] =
    view === "past" && !filter ? [{ scheduledAt: "desc" }, { id: "asc" }] : [{ scheduledAt: { sort: "asc", nulls: "first" } }, { id: "asc" }];
  const [inspections, total] = await Promise.all([
    prisma.inspection.findMany({
      where,
      orderBy,
      include: {
        property: true,
        inspector: true,
        transaction: { include: { customers: { include: { customer: true } } } },
        // The current report: the newest, the same one the report pages show.
        reports: { select: { id: true, status: true }, orderBy: { createdAt: "desc" }, take: 1 },
      },
      skip: (page - 1) * PAGE_SIZE,
      take: PAGE_SIZE,
    }),
    prisma.inspection.count({ where }),
  ]);
  const thisYear = today.slice(0, 4);
  const href = (p: number) => `/inspections?${new URLSearchParams({ ...(filter ? { filter } : { view }), ...(p > 1 ? { page: String(p) } : {}) })}`;

  return (
    <div>
      {!filter && (
        <nav aria-label="Upcoming or past" className="flex gap-1">
          {(["upcoming", "past"] as const).map((v) => (
            <Link
              key={v}
              href={v === "upcoming" ? "/inspections" : "/inspections?view=past"}
              aria-current={view === v ? "page" : undefined}
              className={`rounded-md px-3 py-1.5 text-sm font-medium ${view === v ? "bg-neutral-solid-900 text-white" : "text-neutral-600 hover:bg-neutral-100"}`}
            >
              {v === "upcoming" ? "Upcoming" : "Past"}
            </Link>
          ))}
        </nav>
      )}
      {filter && (
        <p className="mt-2 flex flex-wrap items-center gap-2 text-sm text-neutral-600">
          <span className="rounded-full bg-neutral-100 px-2.5 py-0.5 text-neutral-700">Showing: {FILTERS[filter]}</span>
          <Link href="/inspections" className="text-accent-700 hover:underline">
            Clear filter
          </Link>
        </p>
      )}
      <div className="mt-6 overflow-hidden rounded-lg border border-neutral-200 bg-surface">
        <table className="w-full text-sm">
          <thead className="bg-neutral-50 text-left text-xs uppercase tracking-wide text-neutral-500">
            <tr>
              <th className="px-4 py-2 font-medium">Property</th>
              <th className="px-4 py-2 font-medium">Customer</th>
              <th className="px-4 py-2 font-medium">Scheduled</th>
              <th className="px-4 py-2 font-medium">Inspector</th>
              <th className="px-4 py-2 font-medium">Status</th>
              <th className="px-4 py-2 font-medium">Report</th>
            </tr>
          </thead>
          <tbody>
            {inspections.map((i) => {
              const primaryCustomer = getPrimaryCustomer(i.transaction.customers);
              const report = i.reports[0];
              return (
                <tr key={i.id} className="border-t border-neutral-100 hover:bg-neutral-50">
                  <td className="px-4 py-2">
                    <Link href={`/inspections/${i.id}`} className="font-medium text-neutral-900 hover:underline">
                      {i.property.addressLine1}, {i.property.city}
                    </Link>
                  </td>
                  <td className="px-4 py-2 text-neutral-600">
                    {primaryCustomer ? `${primaryCustomer.firstName} ${primaryCustomer.lastName}` : "No customer yet"}
                  </td>
                  <td className="px-4 py-2 tabular-nums text-neutral-600">
                    {i.scheduledAt ? (
                      `${formatDay(toDayKey(i.scheduledAt, timeZone), "short")}${toDayKey(i.scheduledAt, timeZone).slice(0, 4) !== thisYear ? `, ${toDayKey(i.scheduledAt, timeZone).slice(0, 4)}` : ""}, ${formatTime(i.scheduledAt, timeZone)}`
                    ) : (
                      <span className="text-neutral-400">Not set</span>
                    )}
                  </td>
                  <td className="px-4 py-2 text-neutral-600">
                    {i.inspector?.name || <span className="text-neutral-400">Unassigned</span>}
                  </td>
                  <td className="px-4 py-2">
                    <span className="rounded-full bg-neutral-100 px-2 py-0.5 font-mono text-[11px] text-neutral-600">
                      {i.status}
                    </span>
                  </td>
                  <td className="px-4 py-2">
                    {report ? (
                      <span className="rounded-full bg-blue-100 px-2 py-0.5 font-mono text-[11px] text-blue-700">
                        {report.status}
                      </span>
                    ) : (
                      <span className="text-neutral-400">Not started</span>
                    )}
                  </td>
                </tr>
              );
            })}
            {inspections.length === 0 && (
              <tr>
                <td colSpan={6} className="px-4 py-6 text-center text-neutral-400">
                  {filter ? "No inspections match this filter." : view === "past" ? "No past inspections." : "Nothing coming up — schedule one from the Calendar or a transaction."}
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>
      {total > 0 && (
        <div className="mt-3 flex items-center justify-between text-sm text-neutral-600">
          <p>
            Showing {(page - 1) * PAGE_SIZE + 1}–{Math.min(page * PAGE_SIZE, total)} of {total}
          </p>
          <div className="flex gap-2">
            {page > 1 && (
              <Link href={href(page - 1)} className="rounded-md border border-neutral-300 bg-surface px-3 py-1 hover:bg-neutral-50">
                Previous
              </Link>
            )}
            {page * PAGE_SIZE < total && (
              <Link href={href(page + 1)} className="rounded-md border border-neutral-300 bg-surface px-3 py-1 hover:bg-neutral-50">
                Next
              </Link>
            )}
          </div>
        </div>
      )}
    </div>
  );
}

const reportHref = (id: string) => `/inspections/${id}/report`;

async function Workflow({ canConduct }: { canConduct: boolean }) {
  const now = new Date();
  const { timeZone } = getCalendarConfig();
  const today = toDayKey(now, timeZone);
  const bounds = { now, dayStart: startOfDayUtc(today, timeZone), dayEnd: startOfDayUtc(addDays(today, 1), timeZone) };
  const deliveredSince = new Date(now.getTime() - DELIVERED_WINDOW_DAYS * 24 * 60 * 60 * 1000);

  const inspections = await prisma.inspection.findMany({
    where: {
      OR: [
        { status: { in: ["SCHEDULED", "IN_PROGRESS"] }, OR: [{ scheduledAt: null }, { scheduledAt: { lt: startOfDayUtc(addDays(today, UPCOMING_WINDOW_DAYS + 1), timeZone) } }] },
        { status: "COMPLETED", reports: { none: { status: { in: ["DELIVERED", "ARCHIVED"] } } } },
        { status: "COMPLETED", reports: { some: { status: "DELIVERED", deliveredAt: { gte: deliveredSince } } } },
      ],
    },
    orderBy: [{ scheduledAt: { sort: "asc", nulls: "first" } }, { id: "asc" }],
    include: {
      property: true,
      inspector: { select: { name: true } },
      transaction: { include: { customers: { include: { customer: true } } } },
      reports: { select: { id: true, status: true, deliveredAt: true }, orderBy: { createdAt: "desc" }, take: 1 },
    },
    take: 500,
  });
  const rows = inspections.map((i) => ({ ...i, report: i.reports[0] ?? null }));
  const groups = groupInspectionQueues(rows, bounds);
  const thisYear = today.slice(0, 4);
  const when = (d: Date | null) => {
    if (!d) return "No date set";
    const day = toDayKey(d, timeZone);
    return `${formatDay(day, "short")}${day.slice(0, 4) !== thisYear ? `, ${day.slice(0, 4)}` : ""}, ${formatTime(d, timeZone)}`;
  };

  // Only the actions that fit each queue.
  const actionsFor = (queue: InspectionQueue, i: (typeof rows)[number]) => {
    const statusButton = (status: "IN_PROGRESS" | "COMPLETED", label: string) =>
      canConduct && (
        <form action={updateInspectionStatus.bind(null, i.id)}>
          <input type="hidden" name="status" value={status} />
          <button type="submit" className={rowAction}>
            {label}
          </button>
        </form>
      );
    return (
      <>
        {(queue === "today" || queue === "awaiting") && statusButton("IN_PROGRESS", "Start")}
        {queue === "inProgress" && statusButton("COMPLETED", "Mark complete")}
        {queue === "complete" && (
          <Link href={reportHref(i.id)} className={rowAction}>
            Start report
          </Link>
        )}
        {(queue === "reportInProgress" || queue === "delivered") && (
          <Link href={reportHref(i.id)} className={rowAction}>
            Open report
          </Link>
        )}
        {queue === "readyForReview" && (
          <Link href={`${reportHref(i.id)}/finalize`} className={rowAction}>
            Review &amp; finalize
          </Link>
        )}
        {queue === "readyToDeliver" && (
          <Link href={reportHref(i.id)} className={rowAction}>
            Deliver
          </Link>
        )}
        <Link href={`/inspections/${i.id}`} className={rowAction}>
          Open
        </Link>
      </>
    );
  };

  const section = (queue: InspectionQueue) => {
    const info = QUEUE_INFO[queue];
    return (
      <QueueSection key={queue} id={`queue-${queue}`} title={info.title} hint={info.hint} count={groups[queue].length} tone={groups[queue].length ? info.tone : undefined} empty="Nothing here.">
        {groups[queue].map((i) => {
          const customer = getPrimaryCustomer(i.transaction.customers);
          return (
            <QueueRow key={i.id} actions={actionsFor(queue, i)}>
              <Link href={`/inspections/${i.id}`} className="block truncate text-sm font-medium text-neutral-900 hover:underline">
                {i.property.addressLine1}, {i.property.city}
              </Link>
              <p className="truncate text-xs text-neutral-500">
                {[when(i.scheduledAt), customer && `${customer.firstName} ${customer.lastName}`, i.inspector?.name ?? "Unassigned"].filter(Boolean).join(" · ")}
              </p>
            </QueueRow>
          );
        })}
      </QueueSection>
    );
  };

  return (
    <div className="space-y-6">
      <div>
        <h2 className="mb-2 text-xs font-semibold uppercase tracking-wider text-neutral-400">Inspection</h2>
        <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">{INSPECTION_QUEUES.slice(0, 4).map(section)}</div>
      </div>
      <div>
        <h2 className="mb-2 text-xs font-semibold uppercase tracking-wider text-neutral-400">Report</h2>
        <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">{INSPECTION_QUEUES.slice(4).map(section)}</div>
      </div>
    </div>
  );
}
