import Link from "next/link";
import { notFound } from "next/navigation";
import { prisma } from "@/lib/prisma";
import {
  addCustomerToTransaction,
  setPrimaryCustomer,
  addRealtorToTransaction,
  setTransactionProperty,
  addCommunication,
  uploadDocument,
} from "../actions";
import { createTask, completeTask } from "../../tasks/actions";
import { createAppointment, cancelAppointment } from "../../calendar/actions";
import { createInspection } from "../../inspections/actions";
import { getPrimaryCustomer } from "@/lib/transactions";
import { PropertyCombobox } from "../../properties/PropertyCombobox";
import { CustomerCombobox } from "../../customers/CustomerCombobox";
import { RealtorCombobox } from "../../realtors/RealtorCombobox";
import { Combobox } from "@/components/Combobox";

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
          include: { inspector: true, reports: { select: { id: true, status: true }, take: 1 } },
        },
        tasks: { orderBy: [{ completedAt: "asc" }, { dueAt: "asc" }], include: { assignee: true } },
        appointments: { where: { cancelledAt: null }, orderBy: { startAt: "asc" } },
        communications: { orderBy: { occurredAt: "desc" } },
        documents: { orderBy: { createdAt: "desc" } },
      },
    }),
    prisma.property.findMany({ orderBy: { addressLine1: "asc" } }),
    prisma.customer.findMany({ where: { archivedAt: null }, orderBy: { lastName: "asc" } }),
    prisma.realtor.findMany({ where: { archivedAt: null }, orderBy: { lastName: "asc" } }),
    prisma.user.findMany({ where: { active: true }, orderBy: { name: "asc" } }),
  ]);
  if (!transaction) notFound();

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
        <p className="font-mono text-xs uppercase tracking-wide text-slate-500">Transaction</p>
        <h1 className="text-xl font-semibold text-slate-900">
          {primaryCustomer ? `${primaryCustomer.firstName} ${primaryCustomer.lastName}` : "No customer yet"}
        </h1>
        <span className="mt-1 inline-block rounded-full bg-slate-100 px-2 py-0.5 font-mono text-[11px] text-slate-600">
          {transaction.status}
        </span>
      </div>

      <section className="rounded-lg border border-slate-200 bg-white p-4">
        <h2 className="text-sm font-semibold text-slate-900">Property</h2>
        {transaction.property ? (
          <p className="mt-2 text-sm text-slate-700">
            {transaction.property.addressLine1}, {transaction.property.city}, {transaction.property.state}{" "}
            {transaction.property.zip}
          </p>
        ) : (
          <>
            <p className="mt-1 text-sm text-slate-400">Not set — this never blocks other work on the transaction (§7).</p>
            <form action={setPropertyAction} className="mt-3 flex gap-2">
              <div className="flex-1">
                <PropertyCombobox
                  name="propertyId"
                  options={properties.map((p) => ({ id: p.id, label: `${p.addressLine1}, ${p.city}` }))}
                />
              </div>
              <button type="submit" className="rounded-md bg-slate-900 px-3 py-1.5 text-sm font-medium text-white hover:bg-slate-800">
                Set
              </button>
            </form>
          </>
        )}
      </section>

      <section className="rounded-lg border border-slate-200 bg-white p-4">
        <h2 className="text-sm font-semibold text-slate-900">Referral source</h2>
        <p className="mt-2 text-sm text-slate-700">
          {transaction.referralSource?.name ?? <span className="text-slate-400">Unknown — reportable as such (§7, §9)</span>}
        </p>
      </section>

      <section className="rounded-lg border border-slate-200 bg-white p-4">
        <h2 className="text-sm font-semibold text-slate-900">Customers</h2>
        <p className="mt-1 text-xs text-slate-500">
          Multiple independent customers can be on one transaction (e.g. two buyers) — each stays its
          own Customer record.
        </p>
        {transaction.customers.length > 0 && !transaction.customers.some((tc) => tc.primaryContact) && (
          <p className="mt-2 rounded-md bg-amber-50 px-3 py-2 text-xs text-amber-800">
            No primary contact selected yet — a data-quality warning, not a blocker. Pick one below.
          </p>
        )}
        <ul className="mt-2 space-y-1 text-sm">
          {transaction.customers.map((tc) => (
            <li key={tc.id} className="flex items-center justify-between rounded-md bg-slate-50 px-3 py-2">
              <span className="text-slate-800">
                {tc.customer.firstName} {tc.customer.lastName}
                <span className="ml-2 font-mono text-[11px] text-slate-500">{tc.role}</span>
              </span>
              {tc.primaryContact ? (
                <span className="rounded-full bg-emerald-100 px-2 py-0.5 text-[11px] font-medium text-emerald-700">
                  Primary contact
                </span>
              ) : (
                <form action={setPrimaryCustomerAction}>
                  <input type="hidden" name="transactionCustomerId" value={tc.id} />
                  <button type="submit" className="text-xs text-blue-700 hover:underline">
                    Make primary
                  </button>
                </form>
              )}
            </li>
          ))}
          {transaction.customers.length === 0 && (
            <p className="text-sm text-slate-400">
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
          <select name="role" className="rounded-md border border-slate-300 px-2 py-1.5 text-sm">
            <option value="PRIMARY_BUYER">Primary buyer</option>
            <option value="SECONDARY_BUYER">Secondary buyer</option>
            <option value="SELLER">Seller</option>
            <option value="OTHER">Other</option>
          </select>
          <label className="flex items-center gap-1.5 text-xs text-slate-600">
            <input type="checkbox" name="primaryContact" value="true" />
            Primary contact
          </label>
          <button type="submit" className="rounded-md bg-slate-900 px-3 py-1.5 text-sm font-medium text-white hover:bg-slate-800">
            Add
          </button>
        </form>
      </section>

      <section className="rounded-lg border border-slate-200 bg-white p-4">
        <h2 className="text-sm font-semibold text-slate-900">Realtors on this transaction</h2>
        <ul className="mt-2 space-y-1 text-sm">
          {transaction.realtors.map((tr) => (
            <li key={tr.id} className="flex items-center justify-between rounded-md bg-slate-50 px-3 py-2">
              <span className="text-slate-800">
                {tr.realtor ? `${tr.realtor.firstName} ${tr.realtor.lastName}` : "Unknown"}
                {tr.brokerageName ? ` — ${tr.brokerageName}` : ""}
              </span>
              <span className="font-mono text-[11px] text-slate-500">{tr.role}</span>
            </li>
          ))}
          {transaction.realtors.length === 0 && <p className="text-sm text-slate-400">None associated yet.</p>}
        </ul>
        <form action={addRealtorAction} className="mt-3 flex gap-2">
          <div className="flex-1">
            <RealtorCombobox name="realtorId" options={realtors.map((r) => ({ id: r.id, label: `${r.firstName} ${r.lastName}` }))} />
          </div>
          <select name="role" required className="rounded-md border border-slate-300 px-2 py-1.5 text-sm">
            <option value="BUYER_AGENT">Buyer&apos;s agent</option>
            <option value="LISTING_AGENT">Listing agent</option>
            <option value="TRANSACTION_COORDINATOR">Transaction coordinator</option>
            <option value="OTHER">Other</option>
          </select>
          <button type="submit" className="rounded-md bg-slate-900 px-3 py-1.5 text-sm font-medium text-white hover:bg-slate-800">
            Add
          </button>
        </form>
      </section>

      <section className="rounded-lg border border-slate-200 bg-white p-4">
        <h2 className="text-sm font-semibold text-slate-900">Inspections</h2>
        <ul className="mt-2 space-y-1 text-sm">
          {transaction.inspections.map((i) => {
            const report = i.reports[0];
            return (
              <li key={i.id} className="flex items-center justify-between rounded-md bg-slate-50 px-3 py-2">
                <Link href={`/inspections/${i.id}`} className="text-slate-800 hover:underline">
                  {i.scheduledAt ? i.scheduledAt.toLocaleString() : "Not scheduled"}
                  {i.inspector ? ` — ${i.inspector.name}` : ""}
                </Link>
                <span className="flex items-center gap-2">
                  <span className="font-mono text-[11px] text-slate-500">{i.status}</span>
                  {report && (
                    <span className="rounded-full bg-blue-100 px-2 py-0.5 font-mono text-[11px] text-blue-700">{report.status}</span>
                  )}
                </span>
              </li>
            );
          })}
          {transaction.inspections.length === 0 && <p className="text-sm text-slate-400">No inspections scheduled yet.</p>}
        </ul>
        {transaction.property ? (
          <form action={createInspectionAction} className="mt-3 flex flex-wrap gap-2">
            <input type="hidden" name="propertyId" value={transaction.property.id} />
            <div className="w-56">
              <Combobox name="inspectorId" placeholder="Unassigned" options={inspectors.map((u) => ({ id: u.id, label: u.name }))} />
            </div>
            <input name="scheduledAt" type="datetime-local" className="rounded-md border border-slate-300 px-2 py-1.5 text-sm" />
            <button type="submit" className="rounded-md bg-slate-900 px-3 py-1.5 text-sm font-medium text-white hover:bg-slate-800">
              Schedule inspection
            </button>
          </form>
        ) : (
          <p className="mt-3 text-xs text-slate-400">Set a property above to schedule an inspection.</p>
        )}
      </section>

      <section className="rounded-lg border border-slate-200 bg-white p-4">
        <h2 className="text-sm font-semibold text-slate-900">Tasks</h2>
        <ul className="mt-2 space-y-1 text-sm">
          {transaction.tasks.map((task) => {
            const completeAction = completeTask.bind(null, task.id);
            return (
              <li
                key={task.id}
                className={`flex items-center justify-between rounded-md px-3 py-2 ${
                  task.completedAt ? "bg-slate-50 text-slate-400 line-through" : "bg-slate-50 text-slate-800"
                }`}
              >
                <span>
                  {task.title}
                  {task.assignee ? ` — ${task.assignee.name}` : ""}
                  {task.dueAt ? ` (due ${task.dueAt.toLocaleDateString()})` : ""}
                </span>
                {!task.completedAt && (
                  <form action={completeAction}>
                    <button type="submit" className="text-xs text-blue-700 hover:underline">
                      Complete
                    </button>
                  </form>
                )}
              </li>
            );
          })}
          {transaction.tasks.length === 0 && <p className="text-sm text-slate-400">No tasks yet.</p>}
        </ul>
        <form action={createTask} className="mt-3 flex gap-2">
          <input type="hidden" name="transactionId" value={transaction.id} />
          <input name="title" placeholder="New task" required className="flex-1 rounded-md border border-slate-300 px-2 py-1.5 text-sm" />
          <div className="w-48">
            <Combobox name="assigneeId" placeholder="Unassigned" options={users.map((u) => ({ id: u.id, label: u.name }))} />
          </div>
          <input name="dueAt" type="date" className="rounded-md border border-slate-300 px-2 py-1.5 text-sm" />
          <button type="submit" className="rounded-md bg-slate-900 px-3 py-1.5 text-sm font-medium text-white hover:bg-slate-800">
            Add
          </button>
        </form>
      </section>

      <section className="rounded-lg border border-slate-200 bg-white p-4">
        <h2 className="text-sm font-semibold text-slate-900">Appointments</h2>
        <ul className="mt-2 space-y-1 text-sm">
          {transaction.appointments.map((a) => {
            const cancelAction = cancelAppointment.bind(null, a.id);
            return (
              <li key={a.id} className="flex items-center justify-between rounded-md bg-slate-50 px-3 py-2">
                <span className="text-slate-800">
                  {a.title} — {a.startAt.toLocaleString()}
                </span>
                <form action={cancelAction}>
                  <button type="submit" className="text-xs text-red-600 hover:underline">
                    Cancel
                  </button>
                </form>
              </li>
            );
          })}
          {transaction.appointments.length === 0 && <p className="text-sm text-slate-400">No appointments scheduled.</p>}
        </ul>
        <form action={createAppointment} className="mt-3 flex flex-wrap gap-2">
          <input type="hidden" name="transactionId" value={transaction.id} />
          <input name="title" placeholder="Title" required className="flex-1 rounded-md border border-slate-300 px-2 py-1.5 text-sm" />
          <input name="startAt" type="datetime-local" required className="rounded-md border border-slate-300 px-2 py-1.5 text-sm" />
          <input name="endAt" type="datetime-local" required className="rounded-md border border-slate-300 px-2 py-1.5 text-sm" />
          <button type="submit" className="rounded-md bg-slate-900 px-3 py-1.5 text-sm font-medium text-white hover:bg-slate-800">
            Schedule
          </button>
        </form>
      </section>

      <section className="rounded-lg border border-slate-200 bg-white p-4">
        <h2 className="text-sm font-semibold text-slate-900">Communications</h2>
        <ul className="mt-2 space-y-1 text-sm">
          {transaction.communications.map((c) => (
            <li key={c.id} className="rounded-md bg-slate-50 px-3 py-2">
              <p className="text-slate-800">{c.summary}</p>
              <p className="mt-0.5 text-xs text-slate-500">
                {c.channel} · {c.direction} · {c.occurredAt.toLocaleString()}
              </p>
            </li>
          ))}
          {transaction.communications.length === 0 && <p className="text-sm text-slate-400">Nothing logged yet.</p>}
        </ul>
        <form action={addCommunicationAction} className="mt-3 flex flex-wrap gap-2">
          <select name="channel" required className="rounded-md border border-slate-300 px-2 py-1.5 text-sm">
            <option value="Phone">Phone</option>
            <option value="Email">Email</option>
            <option value="Text">Text</option>
            <option value="In Person">In person</option>
          </select>
          <select name="direction" required className="rounded-md border border-slate-300 px-2 py-1.5 text-sm">
            <option value="OUTBOUND">Outbound</option>
            <option value="INBOUND">Inbound</option>
          </select>
          <input name="summary" placeholder="Summary" required className="flex-1 rounded-md border border-slate-300 px-2 py-1.5 text-sm" />
          <button type="submit" className="rounded-md bg-slate-900 px-3 py-1.5 text-sm font-medium text-white hover:bg-slate-800">
            Log
          </button>
        </form>
      </section>

      <section className="rounded-lg border border-slate-200 bg-white p-4">
        <h2 className="text-sm font-semibold text-slate-900">Documents</h2>
        <ul className="mt-2 space-y-1 text-sm">
          {transaction.documents.map((d) => (
            <li key={d.id} className="flex items-center justify-between rounded-md bg-slate-50 px-3 py-2">
              <span className="text-slate-800">{d.title}</span>
              <a href={`/api/documents/${d.id}`} className="text-xs text-blue-700 hover:underline">
                Download
              </a>
            </li>
          ))}
          {transaction.documents.length === 0 && <p className="text-sm text-slate-400">No documents uploaded.</p>}
        </ul>
        <form action={uploadDocumentAction} encType="multipart/form-data" className="mt-3 flex gap-2">
          <input name="title" placeholder="Title (optional)" className="flex-1 rounded-md border border-slate-300 px-2 py-1.5 text-sm" />
          <input name="file" type="file" required className="text-sm" />
          <button type="submit" className="rounded-md bg-slate-900 px-3 py-1.5 text-sm font-medium text-white hover:bg-slate-800">
            Upload
          </button>
        </form>
      </section>

    </div>
  );
}
