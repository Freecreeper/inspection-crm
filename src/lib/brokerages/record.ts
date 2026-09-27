import type { Prisma } from "@prisma/client";
import { prisma } from "@/lib/prisma";
import { billedRevenueByTransaction, billedRevenueWhere, decimalString } from "@/lib/realtors/metrics";
import { ROLE_LABELS, TRANSACTION_INCLUDE, toRow, type TransactionRow } from "@/lib/realtors/record";
import { realtorDisplayName } from "@/lib/realtors/display";
import { formatPhone } from "@/lib/phone";

// A brokerage's deals are the ones a realtor worked *while at this
// brokerage* — the snapshot on TransactionRealtor — so a realtor moving
// firms never moves their past deals with them.
export function brokerageTransactionWhere(brokerageId: string): Prisma.TransactionWhereInput {
  return { archivedAt: null, realtors: { some: { brokerageId } } };
}

export interface BrokerageMetrics {
  currentRealtors: number;
  formerRealtors: number;
  transactions: number;
  // null when the viewer lacks financial:read — never computed, not just hidden.
  associatedRevenue: string | null;
}

export async function getBrokerageMetrics(brokerageId: string, opts: { includeFinancials: boolean }): Promise<BrokerageMetrics> {
  const deals = brokerageTransactionWhere(brokerageId);
  const [currentRealtors, formerRealtors, transactions, revenue] = await Promise.all([
    prisma.realtor.count({ where: { brokerageId, archivedAt: null } }),
    prisma.realtor.count({
      where: { archivedAt: null, NOT: { brokerageId }, history: { some: { brokerageId, endDate: { not: null } } } },
    }),
    prisma.transaction.count({ where: deals }),
    opts.includeFinancials ? prisma.invoiceItem.aggregate({ _sum: { amount: true }, where: billedRevenueWhere(deals) }) : null,
  ]);
  return { currentRealtors, formerRealtors, transactions, associatedRevenue: revenue ? decimalString(revenue._sum.amount) : null };
}

export interface BrokerageTransactionRow extends TransactionRow {
  // This brokerage's realtors on the deal, with their role on it.
  realtors: { id: string; name: string; role: string }[];
}

export async function loadBrokerageTransactions(brokerageId: string, opts: { take: number; includeFinancials: boolean }): Promise<BrokerageTransactionRow[]> {
  const transactions = await prisma.transaction.findMany({
    where: brokerageTransactionWhere(brokerageId),
    orderBy: { createdAt: "desc" },
    take: opts.take,
    include: {
      ...TRANSACTION_INCLUDE,
      realtors: {
        where: { brokerageId },
        orderBy: { createdAt: "asc" },
        include: { realtor: { select: { id: true, firstName: true, lastName: true, preferredName: true } } },
      },
    },
  });
  const revenue = opts.includeFinancials ? await billedRevenueByTransaction(transactions.map((t) => t.id)) : null;
  return transactions.map((t) => ({
    ...toRow(t, revenue),
    realtors: t.realtors.map((tr) => ({ id: tr.realtor.id, name: realtorDisplayName(tr.realtor), role: ROLE_LABELS[tr.role] })),
  }));
}

export interface BrokerageRealtorRow {
  id: string;
  name: string;
  phone: string | null;
  email: string | null;
  // Deals worked while at this brokerage.
  transactions: number;
  since: Date | null;
}

export interface FormerRealtorRow {
  historyId: string;
  id: string;
  name: string;
  startDate: Date;
  endDate: Date;
  nowAt: { id: string; name: string } | null;
}

export async function loadBrokerageRealtors(brokerageId: string, opts: { take?: number } = {}) {
  const [current, dealCounts, openStints, former] = await Promise.all([
    prisma.realtor.findMany({
      where: { brokerageId, archivedAt: null },
      orderBy: [{ lastName: "asc" }, { firstName: "asc" }],
      take: opts.take,
      select: { id: true, firstName: true, lastName: true, preferredName: true, phone: true, email: true },
    }),
    prisma.transactionRealtor.groupBy({ by: ["realtorId"], where: { brokerageId, transaction: { archivedAt: null } }, _count: { transactionId: true } }),
    prisma.realtorBrokerageHistory.findMany({ where: { brokerageId, endDate: null }, select: { realtorId: true, startDate: true } }),
    prisma.realtorBrokerageHistory.findMany({
      where: { brokerageId, endDate: { not: null }, realtor: { archivedAt: null } },
      orderBy: { endDate: "desc" },
      take: 100,
      include: {
        realtor: { select: { id: true, firstName: true, lastName: true, preferredName: true, brokerageId: true, brokerage: { select: { id: true, name: true } } } },
      },
    }),
  ]);
  const deals = new Map(dealCounts.map((g) => [g.realtorId, g._count.transactionId]));
  const since = new Map(openStints.map((h) => [h.realtorId, h.startDate]));

  return {
    current: current.map<BrokerageRealtorRow>((r) => ({
      id: r.id,
      name: realtorDisplayName(r),
      phone: r.phone,
      email: r.email,
      transactions: deals.get(r.id) ?? 0,
      since: since.get(r.id) ?? null,
    })),
    // Someone who left and came back is a current realtor, not a former one.
    former: former
      .filter((h) => h.realtor.brokerageId !== brokerageId)
      .map<FormerRealtorRow>((h) => ({
        historyId: h.id,
        id: h.realtor.id,
        name: realtorDisplayName(h.realtor),
        startDate: h.startDate,
        endDate: h.endDate!,
        nowAt: h.realtor.brokerage,
      })),
  };
}

