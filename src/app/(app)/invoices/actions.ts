"use server";

import { revalidatePath } from "next/cache";
import type { InvoiceStatus, PaymentMethod, Prisma, Role } from "@prisma/client";
import { prisma } from "@/lib/prisma";
import { auth } from "@/lib/auth";
import { assertCan } from "@/lib/rbac";
import { logActivity } from "@/lib/activity";
import {
  defaultInvoiceDueDay,
  invoiceDueAt,
  invoiceNumberAfter,
  invoiceTotals,
  isInvoiceEditable,
  MAX_INVOICE_ITEMS,
  MAX_ITEM_DESCRIPTION,
  parseLineAmount,
  parsePaymentAmount,
  statusAfterPayment,
} from "@/lib/invoices";
import { cancelPendingEmails } from "@/lib/email/queue";
import { getCalendarConfig } from "@/lib/calendar/config";
import { isDayKey, toDayKey } from "@/lib/calendar/time";

const METHODS: PaymentMethod[] = ["CARD", "ACH", "CHECK", "CASH", "OTHER"];

export type PaymentResult = { ok: true } | { ok: false; error: string };

// Recording a payment recalculates the balance from the invoice's own
// items and payments (never from anything the browser sends besides the
// amount), updates the status, and — once nothing is owed — withdraws any
// payment reminder that hasn't gone out. Reminders also re-check the
// balance at send time, so a missed withdrawal still can't send.
export async function recordPayment(invoiceId: string, input: { amount: string; method: string; reference?: string }): Promise<PaymentResult> {
  const session = await auth();
  assertCan(session?.user?.role as Role | undefined, "invoice:create");

  const amount = parsePaymentAmount(String(input.amount ?? ""));
  if (!amount) return { ok: false, error: "Enter an amount greater than $0 with at most 2 decimals." };
  if (!METHODS.includes(input.method as PaymentMethod)) return { ok: false, error: "Pick a payment method." };

  // The balance is checked and the payment written under a lock on the
  // invoice row, so two payments recorded at once can't both pass the
  // balance check and overpay.
  const outcome = await prisma.$transaction(async (tx): Promise<PaymentResult & { transactionId?: string }> => {
    const locked = await tx.$queryRaw<{ id: string }[]>`SELECT "id" FROM "invoices" WHERE "id" = ${invoiceId} FOR UPDATE`;
    if (locked.length === 0) return { ok: false, error: "Invoice not found." };
    const invoice = await tx.invoice.findUnique({ where: { id: invoiceId }, include: { items: true, payments: true } });
    if (!invoice) return { ok: false, error: "Invoice not found." };
    if (invoice.status === "VOID" || invoice.status === "DRAFT") return { ok: false, error: `A ${invoice.status.toLowerCase()} invoice can't take payments.` };
    const { balance } = invoiceTotals(invoice);
    if (amount.greaterThan(balance)) return { ok: false, error: "That's more than the balance due." };

    const newBalance = balance.minus(amount);
    const status = statusAfterPayment(invoice.status, newBalance);
    await tx.payment.create({
      data: { invoiceId, amount, method: input.method as PaymentMethod, reference: input.reference?.trim() || null },
    });
    await tx.invoice.update({ where: { id: invoiceId }, data: { status } });
    await logActivity(tx, {
      actorId: session?.user?.id,
      action: "invoice.payment_recorded",
      entityType: "Invoice",
      entityId: invoiceId,
      after: { amount: amount.toFixed(2), method: input.method, status, balance: newBalance.toFixed(2) },
    });
    if (newBalance.lessThanOrEqualTo(0)) await cancelPendingEmails({ invoiceId }, "Invoice paid", tx);
    return { ok: true, transactionId: invoice.transactionId };
  });

  if (!outcome.ok) return outcome;
  revalidatePath(`/transactions/${outcome.transactionId}`);
  revalidatePath("/invoices");
  return { ok: true };
}

// ---------------------------------------------------------------------------
// Creating and editing invoices. An invoice starts as a draft (prefilled
// from an inspection's services, at the prices snapshotted when it was
// scheduled), is edited freely while a draft, and is then issued. Issued
// invoices are never edited: they're voided and replaced. Every change is
// made under a lock on the invoice row and recorded in the activity log.
// ---------------------------------------------------------------------------

export type InvoiceResult<T = undefined> = { ok: true; data: T } | { ok: false; error: string };

type Tx = Prisma.TransactionClient;
type LockedInvoice = Prisma.InvoiceGetPayload<{ include: { items: true; payments: true } }>;

