import type { EmailRecipientType } from "@prisma/client";
import { prisma } from "@/lib/prisma";
import { realtorDisplayName } from "@/lib/realtors/display";
import { getPrimaryCustomer } from "@/lib/transactions";
import type { EmailRefs } from "./context";

// Where the composer was opened from. The server — not the browser —
// decides who can be emailed from each context and what the email links to.
export type ComposeContext =
  | { kind: "realtor"; id: string }
  | { kind: "customer"; id: string }
  | { kind: "transaction"; id: string }
  | { kind: "inspection"; id: string }
  | { kind: "invoice"; id: string };

export interface ComposeRecipient {
  key: string;
  type: EmailRecipientType;
  name: string;
  email: string | null;
  label: string;
  refs: EmailRefs;
}

export function parseComposeContext(raw: unknown): ComposeContext | null {
  if (!raw || typeof raw !== "object") return null;
  const { kind, id } = raw as { kind?: unknown; id?: unknown };
  if (typeof id !== "string" || !id) return null;
  if (kind === "realtor" || kind === "customer" || kind === "transaction" || kind === "inspection" || kind === "invoice") return { kind, id };
  return null;
}

export async function listComposeRecipients(context: ComposeContext): Promise<ComposeRecipient[]> {
  if (context.kind === "realtor") {
    const r = await prisma.realtor.findFirst({ where: { id: context.id, archivedAt: null } });
    return r ? [{ key: `realtor:${r.id}`, type: "REALTOR", name: realtorDisplayName(r), email: r.email, label: "Realtor", refs: { realtorId: r.id } }] : [];
  }
  if (context.kind === "customer") {
    const c = await prisma.customer.findFirst({ where: { id: context.id, archivedAt: null } });
    return c ? [{ key: `customer:${c.id}`, type: "CUSTOMER", name: `${c.firstName} ${c.lastName}`, email: c.email, label: "Customer", refs: { customerId: c.id } }] : [];
  }

  let transactionId: string;
  let extraRefs: EmailRefs = {};
  let onlyPrimaryCustomer = false;
  if (context.kind === "inspection") {
    const inspection = await prisma.inspection.findUnique({ where: { id: context.id }, select: { transactionId: true } });
    if (!inspection) return [];
    transactionId = inspection.transactionId;
    extraRefs = { inspectionId: context.id };
  } else if (context.kind === "invoice") {
    const invoice = await prisma.invoice.findUnique({ where: { id: context.id }, select: { transactionId: true } });
    if (!invoice) return [];
    transactionId = invoice.transactionId;
    extraRefs = { invoiceId: context.id };
    onlyPrimaryCustomer = true;
  } else {
    transactionId = context.id;
  }

  const transaction = await prisma.transaction.findUnique({
    where: { id: transactionId },
    include: { customers: { include: { customer: true }, orderBy: { createdAt: "asc" } }, realtors: { include: { realtor: true } } },
  });
  if (!transaction) return [];

  const primary = getPrimaryCustomer(transaction.customers);
  const customers = onlyPrimaryCustomer ? (primary ? [primary] : []) : transaction.customers.map((tc) => tc.customer);
  const recipients: ComposeRecipient[] = customers.map((c) => ({
    key: `customer:${c.id}`,
    type: "CUSTOMER",
    name: `${c.firstName} ${c.lastName}`,
    email: c.email,
    label: onlyPrimaryCustomer ? "Customer responsible for payment" : c.id === primary?.id ? "Primary customer" : "Customer",
    refs: { customerId: c.id, transactionId, ...extraRefs },
  }));
  if (!onlyPrimaryCustomer) {
    const seen = new Set<string>();
    for (const tr of transaction.realtors) {
      if (seen.has(tr.realtorId) || tr.realtor.archivedAt) continue;
      seen.add(tr.realtorId);
      recipients.push({
        key: `realtor:${tr.realtorId}`,
        type: "REALTOR",
        name: realtorDisplayName(tr.realtor),
        email: tr.realtor.email,
        label: "Realtor",
        refs: { realtorId: tr.realtorId, transactionId, ...extraRefs },
      });
    }
  }
  return recipients;
}

// Which composer context reopens a prepared draft: the record its
// recipient belongs to. Report-delivery emails are never drafts.
export function composeContextForMessage(m: { realtorId: string | null; customerId: string | null; inspectionId: string | null; transactionId: string | null }): ComposeContext | null {
  if (m.realtorId && !m.customerId) return { kind: "realtor", id: m.realtorId };
  if (m.inspectionId) return { kind: "inspection", id: m.inspectionId };
  if (m.transactionId) return { kind: "transaction", id: m.transactionId };
  if (m.customerId) return { kind: "customer", id: m.customerId };
  return null;
}
