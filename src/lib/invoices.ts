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

// Money as typed by staff: digits, optional cents, optional $ and commas.
// Anything else (including "NaN" or "Infinity", which Decimal would accept
// and every comparison would then wave through) is refused.
const AMOUNT = /^\d{1,8}(\.\d{1,2})?$/;

export function parsePaymentAmount(raw: string): Prisma.Decimal | null {
  const cleaned = raw.trim().replace(/[$,\s]/g, "");
  if (!AMOUNT.test(cleaned)) return null;
  const amount = new Prisma.Decimal(cleaned);
  return amount.isFinite() && amount.greaterThan(0) ? amount : null;
}
