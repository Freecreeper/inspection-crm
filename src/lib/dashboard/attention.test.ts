import { describe, it, expect } from "vitest";
import { Prisma } from "@prisma/client";
import type { CalendarEvent } from "@/lib/calendar/types";
import {
  deliveryAttention,
  emailAttention,
  emailReviewAttention,
  inspectionAttention,
  invoiceAttention,
  reportAttention,
  sortAttention,
  taskAttention,
  type FailedDelivery,
  type FailedEmail,
} from "./attention";
import type { CollectibleInvoice, OpenTask, UnfinishedReport } from "./sources";
import { readinessWarnings } from "@/lib/calendar/readiness";

const TZ = "America/New_York";
const TODAY = "2026-09-29";

function inspection(over: Partial<CalendarEvent> & { agreementSignedAt?: Date | null; inspectorId?: string | null } = {}): CalendarEvent {
  const { agreementSignedAt = null, ...rest } = over;
  const inspectorId = "inspectorId" in over ? (over.inspectorId ?? null) : "u-jordan";
  return {
    id: "inspection:i1",
    type: "inspection",
    layer: "inspections",
    sourceType: "Inspection",
    sourceId: "i1",
    title: "123 Main St, Hickory",
    subtitle: "General",
    start: "2026-09-29T13:00:00.000Z",
    end: "2026-09-29T16:00:00.000Z",
    allDay: false,
    day: TODAY,
    inspectorId,
    inspectorName: inspectorId ? "Jordan" : null,
    status: "SCHEDULED",
    priority: "normal",
    // Derived exactly as the Calendar derives them.
    warnings: readinessWarnings({
      status: rest.status ?? "SCHEDULED",
      inspectorId,
      agreementSignedAt,
      serviceCount: 1,
      customer: { phone: "8285550100", email: null },
      balanceDue: false,
      requirePaymentBeforeInspection: false,
    }),
    href: "/inspections/i1",
    searchText: "",
    movable: true,
    ...rest,
  };
}

describe("scheduling rules (agreement, inspector, conflict)", () => {
  it("an upcoming inspection with an unsigned agreement creates Attention; signing resolves it", () => {
    const unsigned = inspectionAttention([inspection()], TODAY, TZ);
    expect(unsigned).toEqual([
      expect.objectContaining({ id: "agreement:i1", category: "agreementUnsigned", required: true, severity: "warning", title: "Agreement unsigned", subject: "123 Main St, Hickory", actionLabel: "Review", preview: { type: "inspection", id: "i1" } }),
    ]);
    expect(inspectionAttention([inspection({ agreementSignedAt: new Date("2026-09-20T12:00:00Z") })], TODAY, TZ)).toEqual([]);
  });

  it("agreements are raised a week ahead; sooner ones rank as warnings", () => {
    expect(inspectionAttention([inspection({ day: "2026-10-03" })], TODAY, TZ)[0].severity).toBe("action");
    expect(inspectionAttention([inspection({ day: "2026-10-09" })], TODAY, TZ)).toEqual([]);
  });

  it("a missing inspector creates Attention", () => {
    const items = inspectionAttention([inspection({ inspectorId: null, agreementSignedAt: new Date() })], TODAY, TZ);
    expect(items).toEqual([expect.objectContaining({ category: "noInspector", severity: "warning", title: "No inspector assigned", actionLabel: "Assign" })]);
  });

  it("a scheduling conflict is critical", () => {
    const e = inspection({ agreementSignedAt: new Date() });
    e.warnings.unshift({ code: "conflict", label: "Scheduling conflict" });
    expect(inspectionAttention([e], TODAY, TZ)[0]).toMatchObject({ category: "conflict", severity: "critical", required: true });
  });

  it("finished, cancelled, and past inspections raise nothing", () => {
    expect(inspectionAttention([inspection({ status: "COMPLETED" })], TODAY, TZ)).toEqual([]);
    expect(inspectionAttention([inspection({ status: "CANCELLED" })], TODAY, TZ)).toEqual([]);
    expect(inspectionAttention([inspection({ day: "2026-09-28" })], TODAY, TZ)).toEqual([]);
  });
});

