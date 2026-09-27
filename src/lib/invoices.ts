import { Prisma, type InvoiceStatus } from "@prisma/client";

// Deterministic invoice math, in Decimal — the only place a balance is
// computed. Never estimated, never inferred.
export interface InvoiceTotals {
  total: Prisma.Decimal;
  paid: Prisma.Decimal;
  balance: Prisma.Decimal;
}

export function invoiceTotals(invoice: { items: { amount: Prisma.Decimal }[]; payments: { amount: Prisma.Decimal }[] }): InvoiceTotals {
  const sum = (rows: { amount: Prisma.Decimal }[]) => rows.reduce((acc, r) => acc.plus(r.amount), new Prisma.Decimal(0));
  const total = sum(invoice.items);
  const paid = sum(invoice.payments);
  return { total, paid, balance: total.minus(paid) };
}

// Only issued invoices with money still owed can be reminded. Drafts
// haven't been sent; void and paid invoices are closed.
export function isInvoiceCollectible(status: InvoiceStatus, balance: Prisma.Decimal): boolean {
  return (status === "SENT" || status === "PARTIALLY_PAID" || status === "OVERDUE") && balance.greaterThan(0);
}

// What recording a payment should set the status to.
export function statusAfterPayment(current: InvoiceStatus, balance: Prisma.Decimal): InvoiceStatus {
  if (current === "VOID" || current === "DRAFT") return current;
  if (balance.lessThanOrEqualTo(0)) return "PAID";
  return "PARTIALLY_PAID";
}

const usd = new Intl.NumberFormat("en-US", { style: "currency", currency: "USD" });

export function formatMoney(value: Prisma.Decimal | string | number): string {
  return usd.format(Number(value.toString()));
}
