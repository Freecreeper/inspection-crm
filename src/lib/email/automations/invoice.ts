import type { Prisma, PrismaClient } from "@prisma/client";
import { prisma } from "@/lib/prisma";
import { getPrimaryCustomer } from "@/lib/transactions";
import { invoiceTotals, isInvoiceCollectible } from "@/lib/invoices";
import { enqueueEmail } from "../queue";
import { getAutomation, logAutomationEvent } from "./registry";

type Db = PrismaClient | Prisma.TransactionClient;
const DAY = 86_400_000;

// Which reminder an invoice is due for right now, if any. Deterministic:
// derived only from its due date and the configured schedule. Each stage
// becomes its own idempotency key, so each reminder goes out at most once.
export function invoiceReminderStage(
  dueAt: Date,
  now: Date,
  cfg: { daysBeforeDue: number; overdueRepeatDays: number; maxOverdueReminders: number }
): string | null {
  const untilDue = dueAt.getTime() - now.getTime();
  if (untilDue > cfg.daysBeforeDue * DAY) return null;
  if (untilDue > 0) return "due-soon";
  const overdueNumber = Math.floor(-untilDue / (cfg.overdueRepeatDays * DAY)) + 1;
  return overdueNumber <= cfg.maxOverdueReminders ? `overdue-${overdueNumber}` : null;
}

export async function sweepInvoiceReminders(now: Date, db: Db = prisma) {
  const auto = await getAutomation("payment_reminder", db);
  if (!auto.active) return;

  const invoices = await db.invoice.findMany({
    where: { status: { in: ["SENT", "PARTIALLY_PAID", "OVERDUE"] }, voidedAt: null, dueAt: { not: null } },
    include: { items: true, payments: true, transaction: { include: { customers: { include: { customer: true } } } } },
    take: 1000,
  });

  for (const invoice of invoices) {
    const { balance } = invoiceTotals(invoice);
    if (!isInvoiceCollectible(invoice.status, balance)) continue;
    const stage = invoiceReminderStage(invoice.dueAt!, now, auto.config);
    if (!stage) continue;

    const customer = getPrimaryCustomer(invoice.transaction.customers);
    const result = await enqueueEmail(
      {
        mode: auto.sendMode === "REVIEW" ? "REVIEW" : "AUTOMATIC",
        draft: auto.sendMode === "REVIEW",
        templateKey: auto.config.templateKey,
        recipient: customer
          ? { type: "CUSTOMER", name: `${customer.firstName} ${customer.lastName}`, email: customer.email }
          : { type: "CUSTOMER", name: "No customer on transaction", email: null },
        refs: { customerId: customer?.id, invoiceId: invoice.id, transactionId: invoice.transactionId },
        automationId: auto.row.id,
        idempotencyKey: `invoice:${invoice.id}:reminder:${stage}`,
        guard: { checks: [{ kind: "invoiceCollectible", invoiceId: invoice.id }] },
        now,
      },
      db
    );
    if (result.created) {
      await logAutomationEvent(
        auto.row.id,
        {
          entityType: "Invoice",
          entityId: invoice.id,
          result: result.message.status,
          detail: { emailMessageId: result.message.id, stage, recipient: result.message.recipientName, reason: result.message.statusReason },
        },
        db
      );
    }
  }
}
