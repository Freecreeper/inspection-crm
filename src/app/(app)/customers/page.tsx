import Link from "next/link";
import type { Prisma, Role } from "@prisma/client";
import { Mail, Phone } from "lucide-react";
import { prisma } from "@/lib/prisma";
import { auth } from "@/lib/auth";
import { can } from "@/lib/rbac";
import { formatShortDate } from "@/lib/dates";
import { formatPhone } from "@/lib/phone";
import { telHref } from "@/lib/realtors/display";
import { FOLLOW_UP_BUCKET_LABELS, bucketDueWhere, type FollowUpBucket } from "@/lib/realtors/followUp";
import { OPEN_TRANSACTION_STAGES, TRANSACTION_STATUS_LABELS } from "@/lib/transactionStages";
import { QueueRow, QueueSection, WorkspaceHeader, rowAction } from "@/components/workspace/WorkspaceHeader";
import { completeTask } from "../tasks/actions";

type View = "directory" | "followup";
const first = (v: string | string[] | undefined) => (Array.isArray(v) ? v[0] : v);
const SORTS = { newest: { createdAt: "desc" }, name: { lastName: "asc" } } as const satisfies Record<string, Prisma.CustomerOrderByWithRelationInput>;
type Sort = keyof typeof SORTS;
const BUCKET_LIMIT = 50;

// Directory and Follow-up are two views over the same customers. Customers
// have no tasks of their own; their follow-ups are the open tasks on their
// transactions, so that's what Follow-up lists.
export default async function CustomersPage({ searchParams }: PageProps<"/customers">) {
  const raw = await searchParams;
  const view: View = first(raw.view) === "followup" ? "followup" : "directory";
  const session = await auth();
  const canComplete = can(session?.user?.role as Role | undefined, "task:update");

  return (
    <div className="space-y-5">
      <WorkspaceHeader
        title="Customers"
        modes={[
          { key: "directory", label: "Directory", href: "/customers" },
          { key: "followup", label: "Follow-up", href: "/customers?view=followup" },
        ]}
        current={view}
      />
      {view === "followup" ? <FollowUp canComplete={canComplete} /> : <Directory raw={raw} />}
    </div>
  );
}

