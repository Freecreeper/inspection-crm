import { Prisma, type RealtorParticipantRole } from "@prisma/client";
import { prisma } from "@/lib/prisma";
import { getPrimaryCustomer } from "@/lib/transactions";
import { associatedTransactionWhere, billedRevenueByTransaction, decimalString, referredTransactionWhere } from "./metrics";

export const ROLE_LABELS: Record<RealtorParticipantRole, string> = {
  BUYER_AGENT: "Buyer agent",
  LISTING_AGENT: "Listing agent",
  TRANSACTION_COORDINATOR: "Transaction coordinator",
  OTHER: "Other",
};

const TRANSACTION_INCLUDE = {
  property: true,
  customers: { include: { customer: true }, orderBy: { createdAt: "asc" } },
  inspections: { orderBy: [{ scheduledAt: { sort: "desc", nulls: "last" } }, { createdAt: "desc" }], take: 1 },
} satisfies Prisma.TransactionInclude;

type TransactionWithDetails = Prisma.TransactionGetPayload<{ include: typeof TRANSACTION_INCLUDE }>;

export interface TransactionRow {
  id: string;
  property: string | null;
  customers: string[];
  primaryCustomer: string | null;
  status: string;
  inspectionStatus: string | null;
  inspectionDate: Date | null;
  createdAt: Date;
  revenue: string | null;
}

function toRow(t: TransactionWithDetails, revenue: Map<string, string> | null): TransactionRow {
  const primary = getPrimaryCustomer(t.customers);
  const inspection = t.inspections[0];
  return {
    id: t.id,
    property: t.property ? `${t.property.addressLine1}, ${t.property.city}` : null,
    customers: t.customers.map((tc) => `${tc.customer.firstName} ${tc.customer.lastName}`),
    primaryCustomer: primary ? `${primary.firstName} ${primary.lastName}` : null,
    status: t.status,
    inspectionStatus: inspection?.status ?? null,
    inspectionDate: inspection ? (inspection.completedAt ?? inspection.scheduledAt) : null,
    createdAt: t.createdAt,
    revenue: revenue ? (revenue.get(t.id) ?? "0.00") : null,
  };
}

export interface AssociatedTransactionRow extends TransactionRow {
  roles: string[];
  // The brokerage snapshotted when they joined *this* deal — not their
  // current one — so a realtor who has since moved firms still shows the
  // firm they were actually with on it.
  brokerageAtTheTime: string | null;
}

// Every transaction the realtor participated in, one row per transaction
// even if they held more than one role on it.
export async function loadAssociatedTransactions(
  realtorId: string,
  opts: { take: number; includeFinancials: boolean }
): Promise<AssociatedTransactionRow[]> {
  const transactions = await prisma.transaction.findMany({
    where: associatedTransactionWhere(realtorId),
    orderBy: { createdAt: "desc" },
    take: opts.take,
    include: { ...TRANSACTION_INCLUDE, realtors: { where: { realtorId }, orderBy: { createdAt: "asc" } } },
  });
  const revenue = opts.includeFinancials ? await billedRevenueByTransaction(transactions.map((t) => t.id)) : null;
  return transactions.map((t) => ({
    ...toRow(t, revenue),
    roles: t.realtors.map((tr) => ROLE_LABELS[tr.role]),
    brokerageAtTheTime: t.realtors[0]?.brokerageName ?? null,
  }));
}

// Only transactions whose recorded referral source is linked to this
// realtor — being on the deal is never enough to count here.
export async function loadReferredTransactions(
  realtorId: string,
  opts: { take: number; includeFinancials: boolean }
): Promise<TransactionRow[]> {
  const transactions = await prisma.transaction.findMany({
    where: referredTransactionWhere(realtorId),
    orderBy: { createdAt: "desc" },
    take: opts.take,
    include: TRANSACTION_INCLUDE,
  });
  const revenue = opts.includeFinancials ? await billedRevenueByTransaction(transactions.map((t) => t.id)) : null;
  return transactions.map((t) => toRow(t, revenue));
}

export async function countCompletedReferralInspections(realtorId: string): Promise<number> {
  return prisma.inspection.count({ where: { status: "COMPLETED", transaction: referredTransactionWhere(realtorId) } });
}

