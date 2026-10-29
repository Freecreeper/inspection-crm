import Link from "next/link";
import type { Prisma, Role, TransactionStatus } from "@prisma/client";
import { prisma } from "@/lib/prisma";
import { auth } from "@/lib/auth";
import { can } from "@/lib/rbac";
import { getPrimaryCustomer } from "@/lib/transactions";
import { realtorDisplayName } from "@/lib/realtors/display";
import { dateOnlyKey, formatDay } from "@/lib/calendar/time";
import { OPEN_TRANSACTION_STAGES, TRANSACTION_STATUS_LABELS, groupTransactionStages, transactionMoves } from "@/lib/transactionStages";
import { QueueRow, QueueSection, WorkspaceHeader, rowAction } from "@/components/workspace/WorkspaceHeader";
import { setTransactionStatus } from "./actions";

type View = "list" | "workflow";
const first = (v: string | string[] | undefined) => (Array.isArray(v) ? v[0] : v);
const SORTS = {
  newest: { createdAt: "desc" },
  deadline: { inspectionDeadline: { sort: "asc", nulls: "last" } },
  closing: { closingDate: { sort: "asc", nulls: "last" } },
} as const satisfies Record<string, Prisma.TransactionOrderByWithRelationInput>;
type Sort = keyof typeof SORTS;

const include = {
  customers: { include: { customer: true } },
  property: true,
  realtors: { include: { realtor: { select: { firstName: true, lastName: true, preferredName: true } } } },
} satisfies Prisma.TransactionInclude;
type Row = Prisma.TransactionGetPayload<{ include: typeof include }>;

const STATUS_BADGE: Record<TransactionStatus, string> = {
  LEAD_IN_PROGRESS: "bg-info-soft text-info-strong",
  SCHEDULED: "bg-warning-soft text-warning-strong",
  IN_PROGRESS: "bg-accent-100 text-accent-800",
  COMPLETED: "bg-success-soft text-success-strong",
  CLOSED: "bg-neutral-100 text-neutral-700",
  CANCELLED: "bg-neutral-100 text-muted-foreground",
};

const customerName = (t: Row) => {
  const c = getPrimaryCustomer(t.customers);
  return c ? `${c.firstName} ${c.lastName}` : null;
};
const address = (t: Row) => (t.property ? `${t.property.addressLine1}, ${t.property.city}` : null);
const dateLabel = (d: Date | null) => {
  const key = dateOnlyKey(d);
  return key ? formatDay(key, "short") : null;
};

// List and Workflow are two views over the same transactions: List for
// finding and comparing them, Workflow for moving each one through its
// lifecycle. A transaction's stage is its own status, never its
// inspections' (those are tracked separately).
export default async function TransactionsPage({ searchParams }: PageProps<"/transactions">) {
  const raw = await searchParams;
  const view: View = first(raw.view) === "workflow" ? "workflow" : "list";
  const session = await auth();
  const canWrite = can(session?.user?.role as Role | undefined, "crm:write");

  return (
    <div className="space-y-5">
      <WorkspaceHeader
        title="Transactions"
        modes={[
          { key: "list", label: "List", href: "/transactions" },
          { key: "workflow", label: "Workflow", href: "/transactions?view=workflow" },
        ]}
        current={view}
        actions={
          canWrite && (
            <Link href="/transactions/new" className="rounded-md bg-primary px-3.5 py-2 text-sm font-medium text-primary-foreground hover:bg-primary-hover">
              + New Transaction
            </Link>
          )
        }
      />
      {view === "workflow" ? <Workflow canWrite={canWrite} /> : <List raw={raw} />}
    </div>
  );
}

