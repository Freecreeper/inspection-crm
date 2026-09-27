import type { Role } from "@prisma/client";
import { prisma } from "@/lib/prisma";
import { can } from "@/lib/rbac";
import { invoiceTotals, isInvoiceCollectible } from "@/lib/invoices";
import { realtorDisplayName } from "@/lib/realtors/display";
import { ROLE_LABELS } from "@/lib/realtors/record";
import { getRealtorMetrics } from "@/lib/realtors/metrics";
import { findInspectorConflicts } from "@/lib/scheduling/conflicts";
import { getCalendarConfig } from "./config";
import { readinessChecklist, readinessWarnings, type ChecklistInput, type ChecklistItem } from "./readiness";
import { dateOnlyKey, timeOfDay, toDayKey } from "./time";
import type { CalendarWarning } from "./types";

// What the Calendar's preview drawer shows for one record — fetched only
// when an event is opened. Only facts that exist; missing optional data is
// returned as null for the UI to show as "Not provided", never invented.

export interface InspectionPreview {
  id: string;
  status: string;
  address: string;
  cityLine: string;
  start: string | null;
  end: string | null;
  day: string | null;
  time: string | null;
  durationMinutes: number;
  services: string[];
  accessNotes: string | null;
  agreementSignedAt: string | null;
  inspector: { id: string; name: string } | null;
  customer: { id: string; name: string; phone: string | null; email: string | null } | null;
  otherCustomers: number;
  realtors: { id: string; name: string; brokerage: string | null; role: string; phone: string | null; email: string | null }[];
  transactionId: string;
  reportId: string | null;
  warnings: CalendarWarning[];
  checklist: ChecklistItem[];
  conflicts: { title: string; start: string; end: string; kind: string }[];
  permissions: { canReschedule: boolean; canCancel: boolean; canEmail: boolean; canEditAgreement: boolean };
}

const CONFIRMATION_STATE: Record<string, ChecklistInput["confirmation"]> = {
  SENT: "sent",
  DELIVERED: "sent",
  QUEUED: "queued",
  SCHEDULED: "queued",
  SENDING: "queued",
  DRAFT: "review",
  SKIPPED: "skipped",
  SUPPRESSED: "skipped",
  FAILED: "skipped",
  BOUNCED: "skipped",
};

export async function loadInspectionPreview(id: string, role: Role | undefined): Promise<InspectionPreview | null> {
  const config = getCalendarConfig();
  const i = await prisma.inspection.findUnique({
    where: { id },
    include: {
      property: true,
      inspector: { select: { id: true, name: true } },
      inspectionServices: { select: { service: { select: { name: true } } }, orderBy: { createdAt: "asc" } },
      reports: { select: { id: true, status: true, deliveredAt: true }, orderBy: { createdAt: "desc" }, take: 1 },
      emailMessages: {
        where: { idempotencyKey: { startsWith: `inspection:${id}:confirmation` } },
        select: { status: true },
        orderBy: { createdAt: "desc" },
        take: 1,
      },
      transaction: {
        select: {
          id: true,
          customers: { select: { primaryContact: true, customer: { select: { id: true, firstName: true, lastName: true, phone: true, email: true } } } },
          realtors: { select: { role: true, brokerageName: true, realtor: { select: { id: true, firstName: true, lastName: true, preferredName: true, phone: true, email: true, brokerage: { select: { name: true } } } } } },
          invoices: { select: { status: true, items: { select: { amount: true } }, payments: { select: { amount: true } } } },
        },
      },
    },
  });
  if (!i) return null;

  const primary = i.transaction.customers.find((c) => c.primaryContact) ?? i.transaction.customers[0];
  const customer = primary ? primary.customer : null;
  const issued = i.transaction.invoices.filter((inv) => inv.status !== "DRAFT" && inv.status !== "VOID");
  const balanceDue = issued.some((inv) => isInvoiceCollectible(inv.status, invoiceTotals(inv).balance));
  const report = i.reports[0] ?? null;
  const end = i.scheduledAt ? new Date(i.scheduledAt.getTime() + i.durationMinutes * 60_000) : null;
  const conflicts =
    i.inspectorId && i.scheduledAt && end && (i.status === "SCHEDULED" || i.status === "IN_PROGRESS")
      ? await findInspectorConflicts(prisma, { inspectorId: i.inspectorId, start: i.scheduledAt, end, excludeInspectionId: i.id })
      : [];

  const warnings = readinessWarnings({
    status: i.status,
    inspectorId: i.inspectorId,
    agreementSignedAt: i.agreementSignedAt,
    serviceCount: i.inspectionServices.length,
    customer,
    balanceDue,
    requirePaymentBeforeInspection: config.requirePaymentBeforeInspection,
  });
  if (conflicts.length) warnings.unshift({ code: "conflict", label: "Scheduling conflict" });

  return {
    id: i.id,
    status: i.status,
    address: [i.property.addressLine1, i.property.addressLine2].filter(Boolean).join(" "),
    cityLine: `${i.property.city}, ${i.property.state} ${i.property.zip}`,
    start: i.scheduledAt?.toISOString() ?? null,
    end: end?.toISOString() ?? null,
    day: i.scheduledAt ? toDayKey(i.scheduledAt, config.timeZone) : null,
    time: i.scheduledAt ? timeOfDay(i.scheduledAt, config.timeZone) : null,
    durationMinutes: i.durationMinutes,
    services: i.inspectionServices.map((s) => s.service.name),
    accessNotes: i.accessNotes,
    agreementSignedAt: i.agreementSignedAt?.toISOString() ?? null,
    inspector: i.inspector,
    customer: customer ? { id: customer.id, name: `${customer.firstName} ${customer.lastName}`, phone: customer.phone, email: customer.email } : null,
    otherCustomers: Math.max(0, i.transaction.customers.length - 1),
    realtors: i.transaction.realtors.map((tr) => ({
      id: tr.realtor.id,
      name: realtorDisplayName(tr.realtor),
      brokerage: tr.brokerageName ?? tr.realtor.brokerage?.name ?? null,
      role: ROLE_LABELS[tr.role],
      phone: tr.realtor.phone,
      email: tr.realtor.email,
    })),
    transactionId: i.transaction.id,
    reportId: report?.id ?? null,
    warnings,
    checklist: readinessChecklist({
      status: i.status,
      agreementSignedAt: i.agreementSignedAt,
      payment: issued.length ? { invoiced: true, balanceDue } : null,
      requirePaymentBeforeInspection: config.requirePaymentBeforeInspection,
      confirmation: i.emailMessages[0] ? (CONFIRMATION_STATE[i.emailMessages[0].status] ?? "none") : "none",
      report: report ? { status: report.status, delivered: report.status === "DELIVERED" || Boolean(report.deliveredAt) } : null,
    }),
    conflicts: conflicts.map((c) => ({ kind: c.kind, title: c.title, start: c.start.toISOString(), end: c.end.toISOString() })),
    permissions: {
      canReschedule: can(role, "inspection:reschedule") && i.status === "SCHEDULED",
      canCancel: can(role, "inspection:cancel") && (i.status === "SCHEDULED" || i.status === "IN_PROGRESS"),
      canEmail: can(role, "email:send"),
      canEditAgreement: can(role, "crm:write"),
    },
  };
}