function completed(over: Partial<UnfinishedReport> = {}): UnfinishedReport {
  return {
    id: "i9",
    scheduledAt: new Date("2026-09-25T14:00:00Z"),
    completedAt: new Date("2026-09-25T18:00:00Z"),
    inspectorId: "u-jordan",
    inspector: { name: "Jordan" },
    property: { addressLine1: "9 Pine Ct", city: "Hickory" },
    reports: [],
    ...over,
  };
}

describe("report rules", () => {
  it("a completed inspection with no finished report creates Attention (overdue after the turnaround)", () => {
    const [item] = reportAttention([completed()], TODAY, 1, TZ);
    expect(item).toMatchObject({ category: "reportUnfinished", title: "Report not started", actionLabel: "Start report", overdue: true, severity: "warning", dueAt: "2026-09-26", href: "/inspections/i9" });
    expect(reportAttention([completed({ reports: [{ id: "r1", status: "READY_FOR_REVIEW" }] })], TODAY, 1, TZ)[0]).toMatchObject({ title: "Report awaiting review", actionLabel: "Open report", href: "/inspections/i9/report" });
  });

  it("finalizing (or delivering) the report resolves it", () => {
    expect(reportAttention([completed({ reports: [{ id: "r1", status: "FINALIZED" }] })], TODAY, 1, TZ)).toEqual([]);
    expect(reportAttention([completed({ reports: [{ id: "r1", status: "DELIVERED" }] })], TODAY, 1, TZ)).toEqual([]);
    // An amended report is open for editing again — still unfinished.
    expect(reportAttention([completed({ reports: [{ id: "r1", status: "AMENDED" }] })], TODAY, 1, TZ)).toHaveLength(1);
  });

  const failed = (over: Partial<FailedDelivery["report"]> = {}): FailedDelivery => ({
    id: "d1",
    recipientName: "Ava Chen",
    report: { id: "r1", inspectionId: "i9", status: "FINALIZED", deliveredAt: null, deliveries: [{ status: "FAILED" }], inspection: { inspectorId: "u-jordan", property: { addressLine1: "9 Pine Ct", city: "Hickory" } }, ...over },
  });

  it("a failed report delivery creates critical Attention (once per report)", () => {
    const items = deliveryAttention([failed(), { ...failed(), id: "d2" }]);
    expect(items).toEqual([expect.objectContaining({ id: "delivery:r1", category: "deliveryFailed", severity: "critical", required: true, detail: "To Ava Chen", href: "/inspections/i9/report/versions" })]);
  });

  it("a later successful delivery resolves the failure", () => {
    expect(deliveryAttention([failed({ deliveries: [{ status: "FAILED" }, { status: "SENT" }] })])).toEqual([]);
    expect(deliveryAttention([failed({ status: "DELIVERED", deliveredAt: new Date() })])).toEqual([]);
  });
});

describe("email rules", () => {
  const email = (over: Partial<FailedEmail> = {}): FailedEmail => ({
    id: "m1",
    status: "FAILED",
    subject: "Your inspection is confirmed",
    recipientName: "Ava Chen",
    statusReason: "Provider rejected the address",
    updatedAt: new Date("2026-09-28T12:00:00Z"),
    automation: { name: "Inspection confirmation" },
    inspection: { inspectorId: "u-jordan" },
    ...over,
  });

  it("a failed or bounced operational email appears, with a way to review it", () => {
    expect(emailAttention([email(), email({ id: "m2", status: "BOUNCED" })])).toEqual([
      expect.objectContaining({ category: "emailFailed", required: true, title: "Email failed", subject: "Inspection confirmation", detail: "To Ava Chen · Provider rejected the address", href: "/email/messages/m1" }),
      expect.objectContaining({ title: "Email bounced", href: "/email/messages/m2" }),
    ]);
  });

  it("a retried (re-queued) email no longer appears", () => {
    expect(emailAttention([email({ status: "QUEUED" }), email({ status: "SENT" })])).toEqual([]);
  });

  it("emails waiting for review are a single, optional, informational item", () => {
    expect(emailReviewAttention(0)).toEqual([]);
    expect(emailReviewAttention(3)).toEqual([expect.objectContaining({ category: "emailReview", required: false, severity: "info", subject: "3 emails prepared by automations", href: "/email/review" })]);
  });
});

