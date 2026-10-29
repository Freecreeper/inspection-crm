import Link from "next/link";
import type { LeadStatus, Prisma, Role } from "@prisma/client";
import { Mail, Phone } from "lucide-react";
import { prisma } from "@/lib/prisma";
import { auth } from "@/lib/auth";
import { can } from "@/lib/rbac";
import { formatShortDate } from "@/lib/dates";
import { formatPhone } from "@/lib/phone";
import { telHref } from "@/lib/realtors/display";
import { LEAD_MOVE_LABELS, LEAD_STATUS_LABELS, OPEN_LEAD_STAGES, groupPipeline, leadMoves } from "@/lib/leads/pipeline";
import { QueueRow, QueueSection, WorkspaceHeader, rowAction } from "@/components/workspace/WorkspaceHeader";
import { convertLead, createLead, setLeadStatus } from "./actions";

type View = "records" | "pipeline";
const SORTS = { newest: { createdAt: "desc" }, oldest: { createdAt: "asc" }, name: { lastName: "asc" } } as const satisfies Record<string, Prisma.LeadOrderByWithRelationInput>;
type Sort = keyof typeof SORTS;
const first = (v: string | string[] | undefined) => (Array.isArray(v) ? v[0] : v);

const STATUS_BADGE: Record<LeadStatus, string> = {
  NEW: "bg-info-soft text-info-strong",
  CONTACTED: "bg-warning-soft text-warning-strong",
  QUALIFIED: "bg-success-soft text-success-strong",
  CONVERTED: "bg-neutral-100 text-neutral-700",
  LOST: "bg-neutral-100 text-muted-foreground",
};

function StatusBadge({ status }: { status: LeadStatus }) {
  return <span className={`rounded-full px-2 py-0.5 text-[11px] font-medium ${STATUS_BADGE[status]}`}>{LEAD_STATUS_LABELS[status]}</span>;
}

// Records and Pipeline are two views over the same leads: Records for
// finding and managing them, Pipeline for working them stage by stage.
export default async function LeadsPage({ searchParams }: PageProps<"/leads">) {
  const raw = await searchParams;
  const view: View = first(raw.view) === "pipeline" ? "pipeline" : "records";
  const session = await auth();
  const canWrite = can(session?.user?.role as Role | undefined, "crm:write");

  return (
    <div className="space-y-5">
      <WorkspaceHeader
        title="Leads"
        modes={[
          { key: "records", label: "Records", href: "/leads" },
          { key: "pipeline", label: "Pipeline", href: "/leads?view=pipeline" },
        ]}
        current={view}
        actions={
          canWrite && (
            <Link href="/leads#new-lead" className="rounded-md bg-primary px-3.5 py-2 text-sm font-medium text-primary-foreground hover:bg-primary-hover">
              + Add Lead
            </Link>
          )
        }
      />
      {view === "pipeline" ? <Pipeline canWrite={canWrite} /> : <Records raw={raw} canWrite={canWrite} />}
    </div>
  );
}

