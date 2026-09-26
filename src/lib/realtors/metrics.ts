import { Prisma, type InvoiceStatus } from "@prisma/client";
import { prisma } from "@/lib/prisma";

// Revenue here means billed revenue: the line-item total of every invoice
// that has actually gone out (not a draft) and hasn't been voided. It is
// computed from InvoiceItem amounts with Decimal arithmetic in the
// database — never from floats, and never estimated.
export const BILLED_INVOICE_STATUSES: InvoiceStatus[] = ["SENT", "PAID", "PARTIALLY_PAID", "OVERDUE"];

// "Associated": the Realtor was on the deal in some Realtor role. A realtor
// on a transaction twice (e.g. listing agent and coordinator) still counts
// it once — `some` matches the transaction, not the join rows.
export function associatedTransactionWhere(realtorId: string): Prisma.TransactionWhereInput {
  return { archivedAt: null, realtors: { some: { realtorId } } };
}

// "Referred": the transaction's recorded referral source *is* this Realtor.
// This is the only path to referral attribution — association never implies it.
export function referredTransactionWhere(realtorId: string): Prisma.TransactionWhereInput {
  return { archivedAt: null, referralSource: { realtorId } };
}

export function billedRevenueWhere(transaction: Prisma.TransactionWhereInput): Prisma.InvoiceItemWhereInput {
  return { invoice: { status: { in: BILLED_INVOICE_STATUSES }, transaction } };
}

export interface RealtorMetrics {
  associatedTransactions: number;
  referrals: number;
  customersReferred: number;
  // null when the viewer lacks financial:read — the value is never computed,
  // not merely hidden.
  associatedRevenue: string | null;
  referralRevenue: string | null;
}

export async function getRealtorMetrics(realtorId: string, opts: { includeFinancials: boolean }): Promise<RealtorMetrics> {
  const associated = associatedTransactionWhere(realtorId);
  const referred = referredTransactionWhere(realtorId);

  const [associatedTransactions, referrals, referredCustomers, associatedRevenue, referralRevenue] = await Promise.all([
    prisma.transaction.count({ where: associated }),
    prisma.transaction.count({ where: referred }),
    prisma.transactionCustomer.groupBy({ by: ["customerId"], where: { transaction: referred } }),
    opts.includeFinancials
      ? prisma.invoiceItem.aggregate({ _sum: { amount: true }, where: billedRevenueWhere(associated) })
      : null,
    opts.includeFinancials
      ? prisma.invoiceItem.aggregate({ _sum: { amount: true }, where: billedRevenueWhere(referred) })
      : null,
  ]);

  return {
    associatedTransactions,
    referrals,
    customersReferred: referredCustomers.length,
    associatedRevenue: associatedRevenue ? decimalString(associatedRevenue._sum.amount) : null,
    referralRevenue: referralRevenue ? decimalString(referralRevenue._sum.amount) : null,
  };
}

export function decimalString(value: Prisma.Decimal | null | undefined): string {
  return (value ?? new Prisma.Decimal(0)).toFixed(2);
}

// Per-transaction billed revenue for a set of transactions, in one query.
export async function billedRevenueByTransaction(transactionIds: string[]): Promise<Map<string, string>> {
  const totals = new Map<string, string>();
  if (transactionIds.length === 0) return totals;
  const invoices = await prisma.invoice.findMany({
    where: { transactionId: { in: transactionIds }, status: { in: BILLED_INVOICE_STATUSES } },
    select: { transactionId: true, items: { select: { amount: true } } },
  });
  return sumInvoicesByTransaction(invoices);
}

export function sumInvoicesByTransaction(
  invoices: { transactionId: string; items: { amount: Prisma.Decimal }[] }[]
): Map<string, string> {
  const sums = new Map<string, Prisma.Decimal>();
  for (const invoice of invoices) {
    let total = sums.get(invoice.transactionId) ?? new Prisma.Decimal(0);
    for (const item of invoice.items) total = total.plus(item.amount);
    sums.set(invoice.transactionId, total);
  }
  return new Map([...sums].map(([id, total]) => [id, total.toFixed(2)]));
}