export async function loadRealtorDocuments(realtorId: string, take: number) {
  return prisma.document.findMany({
    where: { transaction: { OR: [associatedTransactionWhere(realtorId), referredTransactionWhere(realtorId)] } },
    orderBy: { createdAt: "desc" },
    take,
    include: { transaction: { include: { property: true } } },
  });
}

// ---------------------------------------------------------------------------
// Analytics
// ---------------------------------------------------------------------------

export interface MonthCount {
  month: string; // YYYY-MM
  label: string;
  count: number;
}

export function monthlyCounts(dates: Date[], now: Date, months: number): MonthCount[] {
  const buckets: MonthCount[] = [];
  for (let i = months - 1; i >= 0; i--) {
    const d = new Date(now.getFullYear(), now.getMonth() - i, 1);
    buckets.push({
      month: `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}`,
      label: d.toLocaleDateString("en-US", { month: "short", year: "2-digit" }),
      count: 0,
    });
  }
  const index = new Map(buckets.map((b, i) => [b.month, i]));
  for (const date of dates) {
    const key = `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}`;
    const i = index.get(key);
    if (i !== undefined) buckets[i].count++;
  }
  return buckets;
}

export async function loadRealtorAnalytics(realtorId: string, opts: { includeFinancials: boolean; now?: Date }) {
  const now = opts.now ?? new Date();
  const since = new Date(now.getFullYear(), now.getMonth() - 11, 1);
  const referred = referredTransactionWhere(realtorId);
  const associated = associatedTransactionWhere(realtorId);
  const completedAssociated: Prisma.InspectionWhereInput = { status: "COMPLETED", transaction: associated };

  const [completedReferralInspections, referralDates, serviceGroups, recentReferred, inspectionValue, pricedInspections] = await Promise.all([
    countCompletedReferralInspections(realtorId),
    prisma.transaction.findMany({ where: { ...referred, createdAt: { gte: since } }, select: { createdAt: true } }),
    prisma.inspectionService.groupBy({
      by: ["serviceId"],
      where: { inspection: { transaction: referred } },
      _count: { _all: true },
      _sum: { price: true },
    }),
    prisma.transactionCustomer.findMany({
      where: { transaction: referred },
      orderBy: { createdAt: "desc" },
      take: 5,
      include: { customer: true, transaction: { include: { property: true } } },
    }),
    opts.includeFinancials ? prisma.inspectionService.aggregate({ _sum: { price: true }, where: { inspection: completedAssociated } }) : null,
    opts.includeFinancials ? prisma.inspection.count({ where: { ...completedAssociated, inspectionServices: { some: {} } } }) : 0,
  ]);

  const services = serviceGroups.length
    ? await prisma.service.findMany({ where: { id: { in: serviceGroups.map((g) => g.serviceId) } }, select: { id: true, name: true } })
    : [];
  const serviceName = new Map(services.map((s) => [s.id, s.name]));

  // Average of what completed inspections on their deals were priced at
  // (sum of that inspection's service prices) — only shown when there is
  // at least one priced inspection to average.
  const averageInspectionValue =
    inspectionValue && pricedInspections > 0
      ? (inspectionValue._sum.price ?? new Prisma.Decimal(0)).dividedBy(pricedInspections).toFixed(2)
      : null;

  return {
    completedReferralInspections,
    referralsByMonth: monthlyCounts(
      referralDates.map((t) => t.createdAt),
      now,
      12
    ),
    servicesOnReferred: serviceGroups
      .map((g) => ({
        name: serviceName.get(g.serviceId) ?? "Unknown service",
        count: g._count._all,
        total: opts.includeFinancials ? decimalString(g._sum.price) : null,
      }))
      .sort((a, b) => b.count - a.count),
    recentReferredCustomers: recentReferred.map((tc) => ({
      id: tc.id,
      customerId: tc.customerId,
      name: `${tc.customer.firstName} ${tc.customer.lastName}`,
      transactionId: tc.transactionId,
      property: tc.transaction.property ? `${tc.transaction.property.addressLine1}, ${tc.transaction.property.city}` : null,
      date: tc.createdAt,
    })),
    averageInspectionValue,
  };
}