async function Directory({ raw }: { raw: Record<string, string | string[] | undefined> }) {
  const q = (first(raw.q) ?? "").trim().slice(0, 100);
  const sortParam = first(raw.sort);
  const sort: Sort = sortParam && sortParam in SORTS ? (sortParam as Sort) : "newest";
  const ci = (w: string) => ({ contains: w, mode: "insensitive" as const });
  const words = q.split(/\s+/).filter(Boolean).slice(0, 5);

  const customers = await prisma.customer.findMany({
    where: {
      archivedAt: null,
      AND: words.map((w) => ({ OR: [{ firstName: ci(w) }, { lastName: ci(w) }, { email: ci(w) }, { phone: { contains: w.replace(/\D/g, "") || w } }] })),
    },
    orderBy: SORTS[sort],
    include: {
      transactions: {
        where: { transaction: { archivedAt: null } },
        orderBy: { transaction: { createdAt: "desc" } },
        select: { transaction: { select: { status: true, property: { select: { addressLine1: true, city: true } } } } },
      },
    },
    take: 100,
  });

  return (
    <div className="space-y-3">
      <form className="flex flex-wrap gap-2" role="search" aria-label="Filter customers">
        <input
          name="q"
          defaultValue={q}
          placeholder="Search name, email, or phone"
          aria-label="Search customers"
          className="h-9 min-w-48 flex-1 rounded-md border border-input bg-surface px-3 text-sm placeholder:text-subtle"
        />
        <select name="sort" defaultValue={sort} aria-label="Sort" className="h-9 rounded-md border border-input bg-surface px-2 text-sm">
          <option value="newest">Newest first</option>
          <option value="name">Last name (A–Z)</option>
        </select>
        <button type="submit" className="h-9 rounded-md border border-input bg-surface px-3 text-sm font-medium text-neutral-700 hover:bg-hover">
          Apply
        </button>
        {q && (
          <Link href="/customers" className="inline-flex h-9 items-center px-2 text-sm text-muted-foreground hover:text-neutral-800 hover:underline">
            Clear
          </Link>
        )}
      </form>
      <div className="overflow-x-auto rounded-lg border border-border bg-surface">
        <table className="w-full text-sm">
          <thead className="bg-surface-secondary text-left text-xs uppercase tracking-wide text-muted-foreground">
            <tr>
              <th className="px-4 py-2 font-medium">Customer</th>
              <th className="px-4 py-2 font-medium">Contact</th>
              <th className="px-4 py-2 font-medium">Latest transaction</th>
              <th className="px-4 py-2 font-medium">Transactions</th>
              <th className="px-4 py-2 font-medium">Added</th>
            </tr>
          </thead>
          <tbody>
            {customers.map((c) => {
              const latest = c.transactions[0]?.transaction;
              return (
                <tr key={c.id} className="border-t border-neutral-100 hover:bg-hover">
                  <td className="px-4 py-2">
                    <Link href={`/customers/${c.id}`} className="font-medium text-foreground hover:underline">
                      {c.firstName} {c.lastName}
                    </Link>
                  </td>
                  <td className="px-4 py-2 text-neutral-600">{c.email || (c.phone && formatPhone(c.phone)) || <span className="text-subtle">Not provided</span>}</td>
                  <td className="px-4 py-2 text-neutral-600">
                    {latest ? (
                      <>
                        {latest.property ? `${latest.property.addressLine1}, ${latest.property.city}` : "No property"}
                        <span className="text-subtle"> · {TRANSACTION_STATUS_LABELS[latest.status]}</span>
                      </>
                    ) : (
                      <span className="text-subtle">—</span>
                    )}
                  </td>
                  <td className="px-4 py-2 tabular-nums text-neutral-600">{c.transactions.length}</td>
                  <td className="whitespace-nowrap px-4 py-2 text-neutral-600">{formatShortDate(c.createdAt)}</td>
                </tr>
              );
            })}
            {customers.length === 0 && (
              <tr>
                <td colSpan={5} className="px-4 py-6 text-center text-subtle">
                  {q ? "No customers match. Try a different search." : "No customers yet — convert a lead to create one."}
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>
    </div>
  );
}

const BUCKETS: FollowUpBucket[] = ["overdue", "today", "thisWeek", "upcoming", "unscheduled"];

async function FollowUp({ canComplete }: { canComplete: boolean }) {
  const now = new Date();
  // Open tasks on transactions that have at least one (active) customer.
  const taskWhere = (bucket: FollowUpBucket): Prisma.TaskWhereInput => ({
    completedAt: null,
    ...bucketDueWhere(bucket, now),
    transaction: { archivedAt: null, customers: { some: { customer: { archivedAt: null } } } },
  });
  const taskInclude = {
    assignee: { select: { name: true } },
    transaction: { select: { id: true, property: { select: { addressLine1: true, city: true } }, customers: { where: { customer: { archivedAt: null } }, select: { primaryContact: true, customer: true } } } },
  } satisfies Prisma.TaskInclude;
  // Customers with an open transaction but no open task on any of their transactions.
  const noActionWhere: Prisma.CustomerWhereInput = {
    archivedAt: null,
    transactions: { some: { transaction: { archivedAt: null, status: { in: [...OPEN_TRANSACTION_STAGES] } } } },
    NOT: { transactions: { some: { transaction: { tasks: { some: { completedAt: null } } } } } },
  };

  const [buckets, noAction, noActionCount] = await Promise.all([
    Promise.all(
      BUCKETS.map(async (bucket) => {
        const where = taskWhere(bucket);
        const [tasks, count] = await Promise.all([
          prisma.task.findMany({ where, include: taskInclude, orderBy: [{ dueAt: "asc" }, { createdAt: "asc" }], take: BUCKET_LIMIT }),
          prisma.task.count({ where }),
        ]);
        return { bucket, tasks, count };
      })
    ),
    prisma.customer.findMany({ where: noActionWhere, orderBy: { updatedAt: "asc" }, take: BUCKET_LIMIT }),
    prisma.customer.count({ where: noActionWhere }),
  ]);

  return (
    <div className="space-y-4">
      {buckets.map(({ bucket, tasks, count }) => (
        <QueueSection
          key={bucket}
          id={`bucket-${bucket}`}
          title={FOLLOW_UP_BUCKET_LABELS[bucket]}
          count={count}
          tone={bucket === "overdue" && count ? "danger" : bucket === "today" && count ? "warning" : "neutral"}
          hint={count > tasks.length ? `Showing the first ${tasks.length}.` : undefined}
          empty="Nothing here."
        >
          {tasks.map((task) => {
            const people = task.transaction!.customers;
            const primary = (people.find((p) => p.primaryContact) ?? people[0])?.customer;
            const property = task.transaction!.property;
            return (
              <QueueRow
                key={task.id}
                actions={
                  <>
                    {primary?.phone && (
                      <a href={telHref(primary.phone)} className={rowAction} aria-label={`Call ${primary.firstName} ${primary.lastName}`}>
                        <Phone className="h-3 w-3" aria-hidden="true" /> Call
                      </a>
                    )}
                    {primary?.email && (
                      <a href={`mailto:${primary.email}`} className={rowAction} aria-label={`Email ${primary.firstName} ${primary.lastName}`}>
                        <Mail className="h-3 w-3" aria-hidden="true" /> Email
                      </a>
                    )}
                    {canComplete && (
                      <form action={completeTask.bind(null, task.id)}>
                        <button type="submit" className={rowAction}>
                          Complete
                        </button>
                      </form>
                    )}
                    <Link href={`/transactions/${task.transaction!.id}`} className={rowAction}>
                      Open transaction
                    </Link>
                  </>
                }
              >
                <p className="truncate text-sm font-medium text-foreground">{task.title}</p>
                <p className="truncate text-xs text-muted-foreground">
                  {primary && (
                    <Link href={`/customers/${primary.id}`} className="font-medium text-neutral-700 hover:underline">
                      {primary.firstName} {primary.lastName}
                    </Link>
                  )}
                  {[property ? ` · ${property.addressLine1}, ${property.city}` : "", task.dueAt ? ` · due ${formatShortDate(task.dueAt)}` : "", task.assignee?.name ? ` · ${task.assignee.name}` : ""].join("")}
                </p>
              </QueueRow>
            );
          })}
        </QueueSection>
      ))}

      <QueueSection
        id="bucket-none"
        title="No upcoming action"
        hint={`An open transaction, but no open task on any of their transactions.${noActionCount > noAction.length ? ` Showing the first ${noAction.length}.` : ""}`}
        count={noActionCount}
        empty="Every customer with an open transaction has a follow-up."
      >
        {noAction.map((c) => (
          <QueueRow
            key={c.id}
            actions={
              <Link href={`/customers/${c.id}`} className={rowAction}>
                Open
              </Link>
            }
          >
            <Link href={`/customers/${c.id}`} className="block truncate text-sm font-medium text-foreground hover:underline">
              {c.firstName} {c.lastName}
            </Link>
            <p className="truncate text-xs text-muted-foreground">{[c.email, c.phone && formatPhone(c.phone)].filter(Boolean).join(" · ") || "No contact details"}</p>
          </QueueRow>
        ))}
      </QueueSection>
    </div>
  );
}