describe("invoice rules", () => {
  const startOfToday = new Date("2026-09-29T04:00:00Z");
  const invoice = (over: Partial<CollectibleInvoice> = {}): CollectibleInvoice => ({
    id: "inv1",
    invoiceNumber: "INV-100",
    status: "SENT",
    dueAt: new Date("2026-09-20T16:00:00Z"),
    transactionId: "t1",
    customer: "John Smith",
    balance: new Prisma.Decimal("475.00"),
    ...over,
  });

  it("an overdue invoice creates Attention showing who owes what", () => {
    expect(invoiceAttention([invoice()], startOfToday, TZ)).toEqual([
      expect.objectContaining({ category: "invoiceOverdue", title: "Payment overdue", subject: "John Smith • $475.00", actionLabel: "View invoice", href: "/transactions/t1", overdue: true }),
    ]);
  });

  it("paying the invoice resolves it; not-yet-due invoices aren't raised", () => {
    expect(invoiceAttention([invoice({ status: "PAID", balance: new Prisma.Decimal(0) })], startOfToday, TZ)).toEqual([]);
    expect(invoiceAttention([invoice({ balance: new Prisma.Decimal(0) })], startOfToday, TZ)).toEqual([]);
    expect(invoiceAttention([invoice({ dueAt: new Date("2026-09-30T16:00:00Z") })], startOfToday, TZ)).toEqual([]);
    expect(invoiceAttention([invoice({ dueAt: null })], startOfToday, TZ)).toEqual([]);
  });
});

describe("task and Realtor follow-up rules (one Task table)", () => {
  const task = (over: Partial<OpenTask> = {}): OpenTask => ({
    id: "t1",
    title: "Call the seller's agent",
    dueAt: new Date("2026-09-25T16:00:00Z"),
    completedAt: null,
    assigneeId: "u-office",
    assignee: { name: "Olivia" },
    realtor: null,
    transaction: { id: "tx1", property: { addressLine1: "1 Oak", city: "Hickory" } },
    ...over,
  });

  it("an overdue task creates Attention; completing it resolves it", () => {
    expect(taskAttention([task()], TODAY, TZ)).toEqual([expect.objectContaining({ category: "taskOverdue", required: false, title: "Task overdue", subject: "Call the seller's agent", overdue: true, preview: { type: "task", id: "t1" } })]);
    expect(taskAttention([task({ completedAt: new Date() })], TODAY, TZ)).toEqual([]);
    // Due today isn't overdue (it shows in Today instead).
    expect(taskAttention([task({ dueAt: new Date("2026-09-29T16:00:00Z") })], TODAY, TZ)).toEqual([]);
  });

  it("a Realtor follow-up is a Task linked to a Realtor — due today or overdue, with Contact", () => {
    const realtor = { id: "r1", firstName: "Sarah", lastName: "Jones", preferredName: null, phone: "8285550111", email: null };
    expect(taskAttention([task({ realtor, dueAt: new Date("2026-09-29T16:00:00Z") })], TODAY, TZ)).toEqual([
      expect.objectContaining({ category: "realtorFollowUp", title: "Realtor follow-up due today", subject: "Sarah Jones", actionLabel: "Contact", severity: "info" }),
    ]);
    expect(taskAttention([task({ realtor })], TODAY, TZ)[0]).toMatchObject({ title: "Realtor follow-up overdue", severity: "action", overdue: true });
    expect(taskAttention([task({ realtor, dueAt: new Date("2026-10-02T16:00:00Z") })], TODAY, TZ)).toEqual([]);
  });
});

describe("ordering", () => {
  it("critical first, then today's inspection problems, then overdue, then by due date", () => {
    const e = inspection();
    const today = inspectionAttention([e], TODAY, TZ)[0];
    const conflict = { ...today, id: "conflict", severity: "critical" as const, dueAt: "2026-10-05T13:00:00.000Z" };
    const overdueReport = reportAttention([completed()], TODAY, 1, TZ)[0];
    const olderOverdue = reportAttention([completed({ id: "i8", completedAt: new Date("2026-09-10T18:00:00Z") })], TODAY, 1, TZ)[0];
    const review = emailReviewAttention(2)[0];
    const sorted = sortAttention([review, overdueReport, today, olderOverdue, conflict], TODAY, TZ);
    expect(sorted.map((i) => i.id)).toEqual(["conflict", today.id, olderOverdue.id, overdueReport.id, "emailReview"]);
  });
});
