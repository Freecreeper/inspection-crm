import { SubmitButton } from "@/components/SubmitButton";
import Link from "next/link";
import { notFound } from "next/navigation";
import { prisma } from "@/lib/prisma";
import { getPrimaryCustomer } from "@/lib/transactions";
import { getCalendarConfig } from "@/lib/calendar/config";
import { formatDay, formatDuration, formatTimeRange, timeOfDay, toDayKey } from "@/lib/calendar/time";
import { updateInspectionStatus, updateInspectionConditions, assignInspector, rescheduleInspection } from "../actions";
import type { Role } from "@prisma/client";
import { auth } from "@/lib/auth";
import { can } from "@/lib/rbac";
import { EmailButton } from "@/components/email/EmailComposer";
import { EmailStatusBadge } from "@/components/email/EmailStatusBadge";
import { createReportFromTemplate } from "../report-actions";
import { Combobox } from "@/components/Combobox";
import { INVOICE_STATUS_LABELS } from "@/lib/invoices";
import { CreateInvoiceButton } from "../../invoices/CreateInvoiceButton";
import { CustomFieldsSection } from "@/components/customFields/CustomFieldsSection";

export default async function InspectionDetailPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const [inspection, inspectors, templates] = await Promise.all([
    prisma.inspection.findUnique({
      where: { id },
      include: {
        property: true,
        inspector: true,
        transaction: { include: { customers: { include: { customer: true } } } },
        reports: { orderBy: { createdAt: "desc" } },
        invoices: { where: { status: { not: "VOID" } }, orderBy: { createdAt: "asc" }, take: 1, select: { id: true, invoiceNumber: true, status: true } },
      },
    }),
    prisma.user.findMany({ where: { active: true, role: "INSPECTOR" }, orderBy: { name: "asc" } }),
    prisma.reportTemplate.findMany({ where: { active: true }, orderBy: { name: "asc" } }),
  ]);
  if (!inspection) notFound();
  const session = await auth();
  const role = session?.user?.role as Role | undefined;
  const canEmail = can(role, "email:send");
  const canSchedule = can(role, "inspection:reschedule");
  const { timeZone } = getCalendarConfig();
  const start = inspection.scheduledAt;
  const end = start ? new Date(start.getTime() + inspection.durationMinutes * 60_000) : null;
  const rescheduleAction = rescheduleInspection.bind(null, inspection.id);
  const emails = await prisma.emailMessage.findMany({
    where: { inspectionId: inspection.id, status: { not: "DRAFT" } },
    orderBy: [{ createdAt: "desc" }],
    take: 12,
    select: { id: true, subject: true, recipientName: true, status: true, statusReason: true, simulated: true, scheduledFor: true, sentAt: true, createdAt: true },
  });
  // <input type="datetime-local"> wants wall-clock time — in the business
  // time zone, never the server's.
  const localValue = (d: Date | null) => (d ? `${toDayKey(d, timeZone)}T${timeOfDay(d, timeZone)}` : "");

  const primaryCustomer = getPrimaryCustomer(inspection.transaction.customers);
  const statusAction = updateInspectionStatus.bind(null, inspection.id);
  const conditionsAction = updateInspectionConditions.bind(null, inspection.id);
  const assignAction = assignInspector.bind(null, inspection.id);
  const createReportAction = createReportFromTemplate.bind(null, inspection.id);
  const report = inspection.reports[0];
  const invoice = inspection.invoices[0];

  return (
    <div className="max-w-2xl space-y-6">
      <div>
        <p className="font-mono text-xs uppercase tracking-wide text-muted-foreground">Inspection</p>
        <h1 className="text-xl font-semibold text-foreground">
          {inspection.property.addressLine1}, {inspection.property.city}, {inspection.property.state}{" "}
          {inspection.property.zip}
        </h1>
        <p className="mt-1 text-sm text-muted-foreground">
          <Link href={`/transactions/${inspection.transactionId}`} className="hover:underline">
            {primaryCustomer ? `${primaryCustomer.firstName} ${primaryCustomer.lastName}` : "No customer yet"}
          </Link>
        </p>
        <div className="mt-1 flex flex-wrap items-center gap-3">
          <span className="inline-block rounded-full bg-neutral-100 px-2 py-0.5 font-mono text-[11px] text-neutral-600">{inspection.status}</span>
          {invoice && can(role, "financial:read") ? (
            <Link href={`/invoices/${invoice.id}`} className="text-sm text-info-strong hover:underline">
              Invoice {invoice.invoiceNumber} · {INVOICE_STATUS_LABELS[invoice.status]}
            </Link>
          ) : !invoice && inspection.status !== "CANCELLED" && can(role, "invoice:create") ? (
            <CreateInvoiceButton transactionId={inspection.transactionId} inspectionId={inspection.id} />
          ) : null}
        </div>
      </div>

      <section className="rounded-lg border border-border bg-surface p-4">
        <h2 className="text-sm font-semibold text-foreground">Status</h2>
        <form action={statusAction} className="mt-2 flex gap-2">
          <select name="status" defaultValue={inspection.status} className="rounded-md border border-input px-2 py-1.5 text-sm">
            <option value="SCHEDULED">Scheduled</option>
            <option value="IN_PROGRESS">In progress</option>
            <option value="COMPLETED">Completed</option>
            <option value="CANCELLED">Cancelled</option>
          </select>
          <SubmitButton className="rounded-md bg-primary px-3 py-1.5 text-sm font-medium text-primary-foreground hover:bg-primary-hover">
            Update
          </SubmitButton>
        </form>

        <h3 className="mt-4 text-xs font-medium uppercase tracking-wide text-muted-foreground">Scheduled for</h3>
        <p className="mt-1 text-sm text-neutral-700">
          {start && end ? (
            <>
              {formatDay(toDayKey(start, timeZone), "long")} · {formatTimeRange(start, end, timeZone)} ({formatDuration(inspection.durationMinutes)})
              <Link href={`/calendar?view=day&date=${toDayKey(start, timeZone)}`} className="ml-2 text-link hover:underline">
                View on calendar
              </Link>
            </>
          ) : (
            "Not scheduled"
          )}
        </p>
        <p className="mt-1 text-sm text-neutral-600">
          Agreement: {inspection.agreementSignedAt ? `signed ${formatDay(toDayKey(inspection.agreementSignedAt, timeZone), "short")}` : <span className="text-warning-strong">not signed yet</span>}
        </p>
        {canSchedule && inspection.status === "SCHEDULED" && (
          <form action={rescheduleAction} className="mt-2 flex flex-wrap gap-2">
            <label htmlFor="scheduledAt" className="sr-only">
              New date and time
            </label>
            <input id="scheduledAt" name="scheduledAt" type="datetime-local" step={900} required defaultValue={localValue(inspection.scheduledAt)} className="rounded-md border border-input px-2 py-1.5 text-sm" />
            <label htmlFor="durationMinutes" className="sr-only">
              Duration
            </label>
            <select id="durationMinutes" name="durationMinutes" defaultValue={inspection.durationMinutes} className="rounded-md border border-input px-2 py-1.5 text-sm">
              {[...new Set([30, 45, 60, 90, 120, 150, 180, 210, 240, 300, 360, 480, inspection.durationMinutes])].sort((a, b) => a - b).map((m) => (
                <option key={m} value={m}>
                  {formatDuration(m)}
                </option>
              ))}
            </select>
            <SubmitButton className="rounded-md border border-input bg-surface px-3 py-1.5 text-sm font-medium text-neutral-700 hover:bg-hover">
              {inspection.scheduledAt ? "Reschedule" : "Schedule"}
            </SubmitButton>
          </form>
        )}
        <p className="mt-1 text-xs text-muted-foreground">Changing the date or time updates reminders and notifies customers per the email automations. Overlapping bookings for the inspector are refused.</p>

        <h3 className="mt-4 text-xs font-medium uppercase tracking-wide text-muted-foreground">Inspector</h3>
        <p className="mt-1 text-sm text-neutral-700">{inspection.inspector?.name || "Unassigned"}</p>
        <form action={assignAction} className="mt-2 flex gap-2">
          <div className="flex-1">
            <Combobox
              name="inspectorId"
              placeholder="Unassigned"
              defaultValue={inspection.inspectorId ?? ""}
              options={inspectors.map((u) => ({ id: u.id, label: u.name }))}
            />
          </div>
          <SubmitButton className="rounded-md bg-primary px-3 py-1.5 text-sm font-medium text-primary-foreground hover:bg-primary-hover">
            Assign
          </SubmitButton>
        </form>
      </section>

      <section className="rounded-lg border border-border bg-surface p-4">
        <div className="flex items-center justify-between gap-3">
          <h2 className="text-sm font-semibold text-foreground">Emails</h2>
          {canEmail && (
            <EmailButton
              context={{ kind: "inspection", id: inspection.id }}
              className="rounded-md border border-input bg-surface px-2.5 py-1 text-xs font-medium text-neutral-700 hover:bg-hover"
            />
          )}
        </div>
        <ul className="mt-2 space-y-1 text-sm">
          {emails.map((m) => (
            <li key={m.id} className="flex flex-wrap items-start justify-between gap-2 rounded-md bg-surface-secondary px-3 py-2">
              <span className="min-w-0">
                <Link href={`/email/messages/${m.id}`} className="text-neutral-800 hover:underline">
                  {m.subject || "(no subject)"}
                </Link>
                <span className="block text-xs text-muted-foreground">
                  To {m.recipientName}
                  {m.status === "SCHEDULED" && m.scheduledFor && ` · sends ${m.scheduledFor.toLocaleString("en-US", { timeZone, month: "short", day: "numeric", hour: "numeric", minute: "2-digit" })}`}
                  {m.statusReason && !m.simulated && ` · ${m.statusReason}`}
                </span>
              </span>
              <EmailStatusBadge status={m.status} simulated={m.simulated} />
            </li>
          ))}
          {emails.length === 0 && <p className="text-sm text-subtle">No emails for this inspection yet.</p>}
        </ul>
      </section>

      <section className="rounded-lg border border-border bg-surface p-4">
        <h2 className="text-sm font-semibold text-foreground">Conditions on site</h2>
        <p className="mt-1 text-xs text-muted-foreground">
          Optional — missing conditions never block documenting the property (§ &quot;Property Data Collection&quot;).
        </p>
        <form action={conditionsAction} className="mt-3 grid grid-cols-2 gap-2">
          <input name="weather" defaultValue={inspection.weather ?? ""} placeholder="Weather" className="rounded-md border border-input px-2 py-1.5 text-sm" />
          <input name="temperatureF" type="number" defaultValue={inspection.temperatureF ?? ""} placeholder="Temp (°F)" className="rounded-md border border-input px-2 py-1.5 text-sm" />
          <input name="occupancyStatus" defaultValue={inspection.occupancyStatus ?? ""} placeholder="Occupancy status" className="rounded-md border border-input px-2 py-1.5 text-sm" />
          <select name="utilitiesOn" defaultValue={inspection.utilitiesOn === null ? "" : String(inspection.utilitiesOn)} className="rounded-md border border-input px-2 py-1.5 text-sm">
            <option value="">Utilities: unknown</option>
            <option value="true">Utilities on</option>
            <option value="false">Utilities off</option>
          </select>
          <SubmitButton className="col-span-2 rounded-md bg-primary px-3 py-1.5 text-sm font-medium text-primary-foreground hover:bg-primary-hover">
            Save conditions
          </SubmitButton>
        </form>
      </section>

      <CustomFieldsSection entityType="INSPECTION" entityId={inspection.id} />
      <CustomFieldsSection entityType="PROPERTY" entityId={inspection.propertyId} title="Property details" />

      <section className="rounded-lg border border-border bg-surface p-4">
        <h2 className="text-sm font-semibold text-foreground">Inspection report</h2>
        {report ? (
          <div className="mt-2 flex items-center justify-between">
            <div>
              <p className="text-sm text-neutral-800">{report.reportNumber}</p>
              <span className="rounded-full bg-info-soft px-2 py-0.5 font-mono text-[11px] text-info-strong">{report.status}</span>
            </div>
            <Link href={`/inspections/${inspection.id}/report`} className="rounded-md bg-primary px-3 py-1.5 text-sm font-medium text-primary-foreground hover:bg-primary-hover">
              Open report
            </Link>
          </div>
        ) : (
          <form action={createReportAction} className="mt-3 flex gap-2">
            <select name="templateId" required className="flex-1 rounded-md border border-input px-2 py-1.5 text-sm">
              <option value="" disabled selected>
                Select a template
              </option>
              {templates.map((t) => (
                <option key={t.id} value={t.id}>
                  {t.name}
                </option>
              ))}
            </select>
            <SubmitButton className="rounded-md bg-primary px-3 py-1.5 text-sm font-medium text-primary-foreground hover:bg-primary-hover">
              Start report
            </SubmitButton>
          </form>
        )}
      </section>
    </div>
  );
}