class InvoiceError extends Error {}

async function requireBilling(permission: "invoice:create" | "invoice:void" = "invoice:create") {
  const session = await auth();
  assertCan(session?.user?.role as Role | undefined, permission);
  return session?.user?.id ?? null;
}

async function withLockedInvoice<T>(invoiceId: string, fn: (tx: Tx, invoice: LockedInvoice) => Promise<T>): Promise<InvoiceResult<T> & { transactionId?: string }> {
  try {
    return await prisma.$transaction(async (tx) => {
      const locked = await tx.$queryRaw<{ id: string }[]>`SELECT "id" FROM "invoices" WHERE "id" = ${invoiceId} FOR UPDATE`;
      if (locked.length === 0) throw new InvoiceError("Invoice not found.");
      const invoice = await tx.invoice.findUnique({ where: { id: invoiceId }, include: { items: true, payments: true } });
      if (!invoice) throw new InvoiceError("Invoice not found.");
      return { ok: true as const, data: await fn(tx, invoice), transactionId: invoice.transactionId };
    });
  } catch (err) {
    if (err instanceof InvoiceError) return { ok: false, error: err.message };
    throw err;
  }
}

function requireDraft(invoice: LockedInvoice) {
  if (!isInvoiceEditable(invoice.status)) throw new InvoiceError("Only a draft invoice can be changed. Void it and create a new one instead.");
}

function refresh(invoiceId: string, transactionId?: string) {
  revalidatePath(`/invoices/${invoiceId}`);
  revalidatePath("/invoices");
  if (transactionId) revalidatePath(`/transactions/${transactionId}`);
}

function parseLine(input: { description?: string; amount?: string }): { description: string; amount: Prisma.Decimal } {
  const description = String(input.description ?? "").trim();
  if (!description) throw new InvoiceError("Enter a description.");
  if (description.length > MAX_ITEM_DESCRIPTION) throw new InvoiceError(`Keep the description under ${MAX_ITEM_DESCRIPTION} characters.`);
  const amount = parseLineAmount(String(input.amount ?? ""));
  if (!amount) throw new InvoiceError("Enter an amount like 450 or 450.00 (use a minus sign for a discount).");
  return { description, amount };
}

// The next INV-#### number. Numbers are handed out one at a time under a
// lock, so two invoices created at once can't take the same one (and the
// unique constraint backs that up).
async function allocateInvoiceNumber(tx: Tx): Promise<string> {
  await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext('invoice-number'))`;
  const [row] = await tx.$queryRaw<{ highest: number | null }[]>`
    SELECT MAX(CAST(SUBSTRING("invoiceNumber" FROM 5) AS INTEGER)) AS "highest"
    FROM "invoices" WHERE "invoiceNumber" ~ '^INV-[0-9]{1,9}$'`;
  return invoiceNumberAfter(row?.highest ?? null);
}

// Creates a draft for a transaction, optionally for one of its inspections
// (lines prefilled from that inspection's services). An inspection gets
// one live invoice: asking again — a double click, a second tab — opens
// the one that exists instead of creating a duplicate.
export async function createInvoice(input: { transactionId: string; inspectionId?: string | null }): Promise<InvoiceResult<{ id: string; existing: boolean }>> {
  const actorId = await requireBilling();
  const transaction = await prisma.transaction.findUnique({ where: { id: input.transactionId }, select: { id: true, archivedAt: true } });
  if (!transaction || transaction.archivedAt) return { ok: false, error: "Transaction not found." };

  const inspection = input.inspectionId
    ? await prisma.inspection.findFirst({
        where: { id: input.inspectionId, transactionId: transaction.id },
        include: { inspectionServices: { include: { service: { select: { name: true } } }, orderBy: { createdAt: "asc" } } },
      })
    : null;
  if (input.inspectionId && !inspection) return { ok: false, error: "That inspection isn't on this transaction." };

  const { timeZone } = getCalendarConfig();
  const today = toDayKey(new Date(), timeZone);
  const dueDay = defaultInvoiceDueDay(today, inspection?.scheduledAt ? toDayKey(inspection.scheduledAt, timeZone) : null);

  const result = await prisma.$transaction(async (tx) => {
    if (inspection) {
      await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${`invoice-inspection:${inspection.id}`}))`;
      const existing = await tx.invoice.findFirst({ where: { inspectionId: inspection.id, status: { not: "VOID" } }, select: { id: true } });
      if (existing) return { id: existing.id, existing: true };
    }
    const invoiceNumber = await allocateInvoiceNumber(tx);
    const items = (inspection?.inspectionServices ?? []).map((s) => ({ description: s.service.name, amount: s.price }));
    const created = await tx.invoice.create({
      data: {
        transactionId: transaction.id,
        inspectionId: inspection?.id ?? null,
        invoiceNumber,
        status: "DRAFT",
        dueAt: invoiceDueAt(dueDay, timeZone),
        items: { create: items },
      },
      select: { id: true },
    });
    await logActivity(tx, {
      actorId,
      action: "invoice.created",
      entityType: "Invoice",
      entityId: created.id,
      after: { invoiceNumber, transactionId: transaction.id, inspectionId: inspection?.id ?? null, items: items.map((i) => ({ description: i.description, amount: i.amount.toFixed(2) })) },
    });
    return { id: created.id, existing: false };
  });

  refresh(result.id, transaction.id);
  return { ok: true, data: result };
}

