import Link from "next/link";
import { notFound } from "next/navigation";
import type { Role } from "@prisma/client";
import { prisma } from "@/lib/prisma";
import { auth } from "@/lib/auth";
import { can } from "@/lib/rbac";
import { formatBusinessDate, formatBusinessDateTime } from "@/lib/businessTime";
import { getCalendarConfig } from "@/lib/calendar/config";
import { toDayKey } from "@/lib/calendar/time";
import { getPrimaryCustomer } from "@/lib/transactions";
import { formatMoney, INVOICE_STATUS_LABELS, invoiceTotals, isInvoiceCollectible } from "@/lib/invoices";
import { EmailButton } from "@/components/email/EmailComposer";
import { EmailStatusBadge } from "@/components/email/EmailStatusBadge";
import { InvoiceEditor } from "../InvoiceEditor";
import { RecordPaymentForm } from "../RecordPaymentForm";

const METHOD_LABELS: Record<string, string> = { CARD: "Card", ACH: "ACH", CHECK: "Check", CASH: "Cash", OTHER: "Other" };

export default async function InvoicePage({ params }: { params: Promise<{ id: string }> }) {
  const session = await auth();
  const role = session?.user?.role as Role | undefined;
  if (!can(role, "financial:read")) {
    return <p className="text-sm text-neutral-600">You don&apos;t have access to invoices.</p>;
  }
  const { id } = await params;
  const invoice = await prisma.invoice.findUnique({
    where: { id },
    include: {
      items: { orderBy: { createdAt: "asc" } },
      payments: { orderBy: { paidAt: "asc" } },
      inspection: { select: { id: true, scheduledAt: true } },
      transaction: { include: { property: true, customers: { include: { customer: true }, orderBy: { createdAt: "asc" } } } },
      emailMessages: { orderBy: { createdAt: "desc" }, take: 20, select: { id: true, subject: true, status: true, simulated: true, createdAt: true, sentAt: true } },
    },
  });
  if (!invoice) notFound();

  const { timeZone } = getCalendarConfig();
  const totals = invoiceTotals(invoice);
  const collectible = isInvoiceCollectible(invoice.status, totals.balance);
  const customer = getPrimaryCustomer(invoice.transaction.customers);
  const property = invoice.transaction.property;
  const canEdit = can(role, "invoice:create");
  const canEmail = can(role, "email:send");
  const overdue = collectible && invoice.dueAt !== null && toDayKey(invoice.dueAt, timeZone) < toDayKey(new Date(), timeZone);
  const services = canEdit && invoice.status === "DRAFT" ? await prisma.service.findMany({ where: { active: true }, orderBy: { name: "asc" }, select: { name: true, basePrice: true } }) : [];

  return (
    <div className="max-w-3xl space-y-6">
      <div>
        <Link href={`/transactions/${invoice.transactionId}`} className="text-sm text-info-strong hover:underline">
          ← Transaction{property ? ` · ${property.addressLine1}, ${property.city}` : ""}
        </Link>
        <div className="mt-2 flex flex-wrap items-center justify-between gap-3">
          <h1 className="flex flex-wrap items-baseline gap-3 text-xl font-semibold text-foreground">
            {invoice.invoiceNumber}
            <span className={`rounded-full px-2 py-0.5 text-xs font-medium ${invoice.status === "VOID" ? "bg-surface-secondary text-neutral-600" : overdue ? "bg-warning-soft text-warning-strong" : "bg-selected text-foreground"}`}>
              {overdue ? "Overdue" : INVOICE_STATUS_LABELS[invoice.status]}
            </span>
          </h1>
          <div className="flex flex-wrap gap-2">
            {canEmail && invoice.status !== "DRAFT" && invoice.status !== "VOID" && (
              <EmailButton context={{ kind: "invoice", id: invoice.id }} templateKey="invoice" label="Email invoice" className="rounded-md border border-input bg-surface px-3 py-1.5 text-sm font-medium text-neutral-700 hover:bg-hover" />
            )}
            {canEmail && collectible && (
              <EmailButton context={{ kind: "invoice", id: invoice.id }} templateKey="payment_reminder" label="Send reminder" icon={false} className="rounded-md border border-input bg-surface px-3 py-1.5 text-sm font-medium text-neutral-700 hover:bg-hover" />
            )}
          </div>
        </div>
        <dl className="mt-3 grid grid-cols-2 gap-x-6 gap-y-2 text-sm sm:grid-cols-4">
          <div>
            <dt className="text-xs text-muted-foreground">Bill to</dt>
            <dd className="text-neutral-800">{customer ? `${customer.firstName} ${customer.lastName}` : <span className="text-subtle">No customer</span>}</dd>
            {customer && !customer.email && <dd className="text-xs text-warning-strong">No email on file</dd>}
          </div>
          <div>
            <dt className="text-xs text-muted-foreground">Inspection</dt>
            <dd>
              {invoice.inspection ? (
                <Link href={`/inspections/${invoice.inspection.id}`} className="text-neutral-800 hover:underline">
                  {invoice.inspection.scheduledAt ? formatBusinessDate(invoice.inspection.scheduledAt) : "Unscheduled"}
                </Link>
              ) : (
                <span className="text-subtle">Not linked</span>
              )}
            </dd>
          </div>
          <div>
            <dt className="text-xs text-muted-foreground">Issued</dt>
            <dd className="text-neutral-800">{invoice.issuedAt ? formatBusinessDate(invoice.issuedAt) : <span className="text-subtle">Not yet</span>}</dd>
          </div>
          <div>
            <dt className="text-xs text-muted-foreground">{invoice.status === "VOID" ? "Voided" : "Due"}</dt>
            <dd className={overdue ? "font-medium text-warning-strong" : "text-neutral-800"}>
              {invoice.status === "VOID" ? (invoice.voidedAt ? formatBusinessDate(invoice.voidedAt) : "—") : invoice.dueAt ? formatBusinessDate(invoice.dueAt) : "Upon receipt"}
            </dd>
          </div>
        </dl>
        {invoice.status === "DRAFT" && (
          <p className="mt-3 rounded-md bg-surface-secondary px-3 py-2 text-xs text-neutral-600">
            Draft: not owed yet and not counted in billed revenue. Issue it when the lines are right; after that it can only be voided and replaced.
          </p>
        )}
      </div>

      <InvoiceEditor
        invoiceId={invoice.id}
        transactionId={invoice.transactionId}
        status={invoice.status}
        lines={invoice.items.map((i) => ({ id: i.id, description: i.description, amount: i.amount.toFixed(2), display: formatMoney(i.amount) }))}
        totals={{ total: formatMoney(totals.total), paid: formatMoney(totals.paid), balance: formatMoney(totals.balance) }}
        dueDay={invoice.dueAt ? toDayKey(invoice.dueAt, timeZone) : ""}
        services={services.map((s) => ({ name: s.name, price: s.basePrice.toFixed(2) }))}
        canEdit={canEdit}
        canVoid={can(role, "invoice:void")}
      />

      {invoice.status !== "DRAFT" && (
        <section className="rounded-lg border border-border bg-surface p-4">
          <div className="flex flex-wrap items-start justify-between gap-3">
            <h2 className="text-sm font-semibold text-foreground">Payments</h2>
            {canEdit && collectible && <RecordPaymentForm invoiceId={invoice.id} balance={totals.balance.toFixed(2)} />}
          </div>
          <ul className="mt-2 space-y-1 text-sm">
            {invoice.payments.map((p) => (
              <li key={p.id} className="flex flex-wrap justify-between gap-2 rounded-md bg-surface-secondary px-3 py-2">
                <span className="text-neutral-700">
                  {formatBusinessDate(p.paidAt)} · {METHOD_LABELS[p.method] ?? p.method}
                  {p.reference && <span className="text-muted-foreground"> · {p.reference}</span>}
                </span>
                <span className="font-medium tabular-nums text-foreground">{formatMoney(p.amount)}</span>
              </li>
            ))}
            {invoice.payments.length === 0 && <li className="text-subtle">No payments recorded.</li>}
          </ul>
        </section>
      )}

      {invoice.emailMessages.length > 0 && (
        <section className="rounded-lg border border-border bg-surface p-4">
          <h2 className="text-sm font-semibold text-foreground">Emails</h2>
          <ul className="mt-2 space-y-1 text-sm">
            {invoice.emailMessages.map((m) => (
              <li key={m.id} className="flex flex-wrap items-center justify-between gap-2 rounded-md bg-surface-secondary px-3 py-2">
                <Link href={`/email/messages/${m.id}`} className="text-foreground hover:underline">
                  {m.subject}
                </Link>
                <span className="flex items-center gap-2 text-xs text-muted-foreground">
                  {formatBusinessDateTime(m.sentAt ?? m.createdAt)}
                  <EmailStatusBadge status={m.status} simulated={m.simulated} />
                </span>
              </li>
            ))}
          </ul>
        </section>
      )}
    </div>
  );
}
