import { businessTimeZone, formatBusinessDate, formatBusinessDateTime } from "@/lib/businessTime";
import { SubmitButton } from "@/components/SubmitButton";
import Link from "next/link";
import { notFound } from "next/navigation";
import { prisma } from "@/lib/prisma";
import {
  addCustomerToTransaction,
  setPrimaryCustomer,
  addRealtorToTransaction,
  setTransactionProperty,
  setTransactionDates,
  addCommunication,
  uploadDocument,
  setTransactionStatus,
} from "../actions";
import { TRANSACTION_STATUS_LABELS, transactionMoves } from "@/lib/transactionStages";
import { createTask, completeTask } from "../../tasks/actions";
import { createAppointment, cancelAppointment } from "../../calendar/actions";
import { createInspection } from "../../inspections/actions";
import { getPrimaryCustomer } from "@/lib/transactions";
import { dateOnlyKey } from "@/lib/calendar/time";
import { PropertyCombobox } from "../../properties/PropertyCombobox";
import { CustomerCombobox } from "../../customers/CustomerCombobox";
import { RealtorCombobox } from "../../realtors/RealtorCombobox";
import { Combobox } from "@/components/Combobox";
import type { Role } from "@prisma/client";
import { auth } from "@/lib/auth";
import { can } from "@/lib/rbac";
import { formatMoney, invoiceTotals, isInvoiceCollectible } from "@/lib/invoices";
import { EmailButton } from "@/components/email/EmailComposer";
import { EmailStatusBadge } from "@/components/email/EmailStatusBadge";
import { RecordPaymentForm } from "../../invoices/RecordPaymentForm";