async function List({ raw }: { raw: Record<string, string | string[] | undefined> }) {
  const q = (first(raw.q) ?? "").trim().slice(0, 100);
  const statusParam = first(raw.status);
  const status = statusParam && statusParam in TRANSACTION_STATUS_LABELS ? (statusParam as TransactionStatus) : null;
  const sortParam = first(raw.sort);
  const sort: Sort = sortParam && sortParam in SORTS ? (sortParam as Sort) : "newest";
  const ci = (w: string) => ({ contains: w, mode: "insensitive" as const });
  const words = q.split(/\s+/).filter(Boolean).slice(0, 5);

  const transactions = await prisma.transaction.findMany({
    where: {
      archivedAt: null,
      ...(status ? { status } : {}),
      AND: words.map((w) => ({
        OR: [
          { property: { OR: [{ addressLine1: ci(w) }, { city: ci(w) }, { zip: { startsWith: w } }] } },
          { customers: { some: { customer: { OR: [{ firstName: ci(w) }, { lastName: ci(w) }] } } } },
          { realtors: { some: { realtor: { OR: [{ firstName: ci(w) }, { lastName: ci(w) }] } } } },
        ],
      })),
    },
    orderBy: SORTS[sort],
    include,
    take: 100,
  });
  const filtered = Boolean(q || status);

  return (
    <div className="space-y-3">
      <form className="flex flex-wrap gap-2" role="search" aria-label="Filter transactions">
        <input
          name="q"
          defaultValue={q}
          placeholder="Search customer, realtor, or address"
          aria-label="Search transactions"
          className="h-9 min-w-48 flex-1 rounded-md border border-input bg-surface px-3 text-sm placeholder:text-subtle"
        />
        <select name="status" defaultValue={status ?? ""} aria-label="Stage" className="h-9 rounded-md border border-input bg-surface px-2 text-sm">
          <option value="">All stages</option>
          {(Object.keys(TRANSACTION_STATUS_LABELS) as TransactionStatus[]).map((s) => (
            <option key={s} value={s}>
              {TRANSACTION_STATUS_LABELS[s]}
            </option>
          ))}
        </select>
        <select name="sort" defaultValue={sort} aria-label="Sort" className="h-9 rounded-md border border-input bg-surface px-2 text-sm">
          <option value="newest">Newest first</option>
          <option value="deadline">Inspection deadline</option>
          <option value="closing">Closing date</option>
        </select>
        <button type="submit" className="h-9 rounded-md border border-input bg-surface px-3 text-sm font-medium text-neutral-700 hover:bg-hover">
          Apply
        </button>
        {filtered && (
          <Link href="/transactions" className="inline-flex h-9 items-center px-2 text-sm text-muted-foreground hover:text-neutral-800 hover:underline">
            Clear
          </Link>
        )}
      </form>

      <div className="overflow-x-auto rounded-lg border border-border bg-surface">
        <table className="w-full text-sm">
          <thead className="bg-surface-secondary text-left text-xs uppercase tracking-wide text-muted-foreground">
            <tr>
              <th className="px-4 py-2 font-medium">Customer</th>
              <th className="px-4 py-2 font-medium">Property</th>
              <th className="px-4 py-2 font-medium">Realtors</th>
              <th className="px-4 py-2 font-medium">Stage</th>
              <th className="px-4 py-2 font-medium">Inspection deadline</th>
              <th className="px-4 py-2 font-medium">Closing</th>
            </tr>
          </thead>
          <tbody>
            {transactions.map((t) => (
              <tr key={t.id} className="border-t border-neutral-100 hover:bg-hover">
                <td className="px-4 py-2">
                  <Link href={`/transactions/${t.id}`} className="font-medium text-foreground hover:underline">
                    {customerName(t) ?? <span className="text-subtle">No customer yet</span>}
                  </Link>
                </td>
                <td className="px-4 py-2 text-neutral-600">{address(t) ?? <span className="text-subtle">Not set</span>}</td>
                <td className="px-4 py-2 text-neutral-600">{t.realtors.map((r) => realtorDisplayName(r.realtor)).join(", ") || <span className="text-subtle">—</span>}</td>
                <td className="px-4 py-2">
                  <span className={`rounded-full px-2 py-0.5 text-[11px] font-medium ${STATUS_BADGE[t.status]}`}>{TRANSACTION_STATUS_LABELS[t.status]}</span>
                </td>
                <td className="whitespace-nowrap px-4 py-2 text-neutral-600">{dateLabel(t.inspectionDeadline) ?? <span className="text-subtle">—</span>}</td>
                <td className="whitespace-nowrap px-4 py-2 text-neutral-600">{dateLabel(t.closingDate) ?? <span className="text-subtle">—</span>}</td>
              </tr>
            ))}
            {transactions.length === 0 && (
              <tr>
                <td colSpan={6} className="px-4 py-6 text-center text-subtle">
                  {filtered ? "No transactions match. Try a different search or clear the filters." : "No transactions yet."}
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>
    </div>
  );
}

const STAGE_HINTS: Partial<Record<TransactionStatus, string>> = {
  LEAD_IN_PROGRESS: "Not scheduled yet.",
  SCHEDULED: "Inspection booked.",
  IN_PROGRESS: "Inspection and report under way.",
  COMPLETED: "Work done; waiting to close.",
};

async function Workflow({ canWrite }: { canWrite: boolean }) {
  const transactions = await prisma.transaction.findMany({ where: { archivedAt: null }, orderBy: { updatedAt: "asc" }, include, take: 500 });
  const groups = groupTransactionStages(transactions, new Date());

  const row = (t: Row) => {
    const deadline = dateLabel(t.inspectionDeadline);
    const closing = dateLabel(t.closingDate);
    return (
      <QueueRow
        key={t.id}
        actions={
          <>
            {canWrite &&
              transactionMoves(t.status).map((m) => (
                <form key={m.to} action={setTransactionStatus.bind(null, t.id)}>
                  <input type="hidden" name="status" value={m.to} />
                  <button type="submit" className={m.to === "CANCELLED" ? `${rowAction} text-danger-strong` : rowAction}>
                    {m.label}
                  </button>
                </form>
              ))}
            <Link href={`/transactions/${t.id}`} className={rowAction}>
              Open
            </Link>
          </>
        }
      >
        <Link href={`/transactions/${t.id}`} className="block truncate text-sm font-medium text-foreground hover:underline">
          {customerName(t) ?? "No customer yet"}
        </Link>
        <p className="truncate text-xs text-muted-foreground">
          {[address(t) ?? "No property", deadline && `Inspection by ${deadline}`, closing && `Closing ${closing}`].filter(Boolean).join(" · ")}
        </p>
      </QueueRow>
    );
  };

  return (
    <div className="space-y-4">
      <div className="grid grid-cols-1 gap-4 lg:grid-cols-2 2xl:grid-cols-4">
        {OPEN_TRANSACTION_STAGES.map((stage) => (
          <QueueSection key={stage} id={`stage-${stage}`} title={TRANSACTION_STATUS_LABELS[stage]} hint={STAGE_HINTS[stage]} count={groups[stage].length} empty="Nothing here.">
            {groups[stage].map(row)}
          </QueueSection>
        ))}
      </div>
      <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
        <QueueSection id="stage-CLOSED" title="Closed" hint="Last 30 days." count={groups.CLOSED.length} empty="None in the last 30 days.">
          {groups.CLOSED.map(row)}
        </QueueSection>
        <QueueSection id="stage-CANCELLED" title="Cancelled" hint="Last 30 days." count={groups.CANCELLED.length} empty="None in the last 30 days.">
          {groups.CANCELLED.map(row)}
        </QueueSection>
      </div>
    </div>
  );
}
