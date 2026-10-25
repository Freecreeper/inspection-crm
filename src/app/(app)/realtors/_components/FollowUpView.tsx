import Link from "next/link";
import { Mail, Phone } from "lucide-react";
import { prisma } from "@/lib/prisma";
import { formatShortDate } from "@/lib/dates";
import { realtorDisplayName, telHref } from "@/lib/realtors/display";
import {
  bucketDueWhere,
  FOLLOW_UP_BUCKET_LABELS,
  FOLLOW_UP_BUCKET_ORDER,
  bucketsForFilter,
  groupFollowUps,
  type FollowUpFilter,
} from "@/lib/realtors/followUp";
import { FollowUpTaskActions } from "./FollowUpTaskActions";
import { EmailButton } from "@/components/email/EmailComposer";

const FILTER_LABELS: Record<FollowUpFilter, string> = {
  all: "All tasks",
  overdue: "Overdue",
  today: "Today",
  week: "This week",
  none: "No upcoming action",
};

// Per bucket: each bucket shows up to this many, with its true total.
const MAX_PER_BUCKET = 100;
const MAX_IDLE_REALTORS = 50;

// An action queue over the ordinary Task table (tasks with a realtorId) —
// grouped by when they're due, not a pipeline of stages. "No upcoming
// action" is simply realtors with no open task; nothing here is a
// subjective score.
export async function FollowUpView({ filter, canWrite, canEmail }: { filter: FollowUpFilter; canWrite: boolean; canEmail: boolean }) {
  const now = new Date();
  const buckets = bucketsForFilter(filter);

  const openFollowUp = { completedAt: null, realtorId: { not: null }, realtor: { archivedAt: null } } as const;
  const [perBucket, idleRealtors, idleCount] = await Promise.all([
    Promise.all(
      buckets.map(async (bucket) => {
        const where = { ...openFollowUp, ...bucketDueWhere(bucket, now) };
        const [rows, total] = await Promise.all([
          prisma.task.findMany({
            where,
            orderBy: [{ dueAt: { sort: "asc", nulls: "last" } }, { createdAt: "asc" }],
            take: MAX_PER_BUCKET,
            include: {
              realtor: {
                select: { id: true, firstName: true, lastName: true, preferredName: true, phone: true, email: true, brokerage: { select: { name: true } } },
              },
            },
          }),
          prisma.task.count({ where }),
        ]);
        return { bucket, rows, total };
      })
    ),
    filter === "none" || filter === "all"
      ? prisma.realtor.findMany({
          where: { archivedAt: null, tasks: { none: { completedAt: null } } },
          orderBy: [{ lastName: "asc" }, { firstName: "asc" }],
          take: filter === "none" ? MAX_IDLE_REALTORS : 8,
          select: { id: true, firstName: true, lastName: true, preferredName: true, phone: true, email: true, brokerage: { select: { name: true } } },
        })
      : Promise.resolve([]),
    filter === "none" || filter === "all"
      ? prisma.realtor.count({ where: { archivedAt: null, tasks: { none: { completedAt: null } } } })
      : Promise.resolve(0),
  ]);

  const tasks = perBucket.flatMap((b) => b.rows);
  const totals = new Map(perBucket.map((b) => [b.bucket, b.total]));

  // "Last contact" for everyone on screen, in one grouped query.
  const realtorIds = [...new Set([...tasks.map((t) => t.realtorId!), ...idleRealtors.map((r) => r.id)])];
  const lastContacts = realtorIds.length
    ? await prisma.communication.groupBy({ by: ["realtorId"], where: { realtorId: { in: realtorIds } }, _max: { occurredAt: true } })
    : [];
  const lastContactBy = new Map(lastContacts.map((c) => [c.realtorId, c._max.occurredAt]));

  const groups = Object.fromEntries(perBucket.map((b) => [b.bucket, b.rows])) as ReturnType<typeof groupFollowUps<(typeof tasks)[number]>>;
  const visibleBuckets = FOLLOW_UP_BUCKET_ORDER.filter((b) => buckets.includes(b) && groups[b].length > 0);

  return (
    <div className="mt-5">
      <nav aria-label="Follow-up filters" className="flex flex-wrap gap-2">
        {(Object.keys(FILTER_LABELS) as FollowUpFilter[]).map((f) => (
          <Link
            key={f}
            href={f === "all" ? "/realtors?view=followup" : `/realtors?view=followup&filter=${f}`}
            aria-current={filter === f ? "page" : undefined}
            className={`rounded-full border px-3 py-1 text-sm ${
              filter === f ? "border-slate-900 bg-slate-900 text-white" : "border-slate-200 bg-white text-slate-700 hover:bg-slate-50"
            }`}
          >
            {FILTER_LABELS[f]}
          </Link>
        ))}
      </nav>

      <div className="mt-6 space-y-8">
        {visibleBuckets.map((bucket) => (
          <section key={bucket} aria-labelledby={`bucket-${bucket}`}>
            <h2 id={`bucket-${bucket}`} className="flex items-baseline gap-2 text-sm font-semibold text-slate-900">
              {FOLLOW_UP_BUCKET_LABELS[bucket]}
              <span className="text-xs font-normal text-slate-500">{totals.get(bucket) ?? groups[bucket].length}</span>
            </h2>
            {(totals.get(bucket) ?? 0) > groups[bucket].length && (
              <p className="mt-0.5 text-xs text-slate-500">
                Showing the first {groups[bucket].length} of {totals.get(bucket)} — the oldest due first.
              </p>
            )}
            <ul className="mt-2 divide-y divide-slate-100 rounded-lg border border-slate-200 bg-white">
              {groups[bucket].map((task) => {
                const r = task.realtor!;
                const lastContact = lastContactBy.get(r.id);
                return (
                  <li key={task.id} className="flex flex-col gap-3 p-4 sm:flex-row sm:items-start sm:justify-between">
                    <div className="min-w-0">
                      <Link href={`/realtors?selected=${r.id}`} className="font-medium text-slate-900 hover:underline">
                        {realtorDisplayName(r)}
                      </Link>
                      {r.brokerage && <span className="text-sm text-slate-500"> · {r.brokerage.name}</span>}
                      <p className="mt-0.5 text-sm text-slate-700">{task.title}</p>
                      <p className="mt-0.5 text-xs text-slate-500">
                        {task.dueAt ? (
                          <span className={bucket === "overdue" ? "font-medium text-amber-700" : undefined}>Due {formatShortDate(task.dueAt)}</span>
                        ) : (
                          "No due date"
                        )}
                        {" · "}
                        {lastContact ? `Last contact: ${formatShortDate(lastContact)}` : "No contact logged"}
                      </p>
                    </div>
                    <div className="flex shrink-0 flex-wrap items-start gap-2">
                      <ContactLinks realtorId={r.id} phone={r.phone} email={r.email} canEmail={canEmail} followUp />
                      {canWrite && <FollowUpTaskActions taskId={task.id} dueAt={task.dueAt?.toISOString() ?? null} />}
                    </div>
                  </li>
                );
              })}
            </ul>
          </section>
        ))}

        {filter !== "none" && visibleBuckets.length === 0 && (
          <p className="rounded-lg border border-slate-200 bg-white p-8 text-center text-sm text-slate-500">
            Nothing {filter === "all" ? "open" : FILTER_LABELS[filter].toLowerCase()} right now.
          </p>
        )}

        {(filter === "all" || filter === "none") && (
          <section aria-labelledby="bucket-none">
            <h2 id="bucket-none" className="flex items-baseline gap-2 text-sm font-semibold text-slate-900">
              No upcoming action
              <span className="text-xs font-normal text-slate-500">{idleCount}</span>
            </h2>
            <p className="mt-0.5 text-xs text-slate-500">Realtors with no open follow-up task.</p>
            {idleRealtors.length > 0 ? (
              <ul className="mt-2 divide-y divide-slate-100 rounded-lg border border-slate-200 bg-white">
                {idleRealtors.map((r) => {
                  const lastContact = lastContactBy.get(r.id);
                  return (
                    <li key={r.id} className="flex flex-wrap items-center justify-between gap-3 px-4 py-3">
                      <div className="min-w-0">
                        <Link href={`/realtors?selected=${r.id}`} className="font-medium text-slate-900 hover:underline">
                          {realtorDisplayName(r)}
                        </Link>
                        {r.brokerage && <span className="text-sm text-slate-500"> · {r.brokerage.name}</span>}
                        <p className="text-xs text-slate-500">{lastContact ? `Last contact: ${formatShortDate(lastContact)}` : "No contact logged"}</p>
                      </div>
                      <ContactLinks realtorId={r.id} phone={r.phone} email={r.email} canEmail={canEmail} />
                    </li>
                  );
                })}
              </ul>
            ) : (
              <p className="mt-2 text-sm text-slate-500">Every realtor has a follow-up scheduled.</p>
            )}
            {filter === "all" && idleCount > idleRealtors.length && (
              <Link href="/realtors?view=followup&filter=none" className="mt-2 inline-block text-sm text-emerald-700 hover:underline">
                View all {idleCount} →
              </Link>
            )}
          </section>
        )}
      </div>
    </div>
  );
}

