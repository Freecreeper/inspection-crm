"use server";

import { revalidatePath } from "next/cache";
import { Prisma, type PaymentMethod, type Role } from "@prisma/client";
import { prisma } from "@/lib/prisma";
import { auth } from "@/lib/auth";
import { assertCan } from "@/lib/rbac";
import { logActivity } from "@/lib/activity";
import { invoiceTotals, statusAfterPayment } from "@/lib/invoices";
import { cancelPendingEmails } from "@/lib/email/queue";

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

  let amount: Prisma.Decimal;
  try {
    amount = new Prisma.Decimal(input.amount.trim().replace(/[$,]/g, ""));
  } catch {
    return { ok: false, error: "Enter a valid amount." };
  }
  if (amount.lessThanOrEqualTo(0) || amount.decimalPlaces() > 2) return { ok: false, error: "Enter an amount greater than $0 with at most 2 decimals." };
  if (!METHODS.includes(input.method as PaymentMethod)) return { ok: false, error: "Pick a payment method." };

  const invoice = await prisma.invoice.findUnique({ where: { id: invoiceId }, include: { items: true, payments: true } });
  if (!invoice) return { ok: false, error: "Invoice not found." };
  if (invoice.status === "VOID" || invoice.status === "DRAFT") return { ok: false, error: `A ${invoice.status.toLowerCase()} invoice can't take payments.` };
  const { balance } = invoiceTotals(invoice);
  if (amount.greaterThan(balance)) return { ok: false, error: "That's more than the balance due." };

  const newBalance = balance.minus(amount);
  const status = statusAfterPayment(invoice.status, newBalance);

  await prisma.$transaction(async (tx) => {
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
  });

  revalidatePath(`/transactions/${invoice.transactionId}`);
  return { ok: true };
}
