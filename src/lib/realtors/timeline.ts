import { prisma } from "@/lib/prisma";
import { getPrimaryCustomer } from "@/lib/transactions";
import { associatedTransactionWhere, referredTransactionWhere } from "./metrics";

export type TimelineKind =
  | "call"
  | "email"
  | "communication"
  | "task"
  | "transaction"
  | "inspection"
  | "referral"
  | "brokerage"
  | "note"
  | "profile"
  | "document";

export const TIMELINE_FILTERS = ["all", "calls", "emails", "tasks", "transactions", "notes"] as const;
export type TimelineFilter = (typeof TIMELINE_FILTERS)[number];

export const TIMELINE_FILTER_LABELS: Record<TimelineFilter, string> = {
  all: "All",
  calls: "Calls",
  emails: "Emails",
  tasks: "Tasks",
  transactions: "Transactions",
  notes: "Notes",
};

const FILTER_KINDS: Record<Exclude<TimelineFilter, "all">, TimelineKind[]> = {
  calls: ["call"],
  emails: ["email"],
  tasks: ["task"],
  transactions: ["transaction", "inspection", "referral"],
  notes: ["note"],
};

export interface TimelineItem {
  id: string;
  kind: TimelineKind;
  at: Date;
  title: string;
  detail?: string;
  href?: string;
}

export function parseTimelineFilter(raw: string | undefined): TimelineFilter {
  return (TIMELINE_FILTERS as readonly string[]).includes(raw ?? "") ? (raw as TimelineFilter) : "all";
}

export function filterTimeline(items: TimelineItem[], filter: TimelineFilter): TimelineItem[] {
  if (filter === "all") return items;
  const kinds = FILTER_KINDS[filter];
  return items.filter((item) => kinds.includes(item.kind));
}

export function mergeTimeline(sources: TimelineItem[][], limit: number): TimelineItem[] {
  return sources
    .flat()
    .sort((a, b) => b.at.getTime() - a.at.getTime())
    .slice(0, limit);
}

export function communicationKind(channel: string): TimelineKind {
  const c = channel.toLowerCase();
  if (c === "phone" || c.includes("call")) return "call";
  if (c.includes("email")) return "email";
  return "communication";
}

// ActivityLog actions that describe the relationship itself (rather than
// low-level audit noise) and are worth showing on the timeline.
const PROFILE_ACTIONS: Record<string, { kind: TimelineKind; title: string }> = {
  "realtor.created": { kind: "profile", title: "Realtor record created" },
  "realtor.notes_updated": { kind: "note", title: "Notes updated" },
  "realtor.contact_updated": { kind: "profile", title: "Contact information updated" },
  "realtor.referral_source_linked": { kind: "referral", title: "Linked as a referral source" },
};

function addressOf(p: { addressLine1: string; city: string } | null | undefined): string | undefined {
  return p ? `${p.addressLine1}, ${p.city}` : undefined;
}

// Built only from real CRM records — nothing here is inferred or invented.
// Each source is capped at `limit` so the merge never pulls a realtor's
// entire history; the newest `limit` events overall are guaranteed to be
// among them.
export async function loadRealtorTimeline(
  realtorId: string,
  opts: { limit: number; includeDocuments: boolean }
): Promise<TimelineItem[]> {
  const take = opts.limit;
  const associated = associatedTransactionWhere(realtorId);

  const [communications, tasks, attachments, inspections, referrals, history, logs, documents] = await Promise.all([
    prisma.communication.findMany({ where: { realtorId }, orderBy: { occurredAt: "desc" }, take }),
    prisma.task.findMany({ where: { realtorId }, orderBy: { updatedAt: "desc" }, take }),
    prisma.transactionRealtor.findMany({
      where: { realtorId, transaction: { archivedAt: null } },
      orderBy: { createdAt: "desc" },
      take,
      include: { transaction: { include: { property: true } } },
    }),
    prisma.inspection.findMany({
      where: { completedAt: { not: null }, transaction: associated },
      orderBy: { completedAt: "desc" },
      take,
      include: { property: true },
    }),
    prisma.transaction.findMany({
      where: referredTransactionWhere(realtorId),
      orderBy: { createdAt: "desc" },
      take,
      include: { customers: { include: { customer: true } }, property: true },
    }),
    prisma.realtorBrokerageHistory.findMany({
      where: { realtorId },
      orderBy: { startDate: "desc" },
      take,
      include: { brokerage: true },
    }),
    prisma.activityLog.findMany({
      where: { entityType: "Realtor", entityId: realtorId, action: { in: Object.keys(PROFILE_ACTIONS) } },
      orderBy: { createdAt: "desc" },
      take,
      include: { actor: { select: { name: true } } },
    }),
    opts.includeDocuments
      ? prisma.document.findMany({ where: { transaction: associated }, orderBy: { createdAt: "desc" }, take })
      : Promise.resolve([]),
  ]);

  const items: TimelineItem[][] = [
    communications.map((c) => {
      const kind = communicationKind(c.channel);
      const verb = kind === "call" ? "Call" : kind === "email" ? "Email" : c.channel;
      return {
        id: `comm-${c.id}`,
        kind,
        at: c.occurredAt,
        title: `${verb} ${c.direction === "INBOUND" ? "received" : "logged"}`,
        detail: c.summary,
      };
    }),
    tasks.flatMap((t) => {
      const events: TimelineItem[] = [{ id: `task-created-${t.id}`, kind: "task", at: t.createdAt, title: "Follow-up scheduled", detail: t.title }];
      if (t.completedAt) events.push({ id: `task-done-${t.id}`, kind: "task", at: t.completedAt, title: "Follow-up completed", detail: t.title });
      return events;
    }),
    attachments.map((tr) => ({
      id: `tr-${tr.id}`,
      kind: "transaction" as const,
      at: tr.createdAt,
      title: "Added to transaction",
      detail: addressOf(tr.transaction.property) ?? "No property yet",
      href: `/transactions/${tr.transactionId}`,
    })),
    inspections.map((i) => ({
      id: `insp-${i.id}`,
      kind: "inspection" as const,
      at: i.completedAt!,
      title: "Inspection completed",
      detail: addressOf(i.property),
      href: `/inspections/${i.id}`,
    })),
    referrals.map((t) => {
      const customer = getPrimaryCustomer(t.customers);
      return {
        id: `ref-${t.id}`,
        kind: "referral" as const,
        at: t.createdAt,
        title: "Customer referred",
        detail: customer ? `${customer.firstName} ${customer.lastName}` : addressOf(t.property) ?? "Customer not yet recorded",
        href: `/transactions/${t.id}`,
      };
    }),
    history.map((h) => ({
      id: `hist-${h.id}`,
      kind: "brokerage" as const,
      at: h.startDate,
      title: `Joined ${h.brokerage.name}`,
      href: `/brokerages/${h.brokerageId}`,
    })),
    logs.map((log) => ({
      id: `log-${log.id}`,
      kind: PROFILE_ACTIONS[log.action].kind,
      at: log.createdAt,
      title: PROFILE_ACTIONS[log.action].title,
      detail: log.actor?.name ? `by ${log.actor.name}` : undefined,
    })),
    documents.map((d) => ({
      id: `doc-${d.id}`,
      kind: "document" as const,
      at: d.createdAt,
      title: "Document uploaded",
      detail: d.title,
      href: d.transactionId ? `/transactions/${d.transactionId}` : undefined,
    })),
  ];

  return mergeTimeline(items, opts.limit);
}