// ---------------------------------------------------------------------------
// Activity
// ---------------------------------------------------------------------------

export const BROKERAGE_TIMELINE_FILTERS = ["all", "realtors", "transactions", "changes"] as const;
export type BrokerageTimelineFilter = (typeof BROKERAGE_TIMELINE_FILTERS)[number];
export const BROKERAGE_TIMELINE_FILTER_LABELS: Record<BrokerageTimelineFilter, string> = {
  all: "All",
  realtors: "Realtors joining & leaving",
  transactions: "Transactions",
  changes: "Record changes",
};

export function parseBrokerageTimelineFilter(raw: string | undefined): BrokerageTimelineFilter {
  return (BROKERAGE_TIMELINE_FILTERS as readonly string[]).includes(raw ?? "") ? (raw as BrokerageTimelineFilter) : "all";
}

export interface BrokerageTimelineItem {
  id: string;
  at: Date;
  kind: Exclude<BrokerageTimelineFilter, "all">;
  title: string;
  detail: string | null;
  href: string | null;
}

const FIELD_LABELS: Record<string, string> = {
  name: "name",
  phone: "phone",
  email: "email",
  addressLine1: "street address",
  city: "city",
  state: "state",
  zip: "ZIP",
};

const capitalize = (s: string) => s.charAt(0).toUpperCase() + s.slice(1);

// Newest first: realtors joining and leaving, deals its realtors were added
// to, and edits to the brokerage record itself.
export async function loadBrokerageTimeline(brokerageId: string, opts: { limit: number }): Promise<BrokerageTimelineItem[]> {
  const realtorName = { select: { id: true, firstName: true, lastName: true, preferredName: true } } as const;
  const [stints, dealLinks, logs] = await Promise.all([
    prisma.realtorBrokerageHistory.findMany({ where: { brokerageId }, orderBy: { startDate: "desc" }, take: opts.limit, include: { realtor: realtorName } }),
    prisma.transactionRealtor.findMany({
      where: { brokerageId, transaction: { archivedAt: null } },
      orderBy: { createdAt: "desc" },
      take: opts.limit,
      include: { realtor: realtorName, transaction: { select: { id: true, property: { select: { addressLine1: true, city: true } } } } },
    }),
    prisma.activityLog.findMany({
      where: { entityType: "Brokerage", entityId: brokerageId },
      orderBy: { createdAt: "desc" },
      take: opts.limit,
      include: { actor: { select: { name: true } } },
    }),
  ]);

  const items: BrokerageTimelineItem[] = [];
  for (const h of stints) {
    const name = realtorDisplayName(h.realtor);
    items.push({ id: `join-${h.id}`, at: h.startDate, kind: "realtors", title: `${name} joined`, detail: null, href: `/realtors/${h.realtor.id}` });
    if (h.endDate) items.push({ id: `leave-${h.id}`, at: h.endDate, kind: "realtors", title: `${name} left`, detail: null, href: `/realtors/${h.realtor.id}` });
  }
  for (const tr of dealLinks) {
    const property = tr.transaction.property ? `${tr.transaction.property.addressLine1}, ${tr.transaction.property.city}` : "Transaction (no property yet)";
    items.push({
      id: `deal-${tr.id}`,
      at: tr.createdAt,
      kind: "transactions",
      title: property,
      detail: `${realtorDisplayName(tr.realtor)} · ${ROLE_LABELS[tr.role]}`,
      href: `/transactions/${tr.transaction.id}`,
    });
  }
  for (const log of logs) {
    const by = log.actor?.name ? `by ${log.actor.name}` : null;
    if (log.action === "brokerage.created") {
      items.push({ id: `log-${log.id}`, at: log.createdAt, kind: "changes", title: "Brokerage added", detail: by, href: null });
      continue;
    }
    const changes = Object.entries((log.after as Record<string, string | null> | null) ?? {});
    const title = changes.length
      ? changes.map(([field, value]) => (value ? `${capitalize(FIELD_LABELS[field] ?? field)}: ${field === "phone" ? formatPhone(value) : value}` : `${capitalize(FIELD_LABELS[field] ?? field)} cleared`)).join(" · ")
      : "Brokerage updated";
    items.push({ id: `log-${log.id}`, at: log.createdAt, kind: "changes", title, detail: by, href: null });
  }
  return items.sort((a, b) => b.at.getTime() - a.at.getTime()).slice(0, opts.limit);
}

export function filterBrokerageTimeline(items: BrokerageTimelineItem[], filter: BrokerageTimelineFilter) {
  return filter === "all" ? items : items.filter((i) => i.kind === filter);
}