export interface TaskPreview {
  id: string;
  title: string;
  description: string | null;
  day: string | null;
  completed: boolean;
  assignee: string | null;
  realtor: { id: string; name: string; brokerage: string | null; phone: string | null; email: string | null } | null;
  transaction: { id: string; label: string } | null;
  permissions: { canUpdate: boolean; canEmail: boolean };
}

export async function loadTaskPreview(id: string, role: Role | undefined): Promise<TaskPreview | null> {
  const config = getCalendarConfig();
  const t = await prisma.task.findUnique({
    where: { id },
    include: {
      assignee: { select: { name: true } },
      realtor: { select: { id: true, firstName: true, lastName: true, preferredName: true, phone: true, email: true, brokerage: { select: { name: true } } } },
      transaction: { select: { id: true, property: { select: { addressLine1: true, city: true } } } },
    },
  });
  if (!t) return null;
  return {
    id: t.id,
    title: t.title,
    description: t.description,
    day: t.dueAt ? toDayKey(t.dueAt, config.timeZone) : null,
    completed: Boolean(t.completedAt),
    assignee: t.assignee?.name ?? null,
    realtor: t.realtor ? { id: t.realtor.id, name: realtorDisplayName(t.realtor), brokerage: t.realtor.brokerage?.name ?? null, phone: t.realtor.phone, email: t.realtor.email } : null,
    transaction: t.transaction ? { id: t.transaction.id, label: t.transaction.property ? `${t.transaction.property.addressLine1}, ${t.transaction.property.city}` : "Transaction" } : null,
    permissions: { canUpdate: can(role, "task:update"), canEmail: can(role, "email:send") },
  };
}

export interface RealtorEventPreview {
  id: string;
  name: string;
  brokerage: string | null;
  phone: string | null;
  email: string | null;
  transactions: number;
  referrals: number;
  birthday: string | null;
  careerStartDate: string | null;
  relationshipStartDate: string | null;
  permissions: { canEmail: boolean };
}

export async function loadRealtorEventPreview(id: string, role: Role | undefined): Promise<RealtorEventPreview | null> {
  const r = await prisma.realtor.findFirst({ where: { id, archivedAt: null }, include: { brokerage: { select: { name: true } } } });
  if (!r) return null;
  const metrics = await getRealtorMetrics(r.id, { includeFinancials: false });
  return {
    id: r.id,
    name: realtorDisplayName(r),
    brokerage: r.brokerage?.name ?? null,
    phone: r.phone,
    email: r.email,
    transactions: metrics.associatedTransactions,
    referrals: metrics.referrals,
    birthday: r.birthdayMonth && r.birthdayDay ? `${r.birthdayMonth}-${r.birthdayDay}` : null,
    careerStartDate: dateOnlyKey(r.careerStartDate),
    relationshipStartDate: dateOnlyKey(r.relationshipStartDate),
    permissions: { canEmail: can(role, "email:send") },
  };
}