export async function addInvoiceItem(invoiceId: string, input: { description: string; amount: string }): Promise<InvoiceResult> {
  const actorId = await requireBilling();
  const result = await withLockedInvoice(invoiceId, async (tx, invoice) => {
    requireDraft(invoice);
    if (invoice.items.length >= MAX_INVOICE_ITEMS) throw new InvoiceError(`An invoice can have at most ${MAX_INVOICE_ITEMS} lines.`);
    const line = parseLine(input);
    await tx.invoiceItem.create({ data: { invoiceId, ...line } });
    await logActivity(tx, { actorId, action: "invoice.item_added", entityType: "Invoice", entityId: invoiceId, after: { description: line.description, amount: line.amount.toFixed(2) } });
    return undefined;
  });
  if (result.ok) refresh(invoiceId, result.transactionId);
  return result.ok ? { ok: true, data: undefined } : result;
}

export async function updateInvoiceItem(itemId: string, input: { description: string; amount: string }): Promise<InvoiceResult> {
  const actorId = await requireBilling();
  const item = await prisma.invoiceItem.findUnique({ where: { id: itemId }, select: { invoiceId: true } });
  if (!item) return { ok: false, error: "That line no longer exists." };
  const result = await withLockedInvoice(item.invoiceId, async (tx, invoice) => {
    requireDraft(invoice);
    const before = invoice.items.find((i) => i.id === itemId);
    if (!before) throw new InvoiceError("That line no longer exists.");
    const line = parseLine(input);
    await tx.invoiceItem.update({ where: { id: itemId }, data: line });
    await logActivity(tx, {
      actorId,
      action: "invoice.item_updated",
      entityType: "Invoice",
      entityId: invoice.id,
      before: { description: before.description, amount: before.amount.toFixed(2) },
      after: { description: line.description, amount: line.amount.toFixed(2) },
    });
    return undefined;
  });
  if (result.ok) refresh(item.invoiceId, result.transactionId);
  return result.ok ? { ok: true, data: undefined } : result;
}

export async function removeInvoiceItem(itemId: string): Promise<InvoiceResult> {
  const actorId = await requireBilling();
  const item = await prisma.invoiceItem.findUnique({ where: { id: itemId }, select: { invoiceId: true } });
  if (!item) return { ok: true, data: undefined };
  const result = await withLockedInvoice(item.invoiceId, async (tx, invoice) => {
    requireDraft(invoice);
    const before = invoice.items.find((i) => i.id === itemId);
    if (!before) return undefined;
    await tx.invoiceItem.delete({ where: { id: itemId } });
    await logActivity(tx, { actorId, action: "invoice.item_removed", entityType: "Invoice", entityId: invoice.id, before: { description: before.description, amount: before.amount.toFixed(2) } });
    return undefined;
  });
  if (result.ok) refresh(item.invoiceId, result.transactionId);
  return result.ok ? { ok: true, data: undefined } : result;
}

// "" clears the due date (due upon receipt). Allowed while money is still
// owed — moving a due date doesn't change what was billed.
export async function setInvoiceDueDate(invoiceId: string, day: string): Promise<InvoiceResult> {
  const actorId = await requireBilling();
  if (day && !isDayKey(day)) return { ok: false, error: "Pick a valid date." };
  const { timeZone } = getCalendarConfig();
  const result = await withLockedInvoice(invoiceId, async (tx, invoice) => {
    if (invoice.status === "VOID" || invoice.status === "PAID") throw new InvoiceError(`A ${invoice.status === "VOID" ? "void" : "paid"} invoice's due date can't change.`);
    const dueAt = day ? invoiceDueAt(day, timeZone) : null;
    await tx.invoice.update({ where: { id: invoiceId }, data: { dueAt } });
    await logActivity(tx, { actorId, action: "invoice.due_date_changed", entityType: "Invoice", entityId: invoiceId, before: { dueAt: invoice.dueAt?.toISOString() ?? null }, after: { dueAt: dueAt?.toISOString() ?? null } });
    return undefined;
  });
  if (result.ok) refresh(invoiceId, result.transactionId);
  return result.ok ? { ok: true, data: undefined } : result;
}