function ContactLinks({
  realtorId,
  phone,
  email,
  canEmail,
  followUp = false,
}: {
  realtorId: string;
  phone: string | null;
  email: string | null;
  canEmail: boolean;
  followUp?: boolean;
}) {
  const cls = "inline-flex items-center gap-1 rounded-md border border-slate-300 bg-white px-2.5 py-1 text-xs font-medium text-slate-700 hover:bg-slate-50";
  return (
    <>
      {phone ? (
        <a href={telHref(phone)} className={cls}>
          <Phone className="h-3.5 w-3.5" aria-hidden="true" /> Call
        </a>
      ) : (
        <span className="px-1 py-1 text-xs text-slate-400">No phone</span>
      )}
      {email && canEmail ? (
        <>
          <EmailButton context={{ kind: "realtor", id: realtorId }} className={cls} />
          {followUp && <EmailButton context={{ kind: "realtor", id: realtorId }} templateKey="realtor_follow_up" label="Prepare follow-up" icon={false} className={cls} />}
        </>
      ) : email ? (
        <a href={`mailto:${email}`} className={cls}>
          <Mail className="h-3.5 w-3.5" aria-hidden="true" /> Email
        </a>
      ) : (
        <span className="px-1 py-1 text-xs text-slate-400">Email not provided</span>
      )}
    </>
  );
}