export default async function TransactionDetailPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const [transaction, properties, customers, realtors, users] = await Promise.all([
    prisma.transaction.findUnique({
      where: { id },
      include: {
        customers: { include: { customer: true }, orderBy: { createdAt: "asc" } },
        property: true,
        referralSource: true,
        realtors: { include: { realtor: true, brokerage: true }, orderBy: { createdAt: "asc" } },
        inspections: {
          orderBy: { createdAt: "desc" },
          include: { inspector: true, reports: { select: { id: true, status: true }, orderBy: { createdAt: "desc" }, take: 1 } },
        },
        tasks: { orderBy: [{ completedAt: "asc" }, { dueAt: "asc" }], include: { assignee: true } },
        appointments: { where: { cancelledAt: null }, orderBy: { startAt: "asc" } },
        communications: { orderBy: { occurredAt: "desc" }, include: { email: { select: { id: true, status: true, simulated: true } } } },
        invoices: { orderBy: { createdAt: "asc" }, include: { items: true, payments: true } },
        documents: { orderBy: { createdAt: "desc" } },
      },
    }),
    prisma.property.findMany({ orderBy: { addressLine1: "asc" } }),
    prisma.customer.findMany({ where: { archivedAt: null }, orderBy: { lastName: "asc" } }),
    prisma.realtor.findMany({ where: { archivedAt: null }, orderBy: { lastName: "asc" } }),
    prisma.user.findMany({ where: { active: true }, orderBy: { name: "asc" } }),
  ]);
  if (!transaction) notFound();
  const session = await auth();
  const role = session?.user?.role as Role | undefined;
  const canEmail = can(role, "email:send");
  const canRecordPayment = can(role, "invoice:create");

  const inspectors = users.filter((u) => u.role === "INSPECTOR");
  const primaryCustomer = getPrimaryCustomer(transaction.customers);
  const setPropertyAction = setTransactionProperty.bind(null, transaction.id);
  const addCustomerAction = addCustomerToTransaction.bind(null, transaction.id);
  const setPrimaryCustomerAction = setPrimaryCustomer.bind(null, transaction.id);
  const addRealtorAction = addRealtorToTransaction.bind(null, transaction.id);
  const addCommunicationAction = addCommunication.bind(null, transaction.id);
  const uploadDocumentAction = uploadDocument.bind(null, transaction.id);
  const createInspectionAction = createInspection.bind(null, transaction.id);

  return (
    <div className="max-w-3xl space-y-6">
      <div>
        <p className="font-mono text-xs uppercase tracking-wide text-muted-foreground">Transaction</p>
        <h1 className="text-xl font-semibold text-foreground">
          {primaryCustomer ? `${primaryCustomer.firstName} ${primaryCustomer.lastName}` : "No customer yet"}
        </h1>
        {/* The transaction's own stage; its inspections' status is separate. */}
        <div className="mt-1 flex flex-wrap items-center gap-2">
          <span className="rounded-full bg-neutral-100 px-2 py-0.5 text-[11px] font-medium text-neutral-700">{TRANSACTION_STATUS_LABELS[transaction.status]}</span>
          {can(role, "crm:write") &&
            transactionMoves(transaction.status).map((m) => (
              <form key={m.to} action={setTransactionStatus.bind(null, transaction.id)}>
                <input type="hidden" name="status" value={m.to} />
                <button type="submit" className={`rounded-md border border-border bg-surface px-2 py-0.5 text-xs font-medium hover:bg-hover ${m.to === "CANCELLED" ? "text-danger-strong" : "text-neutral-700"}`}>
                  {m.label}
                </button>
              </form>
            ))}
        </div>
      </div>

      <section className="rounded-lg border border-border bg-surface p-4">
        <h2 className="text-sm font-semibold text-foreground">Property</h2>
        {transaction.property ? (
          <p className="mt-2 text-sm text-neutral-700">
            {transaction.property.addressLine1}, {transaction.property.city}, {transaction.property.state}{" "}
            {transaction.property.zip}
          </p>
        ) : (
          <>
            <p className="mt-1 text-sm text-subtle">Not set — this never blocks other work on the transaction (§7).</p>
            <form action={setPropertyAction} className="mt-3 flex gap-2">
              <div className="flex-1">
                <PropertyCombobox
                  name="propertyId"
                  options={properties.map((p) => ({ id: p.id, label: `${p.addressLine1}, ${p.city}` }))}
                />
              </div>
              <SubmitButton className="rounded-md bg-primary px-3 py-1.5 text-sm font-medium text-primary-foreground hover:bg-primary-hover">
                Set
              </SubmitButton>
            </form>
          </>
        )}
      </section>

      <section className="rounded-lg border border-border bg-surface p-4">
        <h2 className="text-sm font-semibold text-foreground">Key dates</h2>
        <p className="mt-1 text-xs text-muted-foreground">Optional. Shown on the Calendar under Transaction dates.</p>
        <form action={setTransactionDates.bind(null, transaction.id)} className="mt-3 flex flex-wrap items-end gap-3">
          <label className="text-xs text-neutral-600">
            Inspection deadline
            <input type="date" name="inspectionDeadline" defaultValue={dateOnlyKey(transaction.inspectionDeadline) ?? ""} className="mt-1 block rounded-md border border-input px-2 py-1.5 text-sm" />
          </label>
          <label className="text-xs text-neutral-600">
            Closing date
            <input type="date" name="closingDate" defaultValue={dateOnlyKey(transaction.closingDate) ?? ""} className="mt-1 block rounded-md border border-input px-2 py-1.5 text-sm" />
          </label>
          <SubmitButton className="rounded-md bg-primary px-3 py-1.5 text-sm font-medium text-primary-foreground hover:bg-primary-hover">
            Save dates
          </SubmitButton>
        </form>
      </section>

      <section className="rounded-lg border border-border bg-surface p-4">
        <h2 className="text-sm font-semibold text-foreground">Referral source</h2>
        <p className="mt-2 text-sm text-neutral-700">
          {transaction.referralSource?.name ?? <span className="text-subtle">Unknown — reportable as such (§7, §9)</span>}
        </p>
      </section>

      <section className="rounded-lg border border-border bg-surface p-4">
        <h2 className="text-sm font-semibold text-foreground">Customers</h2>
        <p className="mt-1 text-xs text-muted-foreground">
          Multiple independent customers can be on one transaction (e.g. two buyers) — each stays its
          own Customer record.
        </p>
        {transaction.customers.length > 0 && !transaction.customers.some((tc) => tc.primaryContact) && (
          <p className="mt-2 rounded-md bg-warning-soft px-3 py-2 text-xs text-warning-strong">
            No primary contact selected yet — a data-quality warning, not a blocker. Pick one below.
          </p>
        )}
        <ul className="mt-2 space-y-1 text-sm">
          {transaction.customers.map((tc) => (
            <li key={tc.id} className="flex items-center justify-between rounded-md bg-surface-secondary px-3 py-2">
              <span className="text-neutral-800">
                {tc.customer.firstName} {tc.customer.lastName}
                <span className="ml-2 font-mono text-[11px] text-muted-foreground">{tc.role}</span>
              </span>
              {tc.primaryContact ? (
                <span className="rounded-full bg-accent-100 px-2 py-0.5 text-[11px] font-medium text-link">
                  Primary contact
                </span>
              ) : (
                <form action={setPrimaryCustomerAction}>
                  <input type="hidden" name="transactionCustomerId" value={tc.id} />
                  <SubmitButton className="text-xs text-info-strong hover:underline">
                    Make primary
                  </SubmitButton>
                </form>
              )}
            </li>
          ))}
          {transaction.customers.length === 0 && (
            <p className="text-sm text-subtle">
              No customer yet — this never blocks the rest of the transaction (§7).
            </p>
          )}
        </ul>
        <form action={addCustomerAction} className="mt-3 flex flex-wrap gap-2">
          <div className="min-w-[200px] flex-1">
            <CustomerCombobox
              name="customerId"
              options={customers.map((c) => ({ id: c.id, label: `${c.firstName} ${c.lastName}`, sublabel: c.email ?? undefined }))}
            />
          </div>
          <select name="role" className="rounded-md border border-input px-2 py-1.5 text-sm">
            <option value="PRIMARY_BUYER">Primary buyer</option>
            <option value="SECONDARY_BUYER">Secondary buyer</option>
            <option value="SELLER">Seller</option>
            <option value="OTHER">Other</option>
          </select>
          <label className="flex items-center gap-1.5 text-xs text-neutral-600">
            <input type="checkbox" name="primaryContact" value="true" />
            Primary contact
          </label>
          <SubmitButton className="rounded-md bg-primary px-3 py-1.5 text-sm font-medium text-primary-foreground hover:bg-primary-hover">
            Add
          </SubmitButton>
        </form>
      </section>

      <section className="rounded-lg border border-border bg-surface p-4">
        <h2 className="text-sm font-semibold text-foreground">Realtors on this transaction</h2>
        <ul className="mt-2 space-y-1 text-sm">
          {transaction.realtors.map((tr) => (
            <li key={tr.id} className="flex items-center justify-between rounded-md bg-surface-secondary px-3 py-2">
              <span className="text-neutral-800">
                {tr.realtor ? `${tr.realtor.firstName} ${tr.realtor.lastName}` : "Unknown"}
                {tr.brokerageName ? ` — ${tr.brokerageName}` : ""}
              </span>
              <span className="font-mono text-[11px] text-muted-foreground">{tr.role}</span>
            </li>
          ))}
          {transaction.realtors.length === 0 && <p className="text-sm text-subtle">None associated yet.</p>}
        </ul>
        <form action={addRealtorAction} className="mt-3 flex gap-2">
          <div className="flex-1">
            <RealtorCombobox name="realtorId" options={realtors.map((r) => ({ id: r.id, label: `${r.firstName} ${r.lastName}` }))} />
          </div>
          <select name="role" required className="rounded-md border border-input px-2 py-1.5 text-sm">
            <option value="BUYER_AGENT">Buyer&apos;s agent</option>
            <option value="LISTING_AGENT">Listing agent</option>
            <option value="TRANSACTION_COORDINATOR">Transaction coordinator</option>
            <option value="OTHER">Other</option>
          </select>
          <SubmitButton className="rounded-md bg-primary px-3 py-1.5 text-sm font-medium text-primary-foreground hover:bg-primary-hover">
            Add
          </SubmitButton>
        </form>
      </section>

      <section className="rounded-lg border border-border bg-surface p-4">
        <h2 className="text-sm font-semibold text-foreground">Inspections</h2>
        <ul className="mt-2 space-y-1 text-sm">
          {transaction.inspections.map((i) => {
            const report = i.reports[0];
            return (
              <li key={i.id} className="flex items-center justify-between rounded-md bg-surface-secondary px-3 py-2">
                <Link href={`/inspections/${i.id}`} className="text-neutral-800 hover:underline">
                  {i.scheduledAt ? formatBusinessDateTime(i.scheduledAt) : "Not scheduled"}
                  {i.inspector ? ` — ${i.inspector.name}` : ""}
                </Link>
                <span className="flex items-center gap-2">
                  <span className="font-mono text-[11px] text-muted-foreground">{i.status}</span>
                  {report && (
                    <span className="rounded-full bg-info-soft px-2 py-0.5 font-mono text-[11px] text-info-strong">{report.status}</span>
                  )}
                </span>
              </li>
            );
          })}
          {transaction.inspections.length === 0 && <p className="text-sm text-subtle">No inspections scheduled yet.</p>}
        </ul>
        {transaction.property ? (
          <form action={createInspectionAction} className="mt-3 flex flex-wrap gap-2">
            <input type="hidden" name="propertyId" value={transaction.property.id} />
            <div className="w-56">
              <Combobox name="inspectorId" placeholder="Unassigned" options={inspectors.map((u) => ({ id: u.id, label: u.name }))} />
            </div>
            <input name="scheduledAt" type="datetime-local" className="rounded-md border border-input px-2 py-1.5 text-sm" />
            <SubmitButton className="rounded-md bg-primary px-3 py-1.5 text-sm font-medium text-primary-foreground hover:bg-primary-hover">
              Schedule inspection
            </SubmitButton>
          </form>
        ) : (
          <p className="mt-3 text-xs text-subtle">Set a property above to schedule an inspection.</p>
        )}
      </section>

      <section className="rounded-lg border border-border bg-surface p-4">
        <h2 className="text-sm font-semibold text-foreground">Tasks</h2>
        <ul className="mt-2 space-y-1 text-sm">
          {transaction.tasks.map((task) => {
            const completeAction = completeTask.bind(null, task.id);
            return (
              <li
                key={task.id}
                className={`flex items-center justify-between rounded-md px-3 py-2 ${
                  task.completedAt ? "bg-surface-secondary text-subtle line-through" : "bg-surface-secondary text-neutral-800"
                }`}
              >
                <span>
                  {task.title}
                  {task.assignee ? ` — ${task.assignee.name}` : ""}
                  {task.dueAt ? ` (due ${formatBusinessDate(task.dueAt)})` : ""}
                </span>
                {!task.completedAt && (
                  <form action={completeAction}>
                    <SubmitButton className="text-xs text-info-strong hover:underline">
                      Complete
                    </SubmitButton>
                  </form>
                )}
              </li>
            );
          })}
          {transaction.tasks.length === 0 && <p className="text-sm text-subtle">No tasks yet.</p>}
        </ul>
        <form action={createTask} className="mt-3 flex gap-2">
          <input type="hidden" name="transactionId" value={transaction.id} />
          <input name="title" placeholder="New task" required className="flex-1 rounded-md border border-input px-2 py-1.5 text-sm" />
          <div className="w-48">
            <Combobox name="assigneeId" placeholder="Unassigned" options={users.map((u) => ({ id: u.id, label: u.name }))} />
          </div>
          <input name="dueAt" type="date" className="rounded-md border border-input px-2 py-1.5 text-sm" />
          <SubmitButton className="rounded-md bg-primary px-3 py-1.5 text-sm font-medium text-primary-foreground hover:bg-primary-hover">
            Add
          </SubmitButton>
        </form>
      </section>

      <section className="rounded-lg border border-border bg-surface p-4">
        <h2 className="text-sm font-semibold text-foreground">Appointments</h2>
        <ul className="mt-2 space-y-1 text-sm">
          {transaction.appointments.map((a) => {
            const cancelAction = cancelAppointment.bind(null, a.id);
            return (
              <li key={a.id} className="flex items-center justify-between rounded-md bg-surface-secondary px-3 py-2">
                <span className="text-neutral-800">
                  {a.title} — {formatBusinessDateTime(a.startAt)}
                </span>
                <form action={cancelAction}>
                  <SubmitButton className="text-xs text-danger-strong hover:underline">
                    Cancel
                  </SubmitButton>
                </form>
              </li>
            );
          })}
          {transaction.appointments.length === 0 && <p className="text-sm text-subtle">No appointments scheduled.</p>}
        </ul>
        <form action={createAppointment} className="mt-3 flex flex-wrap gap-2">
          <input type="hidden" name="transactionId" value={transaction.id} />
          <input name="title" placeholder="Title" required className="flex-1 rounded-md border border-input px-2 py-1.5 text-sm" />
          <input name="startAt" type="datetime-local" required className="rounded-md border border-input px-2 py-1.5 text-sm" />
          <input name="endAt" type="datetime-local" required className="rounded-md border border-input px-2 py-1.5 text-sm" />
          <SubmitButton className="rounded-md bg-primary px-3 py-1.5 text-sm font-medium text-primary-foreground hover:bg-primary-hover">
            Schedule
          </SubmitButton>
        </form>
      </section>

      {transaction.invoices.length > 0 && (
        <section className="rounded-lg border border-border bg-surface p-4">
          <h2 className="text-sm font-semibold text-foreground">Invoices</h2>
          <ul className="mt-2 space-y-2 text-sm">
            {transaction.invoices.map((inv) => {
              const totals = invoiceTotals(inv);
              const collectible = isInvoiceCollectible(inv.status, totals.balance);
              return (
                <li key={inv.id} className="rounded-md bg-surface-secondary px-3 py-2">
                  <div className="flex flex-wrap items-baseline justify-between gap-2">
                    <span className="font-medium text-neutral-800">{inv.invoiceNumber}</span>
                    <span className="font-mono text-[11px] text-muted-foreground">{inv.status}</span>
                  </div>
                  <p className="mt-0.5 text-xs tabular-nums text-neutral-600">
                    Total {formatMoney(totals.total)} · Paid {formatMoney(totals.paid)} · Balance {formatMoney(totals.balance)}
                    {inv.dueAt && ` · Due ${inv.dueAt.toLocaleDateString("en-US", { timeZone: businessTimeZone(), month: "short", day: "numeric", year: "numeric" })}`}
                  </p>
                  {collectible && (
                    <div className="mt-2 flex flex-wrap items-start gap-2">
                      {canEmail && (
                        <EmailButton
                          context={{ kind: "invoice", id: inv.id }}
                          templateKey="payment_reminder"
                          label="Send reminder"
                          icon={false}
                          className="rounded-md border border-input bg-surface px-2.5 py-1 text-xs font-medium text-neutral-700 hover:bg-hover"
                        />
                      )}
                      {canRecordPayment && <RecordPaymentForm invoiceId={inv.id} balance={totals.balance.toFixed(2)} />}
                    </div>
                  )}
                </li>
              );
            })}
          </ul>
        </section>
      )}

      <section className="rounded-lg border border-border bg-surface p-4">
        <div className="flex items-center justify-between gap-3">
          <h2 className="text-sm font-semibold text-foreground">Communications</h2>
          {canEmail && (transaction.customers.length > 0 || transaction.realtors.length > 0) && (
            <EmailButton
              context={{ kind: "transaction", id: transaction.id }}
              className="rounded-md border border-input bg-surface px-2.5 py-1 text-xs font-medium text-neutral-700 hover:bg-hover"
            />
          )}
        </div>
        <ul className="mt-2 space-y-1 text-sm">
          {transaction.communications.map((c) => (
            <li key={c.id} className="rounded-md bg-surface-secondary px-3 py-2">
              <p className="text-neutral-800">
                {c.email ? (
                  <Link href={`/email/messages/${c.email.id}`} className="hover:underline">
                    {c.summary}
                  </Link>
                ) : (
                  c.summary
                )}
              </p>
              <p className="mt-0.5 flex flex-wrap items-center gap-x-2 text-xs text-muted-foreground">
                {c.channel} · {c.direction} · {formatBusinessDateTime(c.occurredAt)}
                {c.email && <EmailStatusBadge status={c.email.status} simulated={c.email.simulated} />}
              </p>
            </li>
          ))}
          {transaction.communications.length === 0 && <p className="text-sm text-subtle">Nothing logged yet.</p>}
        </ul>
        <form action={addCommunicationAction} className="mt-3 flex flex-wrap gap-2">
          <select name="channel" required className="rounded-md border border-input px-2 py-1.5 text-sm">
            <option value="Phone">Phone</option>
            <option value="Email">Email</option>
            <option value="Text">Text</option>
            <option value="In Person">In person</option>
          </select>
          <select name="direction" required className="rounded-md border border-input px-2 py-1.5 text-sm">
            <option value="OUTBOUND">Outbound</option>
            <option value="INBOUND">Inbound</option>
          </select>
          <input name="summary" placeholder="Summary" required className="flex-1 rounded-md border border-input px-2 py-1.5 text-sm" />
          <SubmitButton className="rounded-md bg-primary px-3 py-1.5 text-sm font-medium text-primary-foreground hover:bg-primary-hover">
            Log
          </SubmitButton>
        </form>
      </section>

      <section className="rounded-lg border border-border bg-surface p-4">
        <h2 className="text-sm font-semibold text-foreground">Documents</h2>
        <ul className="mt-2 space-y-1 text-sm">
          {transaction.documents.map((d) => (
            <li key={d.id} className="flex items-center justify-between rounded-md bg-surface-secondary px-3 py-2">
              <span className="text-neutral-800">{d.title}</span>
              <a href={`/api/documents/${d.id}`} className="text-xs text-info-strong hover:underline">
                Download
              </a>
            </li>
          ))}
          {transaction.documents.length === 0 && <p className="text-sm text-subtle">No documents uploaded.</p>}
        </ul>
        <form action={uploadDocumentAction} className="mt-3 flex gap-2">
          <input name="title" placeholder="Title (optional)" className="flex-1 rounded-md border border-input px-2 py-1.5 text-sm" />
          <input name="file" type="file" required className="text-sm" />
          <SubmitButton className="rounded-md bg-primary px-3 py-1.5 text-sm font-medium text-primary-foreground hover:bg-primary-hover">
            Upload
          </SubmitButton>
        </form>
      </section>

    </div>
  );
}