// Draft → issued. Issuing doesn't email anyone by itself; "Email invoice"
// on the invoice page opens the composer so staff see what goes out.
export async function issueInvoice(invoiceId: string): Promise<InvoiceResult> {
  const actorId = await requireBilling();
  const result = await withLockedInvoice(invoiceId, async (tx, invoice) => {
    if (invoice.status !== "DRAFT") throw new InvoiceError("This invoice has already been issued.");
    if (invoice.items.length === 0) throw new InvoiceError("Add at least one line before issuing.");
    const { total } = invoiceTotals(invoice);
    if (!total.greaterThan(0)) throw new InvoiceError("The total must be more than $0.00 to issue.");
    const issuedAt = new Date();
    await tx.invoice.update({ where: { id: invoiceId }, data: { status: "SENT", issuedAt } });
    await logActivity(tx, { actorId, action: "invoice.issued", entityType: "Invoice", entityId: invoiceId, after: { total: total.toFixed(2), issuedAt: issuedAt.toISOString(), dueAt: invoice.dueAt?.toISOString() ?? null } });
    return undefined;
  });
  if (result.ok) refresh(invoiceId, result.transactionId);
  return result.ok ? { ok: true, data: undefined } : result;
}

// A draft was never sent, so it can simply be deleted.
export async function deleteDraftInvoice(invoiceId: string): Promise<InvoiceResult<{ transactionId: string }>> {
  const actorId = await requireBilling();
  const result = await withLockedInvoice(invoiceId, async (tx, invoice) => {
    if (invoice.status !== "DRAFT") throw new InvoiceError("Only a draft can be deleted. Void an issued invoice instead.");
    if (invoice.payments.length > 0 || (await tx.emailMessage.count({ where: { invoiceId } })) > 0) {
      throw new InvoiceError("This draft has payments or emails linked to it. Void it instead.");
    }
    await tx.invoiceItem.deleteMany({ where: { invoiceId } });
    await tx.invoice.delete({ where: { id: invoiceId } });
    await logActivity(tx, {
      actorId,
      action: "invoice.draft_deleted",
      entityType: "Invoice",
      entityId: invoiceId,
      before: { invoiceNumber: invoice.invoiceNumber, items: invoice.items.map((i) => ({ description: i.description, amount: i.amount.toFixed(2) })) },
    });
    return { transactionId: invoice.transactionId };
  });
  if (result.ok) refresh(invoiceId, result.transactionId);
  return result.ok ? { ok: true, data: result.data } : result;
}

const VOIDABLE: InvoiceStatus[] = ["SENT", "OVERDUE"];

// Voiding cancels an issued invoice that nothing has been paid on, and
// withdraws any reminder that hasn't gone out. An invoice with payments
// isn't voided here: refund the payment first.
export async function voidInvoice(invoiceId: string, reason?: string): Promise<InvoiceResult> {
  const actorId = await requireBilling("invoice:void");
  const result = await withLockedInvoice(invoiceId, async (tx, invoice) => {
    if (invoice.status === "VOID") return undefined;
    if (invoice.status === "DRAFT") throw new InvoiceError("Delete a draft instead of voiding it.");
    if (invoice.payments.length > 0 || !VOIDABLE.includes(invoice.status)) {
      throw new InvoiceError("This invoice has payments recorded, so it can't be voided. Refund the payment first.");
    }
    const note = String(reason ?? "").trim().slice(0, 300) || null;
    await tx.invoice.update({ where: { id: invoiceId }, data: { status: "VOID", voidedAt: new Date() } });
    await cancelPendingEmails({ invoiceId }, "Invoice voided", tx);
    await logActivity(tx, { actorId, action: "invoice.voided", entityType: "Invoice", entityId: invoiceId, before: { status: invoice.status }, after: { status: "VOID", reason: note } });
    return undefined;
  });
  if (result.ok) refresh(invoiceId, result.transactionId);
  return result.ok ? { ok: true, data: undefined } : result;
}
