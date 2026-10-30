import { Prisma, type InvoiceStatus } from "@prisma/client";
import { addDays, zonedDateTimeToUtc, type DayKey } from "@/lib/calendar/time";

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

// A line as typed on an invoice: like a payment amount, but a negative
// line is allowed (a discount). Zero lines say nothing, so they're refused.
const LINE_AMOUNT = /^-?\d{1,8}(\.\d{1,2})?$/;

export function parseLineAmount(raw: string): Prisma.Decimal | null {
  const cleaned = raw.trim().replace(/[$,\s]/g, "");
  if (!LINE_AMOUNT.test(cleaned)) return null;
  const amount = new Prisma.Decimal(cleaned);
  return amount.isFinite() && !amount.isZero() ? amount : null;
}

export const MAX_INVOICE_ITEMS = 50;
export const MAX_ITEM_DESCRIPTION = 200;

// Invoice numbers run INV-1001, INV-1002, … Anything not in that exact
// shape (e.g. imported or test numbers) is left out of the sequence.
export const FIRST_INVOICE_NUMBER = 1001;

export function invoiceNumberAfter(highest: number | null): string {
  return `INV-${Math.max(highest ?? 0, FIRST_INVOICE_NUMBER - 1) + 1}`;
}

// Only a draft's lines and amounts can change; once issued, an invoice is
// corrected by voiding it and issuing a new one.
export function isInvoiceEditable(status: InvoiceStatus): boolean {
  return status === "DRAFT";
}

// The suggested due date: the inspection day while it's still ahead (pay at
// or before the visit), otherwise a week from today.
export function defaultInvoiceDueDay(today: DayKey, inspectionDay: DayKey | null): DayKey {
  return inspectionDay && inspectionDay >= today ? inspectionDay : addDays(today, 7);
}

// A due date is a calendar day; it's stored at the end of that day in the
// business time zone, so "overdue" starts the next morning.
export function invoiceDueAt(day: DayKey, timeZone: string): Date {
  return zonedDateTimeToUtc(day, "23:59", timeZone);
}

export const INVOICE_STATUS_LABELS: Record<InvoiceStatus, string> = {
  DRAFT: "Draft",
  SENT: "Issued",
  PARTIALLY_PAID: "Partly paid",
  PAID: "Paid",
  OVERDUE: "Overdue",
  VOID: "Void",
};
