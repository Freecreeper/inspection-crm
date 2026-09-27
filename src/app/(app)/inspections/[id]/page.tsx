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

  return (
    <div className="max-w-2xl space-y-6">
      <div>
        <p className="font-mono text-xs uppercase tracking-wide text-slate-500">Inspection</p>
        <h1 className="text-xl font-semibold text-slate-900">
          {inspection.property.addressLine1}, {inspection.property.city}, {inspection.property.state}{" "}
          {inspection.property.zip}
        </h1>
        <p className="mt-1 text-sm text-slate-500">
          <Link href={`/transactions/${inspection.transactionId}`} className="hover:underline">
            {primaryCustomer ? `${primaryCustomer.firstName} ${primaryCustomer.lastName}` : "No customer yet"}
          </Link>
        </p>
        <span className="mt-1 inline-block rounded-full bg-slate-100 px-2 py-0.5 font-mono text-[11px] text-slate-600">
          {inspection.status}
        </span>
      </div>

      <section className="rounded-lg border border-slate-200 bg-white p-4">
        <h2 className="text-sm font-semibold text-slate-900">Status</h2>
        <form action={statusAction} className="mt-2 flex gap-2">
          <select name="status" defaultValue={inspection.status} className="rounded-md border border-slate-300 px-2 py-1.5 text-sm">
            <option value="SCHEDULED">Scheduled</option>
            <option value="IN_PROGRESS">In progress</option>
            <option value="COMPLETED">Completed</option>
            <option value="CANCELLED">Cancelled</option>
          </select>
          <button type="submit" className="rounded-md bg-slate-900 px-3 py-1.5 text-sm font-medium text-white hover:bg-slate-800">
            Update
          </button>
        </form>

        <h3 className="mt-4 text-xs font-medium uppercase tracking-wide text-slate-500">Scheduled for</h3>
        <p className="mt-1 text-sm text-slate-700">
          {start && end ? (
            <>
              {formatDay(toDayKey(start, timeZone), "long")} · {formatTimeRange(start, end, timeZone)} ({formatDuration(inspection.durationMinutes)})
              <Link href={`/calendar?view=day&date=${toDayKey(start, timeZone)}`} className="ml-2 text-emerald-700 hover:underline">
                View on calendar
              </Link>
            </>
          ) : (
            "Not scheduled"
          )}
        </p>
        <p className="mt-1 text-sm text-slate-600">
          Agreement: {inspection.agreementSignedAt ? `signed ${formatDay(toDayKey(inspection.agreementSignedAt, timeZone), "short")}` : <span className="text-amber-700">not signed yet</span>}
        </p>
        {canSchedule && inspection.status === "SCHEDULED" && (
          <form action={rescheduleAction} className="mt-2 flex flex-wrap gap-2">
            <label htmlFor="scheduledAt" className="sr-only">
              New date and time
            </label>
            <input id="scheduledAt" name="scheduledAt" type="datetime-local" step={900} required defaultValue={localValue(inspection.scheduledAt)} className="rounded-md border border-slate-300 px-2 py-1.5 text-sm" />
            <label htmlFor="durationMinutes" className="sr-only">
              Duration
            </label>
            <select id="durationMinutes" name="durationMinutes" defaultValue={inspection.durationMinutes} className="rounded-md border border-slate-300 px-2 py-1.5 text-sm">
              {[...new Set([30, 45, 60, 90, 120, 150, 180, 210, 240, 300, 360, 480, inspection.durationMinutes])].sort((a, b) => a - b).map((m) => (
                <option key={m} value={m}>
                  {formatDuration(m)}
                </option>
              ))}
            </select>
            <button type="submit" className="rounded-md border border-slate-300 bg-white px-3 py-1.5 text-sm font-medium text-slate-700 hover:bg-slate-50">
              {inspection.scheduledAt ? "Reschedule" : "Schedule"}
            </button>
          </form>
        )}
        <p className="mt-1 text-xs text-slate-500">Changing the date or time updates reminders and notifies customers per the email automations. Overlapping bookings for the inspector are refused.</p>

        <h3 className="mt-4 text-xs font-medium uppercase tracking-wide text-slate-500">Inspector</h3>
        <p className="mt-1 text-sm text-slate-700">{inspection.inspector?.name || "Unassigned"}</p>
        <form action={assignAction} className="mt-2 flex gap-2">
          <div className="flex-1">
            <Combobox
              name="inspectorId"
              placeholder="Unassigned"
              defaultValue={inspection.inspectorId ?? ""}
              options={inspectors.map((u) => ({ id: u.id, label: u.name }))}
            />
          </div>
          <button type="submit" className="rounded-md bg-slate-900 px-3 py-1.5 text-sm font-medium text-white hover:bg-slate-800">
            Assign
          </button>
        </form>
      </section>

      <section className="rounded-lg border border-slate-200 bg-white p-4">
        <div className="flex items-center justify-between gap-3">
          <h2 className="text-sm font-semibold text-slate-900">Emails</h2>
          {canEmail && (
            <EmailButton
              context={{ kind: "inspection", id: inspection.id }}
              className="rounded-md border border-slate-300 bg-white px-2.5 py-1 text-xs font-medium text-slate-700 hover:bg-slate-50"
            />
          )}
        </div>
        <ul className="mt-2 space-y-1 text-sm">
          {emails.map((m) => (
            <li key={m.id} className="flex flex-wrap items-start justify-between gap-2 rounded-md bg-slate-50 px-3 py-2">
              <span className="min-w-0">
                <Link href={`/email/messages/${m.id}`} className="text-slate-800 hover:underline">
                  {m.subject || "(no subject)"}
                </Link>
                <span className="block text-xs text-slate-500">
                  To {m.recipientName}
                  {m.status === "SCHEDULED" && m.scheduledFor && ` · sends ${m.scheduledFor.toLocaleString("en-US", { timeZone, month: "short", day: "numeric", hour: "numeric", minute: "2-digit" })}`}
                  {m.statusReason && !m.simulated && ` · ${m.statusReason}`}
                </span>
              </span>
              <EmailStatusBadge status={m.status} simulated={m.simulated} />
            </li>
          ))}
          {emails.length === 0 && <p className="text-sm text-slate-400">No emails for this inspection yet.</p>}
        </ul>
      </section>

      <section className="rounded-lg border border-slate-200 bg-white p-4">
        <h2 className="text-sm font-semibold text-slate-900">Conditions on site</h2>
        <p className="mt-1 text-xs text-slate-500">
          Optional — missing conditions never block documenting the property (§ &quot;Property Data Collection&quot;).
        </p>
        <form action={conditionsAction} className="mt-3 grid grid-cols-2 gap-2">
          <input name="weather" defaultValue={inspection.weather ?? ""} placeholder="Weather" className="rounded-md border border-slate-300 px-2 py-1.5 text-sm" />
          <input name="temperatureF" type="number" defaultValue={inspection.temperatureF ?? ""} placeholder="Temp (°F)" className="rounded-md border border-slate-300 px-2 py-1.5 text-sm" />
          <input name="occupancyStatus" defaultValue={inspection.occupancyStatus ?? ""} placeholder="Occupancy status" className="rounded-md border border-slate-300 px-2 py-1.5 text-sm" />
          <select name="utilitiesOn" defaultValue={inspection.utilitiesOn === null ? "" : String(inspection.utilitiesOn)} className="rounded-md border border-slate-300 px-2 py-1.5 text-sm">
            <option value="">Utilities: unknown</option>
            <option value="true">Utilities on</option>
            <option value="false">Utilities off</option>
          </select>
          <button type="submit" className="col-span-2 rounded-md bg-slate-900 px-3 py-1.5 text-sm font-medium text-white hover:bg-slate-800">
            Save conditions
          </button>
        </form>
      </section>

      <section className="rounded-lg border border-slate-200 bg-white p-4">
        <h2 className="text-sm font-semibold text-slate-900">Inspection report</h2>
        {report ? (
          <div className="mt-2 flex items-center justify-between">
            <div>
              <p className="text-sm text-slate-800">{report.reportNumber}</p>
              <span className="rounded-full bg-blue-100 px-2 py-0.5 font-mono text-[11px] text-blue-700">{report.status}</span>
            </div>
            <Link href={`/inspections/${inspection.id}/report`} className="rounded-md bg-slate-900 px-3 py-1.5 text-sm font-medium text-white hover:bg-slate-800">
              Open report
            </Link>
          </div>
        ) : (
          <form action={createReportAction} className="mt-3 flex gap-2">
            <select name="templateId" required className="flex-1 rounded-md border border-slate-300 px-2 py-1.5 text-sm">
              <option value="" disabled selected>
                Select a template
              </option>
              {templates.map((t) => (
                <option key={t.id} value={t.id}>
                  {t.name}
                </option>
              ))}
            </select>
            <button type="submit" className="rounded-md bg-slate-900 px-3 py-1.5 text-sm font-medium text-white hover:bg-slate-800">
              Start report
            </button>
          </form>
        )}
      </section>
    </div>
  );
}