async function Records({ raw, canWrite }: { raw: Record<string, string | string[] | undefined>; canWrite: boolean }) {
  const q = (first(raw.q) ?? "").trim().slice(0, 100);
  const statusParam = first(raw.status);
  const status = statusParam && statusParam in LEAD_STATUS_LABELS ? (statusParam as LeadStatus) : null;
  const sortParam = first(raw.sort);
  const sort: Sort = sortParam && sortParam in SORTS ? (sortParam as Sort) : "newest";
  const words = q.split(/\s+/).filter(Boolean).slice(0, 5);
  const ci = (w: string) => ({ contains: w, mode: "insensitive" as const });

  const leads = await prisma.lead.findMany({
    where: {
      ...(status ? { status } : {}),
      AND: words.map((w) => ({ OR: [{ firstName: ci(w) }, { lastName: ci(w) }, { email: ci(w) }, { phone: { contains: w.replace(/\D/g, "") || w } }] })),
    },
    orderBy: SORTS[sort],
    include: { referralSource: { select: { name: true } } },
    take: 100,
  });
  const filtered = Boolean(q || status);

  return (
    <div className="grid grid-cols-1 gap-6 lg:grid-cols-3">
      <div className="space-y-3 lg:col-span-2">
        {/* A plain GET form: filters live in the URL, so they survive reloads and can be shared. */}
        <form className="flex flex-wrap gap-2" role="search" aria-label="Filter leads">
          <input
            name="q"
            defaultValue={q}
            placeholder="Search name, email, or phone"
            aria-label="Search leads"
            className="h-9 min-w-48 flex-1 rounded-md border border-input bg-surface px-3 text-sm placeholder:text-subtle"
          />
          <select name="status" defaultValue={status ?? ""} aria-label="Status" className="h-9 rounded-md border border-input bg-surface px-2 text-sm">
            <option value="">All statuses</option>
            {(Object.keys(LEAD_STATUS_LABELS) as LeadStatus[]).map((s) => (
              <option key={s} value={s}>
                {LEAD_STATUS_LABELS[s]}
              </option>
            ))}
          </select>
          <select name="sort" defaultValue={sort} aria-label="Sort" className="h-9 rounded-md border border-input bg-surface px-2 text-sm">
            <option value="newest">Newest first</option>
            <option value="oldest">Oldest first</option>
            <option value="name">Last name (A–Z)</option>
          </select>
          <button type="submit" className="h-9 rounded-md border border-input bg-surface px-3 text-sm font-medium text-neutral-700 hover:bg-hover">
            Apply
          </button>
          {filtered && (
            <Link href="/leads" className="inline-flex h-9 items-center px-2 text-sm text-muted-foreground hover:text-neutral-800 hover:underline">
              Clear
            </Link>
          )}
        </form>

        <div className="overflow-x-auto rounded-lg border border-border bg-surface">
          <table className="w-full text-sm">
            <thead className="bg-surface-secondary text-left text-xs uppercase tracking-wide text-muted-foreground">
              <tr>
                <th className="px-4 py-2 font-medium">Lead</th>
                <th className="px-4 py-2 font-medium">Contact</th>
                <th className="px-4 py-2 font-medium">Status</th>
                <th className="px-4 py-2 font-medium">Source</th>
                <th className="px-4 py-2 font-medium">Added</th>
              </tr>
            </thead>
            <tbody>
              {leads.map((lead) => (
                <tr key={lead.id} className="border-t border-neutral-100 hover:bg-hover">
                  <td className="px-4 py-2">
                    <Link href={`/leads/${lead.id}`} className="font-medium text-foreground hover:underline">
                      {lead.firstName} {lead.lastName}
                    </Link>
                  </td>
                  <td className="px-4 py-2 text-neutral-600">{lead.email || (lead.phone && formatPhone(lead.phone)) || <span className="text-subtle">Not provided</span>}</td>
                  <td className="px-4 py-2">
                    <StatusBadge status={lead.status} />
                  </td>
                  <td className="px-4 py-2 text-neutral-600">{lead.referralSource?.name ?? <span className="text-subtle">—</span>}</td>
                  <td className="whitespace-nowrap px-4 py-2 text-neutral-600">{formatShortDate(lead.createdAt)}</td>
                </tr>
              ))}
              {leads.length === 0 && (
                <tr>
                  <td colSpan={5} className="px-4 py-6 text-center text-subtle">
                    {filtered ? "No leads match. Try a different search or clear the filters." : "No leads yet."}
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      </div>

      {canWrite && (
        <div id="new-lead" className="scroll-mt-20 self-start rounded-lg border border-border bg-surface p-4">
          <h2 className="text-sm font-semibold text-foreground">New lead</h2>
          <form action={createLead} className="mt-3 space-y-3">
            <div className="grid grid-cols-2 gap-2">
              <input name="firstName" placeholder="First name" required aria-label="First name" className="rounded-md border border-input px-2 py-1.5 text-sm" />
              <input name="lastName" placeholder="Last name" required aria-label="Last name" className="rounded-md border border-input px-2 py-1.5 text-sm" />
            </div>
            <input name="email" type="email" placeholder="Email (optional)" aria-label="Email" className="w-full rounded-md border border-input px-2 py-1.5 text-sm" />
            <input name="phone" placeholder="Phone (optional)" aria-label="Phone" className="w-full rounded-md border border-input px-2 py-1.5 text-sm" />
            <textarea name="notes" placeholder="Notes (optional)" aria-label="Notes" rows={2} className="w-full rounded-md border border-input px-2 py-1.5 text-sm" />
            <button type="submit" className="w-full rounded-md bg-primary px-3 py-1.5 text-sm font-medium text-primary-foreground hover:bg-primary-hover">
              Add lead
            </button>
          </form>
        </div>
      )}
    </div>
  );
}

const STAGE_HINTS: Partial<Record<LeadStatus, string>> = {
  NEW: "Not contacted yet.",
  CONTACTED: "Reached out; not qualified yet.",
  QUALIFIED: "Ready to convert to a customer and transaction.",
};

async function Pipeline({ canWrite }: { canWrite: boolean }) {
  const now = new Date();
  const leads = await prisma.lead.findMany({ orderBy: { updatedAt: "asc" }, take: 500 });
  const groups = groupPipeline(leads, now);

  const row = (lead: (typeof leads)[number]) => (
    <QueueRow
      key={lead.id}
      actions={
        <>
          {lead.phone && (
            <a href={telHref(lead.phone)} className={rowAction} aria-label={`Call ${lead.firstName} ${lead.lastName}`}>
              <Phone className="h-3 w-3" aria-hidden="true" /> Call
            </a>
          )}
          {lead.email && (
            <a href={`mailto:${lead.email}`} className={rowAction} aria-label={`Email ${lead.firstName} ${lead.lastName}`}>
              <Mail className="h-3 w-3" aria-hidden="true" /> Email
            </a>
          )}
          {canWrite &&
            leadMoves(lead.status).map((next) => (
              <form key={next} action={setLeadStatus.bind(null, lead.id)}>
                <input type="hidden" name="status" value={next} />
                <button type="submit" className={rowAction}>
                  {LEAD_MOVE_LABELS[next]}
                </button>
              </form>
            ))}
          {canWrite && (lead.status === "CONTACTED" || lead.status === "QUALIFIED") && (
            <form action={convertLead.bind(null, lead.id)}>
              <button type="submit" className={`${rowAction} border-accent-300 text-accent-800 hover:bg-selected`}>
                Convert
              </button>
            </form>
          )}
          <Link href={`/leads/${lead.id}`} className={rowAction}>
            Open
          </Link>
        </>
      }
    >
      <Link href={`/leads/${lead.id}`} className="block truncate text-sm font-medium text-foreground hover:underline">
        {lead.firstName} {lead.lastName}
      </Link>
      <p className="truncate text-xs text-muted-foreground">
        {[lead.email, lead.phone && formatPhone(lead.phone)].filter(Boolean).join(" · ") || "No contact details"} · in stage since {formatShortDate(lead.updatedAt)}
      </p>
    </QueueRow>
  );

  return (
    <div className="space-y-4">
      <div className="grid grid-cols-1 gap-4 xl:grid-cols-3">
        {OPEN_LEAD_STAGES.map((stage) => (
          <QueueSection key={stage} id={`stage-${stage}`} title={LEAD_STATUS_LABELS[stage]} hint={STAGE_HINTS[stage]} count={groups[stage].length} tone={stage === "QUALIFIED" ? "accent" : "neutral"} empty="Nothing here.">
            {groups[stage].map(row)}
          </QueueSection>
        ))}
      </div>
      <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
        <QueueSection id="stage-CONVERTED" title="Converted" hint="Last 30 days." count={groups.CONVERTED.length} empty="None in the last 30 days.">
          {groups.CONVERTED.map(row)}
        </QueueSection>
        <QueueSection id="stage-LOST" title="Lost" hint="Last 30 days." count={groups.LOST.length} empty="None in the last 30 days.">
          {groups.LOST.map(row)}
        </QueueSection>
      </div>
    </div>
  );
}
