import { describe, it, expect, vi, beforeEach } from "vitest";
import { Prisma } from "@prisma/client";

vi.mock("@/lib/prisma", async () => {
  const { createMockPrisma } = await import("@/test-utils/mockPrisma");
  return { prisma: createMockPrisma() };
});

import { prisma } from "@/lib/prisma";
import { primeEmailDb, type MockDb } from "@/test-utils/emailFixtures";
import { invoiceReminderStage, sweepInvoiceReminders } from "./invoice";
import { onReportDeliveryCreated } from "./report";
import { onInspectionCompleted } from "./inspection";
import { matchingMonthDays, sweepRealtorAnniversaries, sweepRealtorBirthdays, targetCalendarDate } from "./relationship";

const db = prisma as unknown as MockDb;
let rows: Map<string, Record<string, unknown>>;
const D = (n: string | number) => new Prisma.Decimal(n);

beforeEach(() => {
  vi.clearAllMocks();
  rows = primeEmailDb(db, { automations: { payment_reminder: { active: true } } });
  db.customer.findUnique.mockResolvedValue({ id: "c1", firstName: "John", lastName: "Smith", email: "john@example.com" });
  db.realtor.findUnique.mockImplementation(async ({ where }: { where: { id: string } }) => ({
    id: where.id,
    firstName: "Sarah",
    lastName: "Jones",
    preferredName: null,
    email: "sarah@kw.test",
    archivedAt: null,
    relationshipEmailsEnabled: true,
    marketingOptIn: false,
    marketingUnsubscribedAt: null,
    careerStartDate: new Date("2016-10-01T00:00:00Z"),
    relationshipStartDate: null,
    brokerage: { name: "Keller Williams" },
  }));
  db.transaction.findUnique.mockResolvedValue(null);
});

describe("payment reminders", () => {
  const cfg = { daysBeforeDue: 3, overdueRepeatDays: 7, maxOverdueReminders: 2 };
  const due = new Date("2026-10-10T12:00:00Z");

  it("derives the reminder stage deterministically from the due date", () => {
    expect(invoiceReminderStage(due, new Date("2026-10-01T12:00:00Z"), cfg)).toBeNull();
    expect(invoiceReminderStage(due, new Date("2026-10-08T12:00:00Z"), cfg)).toBe("due-soon");
    expect(invoiceReminderStage(due, new Date("2026-10-11T12:00:00Z"), cfg)).toBe("overdue-1");
    expect(invoiceReminderStage(due, new Date("2026-10-18T12:00:00Z"), cfg)).toBe("overdue-2");
    expect(invoiceReminderStage(due, new Date("2026-10-30T12:00:00Z"), cfg)).toBeNull();
  });

  function invoice(status: string, paid: string) {
    return {
      id: "inv-1",
      invoiceNumber: "INV-1042",
      status,
      dueAt: new Date("2026-09-29T12:00:00Z"),
      transactionId: "t1",
      items: [{ amount: D("450.00") }],
      payments: paid === "0" ? [] : [{ amount: D(paid) }],
      transaction: { customers: [{ primaryContact: true, customer: { id: "c1", firstName: "John", lastName: "Smith", email: "john@example.com" } }] },
    };
  }

  it("an outstanding invoice gets a reminder, keyed so it goes out once per stage", async () => {
    db.invoice.findMany.mockResolvedValue([invoice("SENT", "100.00")]);
    db.invoice.findUnique.mockResolvedValue(invoice("SENT", "100.00"));
    await sweepInvoiceReminders(new Date("2026-09-27T12:00:00Z"));
    await sweepInvoiceReminders(new Date("2026-09-27T13:00:00Z"));
    const reminders = [...rows.values()];
    expect(reminders).toHaveLength(1);
    expect(reminders[0]).toMatchObject({ idempotencyKey: "invoice:inv-1:reminder:due-soon", status: "QUEUED", customerId: "c1" });
    expect(reminders[0].bodyText).toContain("balance of $350.00");
    expect(reminders[0].guard).toEqual({ checks: [{ kind: "invoiceCollectible", invoiceId: "inv-1" }] });
  });

  it("a paid invoice is never reminded", async () => {
    db.invoice.findMany.mockResolvedValue([invoice("PAID", "450.00"), invoice("SENT", "450.00")]);
    await sweepInvoiceReminders(new Date("2026-09-27T12:00:00Z"));
    expect(rows.size).toBe(0);
  });
});

describe("report ready", () => {
  it("emails only the delivery's explicitly chosen recipient, pinned to that delivery (and version)", async () => {
    db.reportDelivery.findUnique.mockResolvedValue({
      id: "del-1",
      versionId: "ver-2",
      recipientType: "CUSTOMER",
      recipientName: "John Smith",
      recipientEmail: "john@example.com",
      report: { inspectionId: "i1", reportNumber: "RPT-1", inspection: { transactionId: "t1" } },
      version: { versionNumber: 2 },
    });
    db.inspection.findUnique.mockResolvedValue(null);
    await onReportDeliveryCreated("del-1");

    const all = [...rows.values()];
    expect(all).toHaveLength(1);
    expect(all[0]).toMatchObject({ reportDeliveryId: "del-1", recipientEmail: "john@example.com", idempotencyKey: "report-delivery:del-1" });
    expect(all[0].bodyText).toContain("{{report.secureLink}}");
    expect(all.some((m) => m.realtorId)).toBe(false);
  });

  it("completing an inspection never emails a report to anyone — the realtor only gets a thank-you draft", async () => {
    db.inspection.findUnique.mockResolvedValue({
      id: "i1",
      transactionId: "t1",
      status: "COMPLETED",
      property: { addressLine1: "123 Main Street", city: "Hickory", state: "NC", zip: "28601" },
      inspector: null,
      inspectionServices: [],
      transaction: { customers: [], realtors: [{ role: "BUYER_AGENT", realtor: { id: "r1", firstName: "Sarah", lastName: "Jones", email: "sarah@kw.test" } }] },
    });
    await onInspectionCompleted("i1");
    const all = [...rows.values()];
    expect(all).toHaveLength(1);
    expect(all[0]).toMatchObject({ category: "RELATIONSHIP", status: "DRAFT", templateId: "tpl-realtor_thank_you", reportDeliveryId: null });
  });
});

describe("realtor thank-you", () => {
  it("creates one draft per realtor per completed inspection, even if listed twice or completed twice", async () => {
    const realtor = { id: "r1", firstName: "Sarah", lastName: "Jones", email: "sarah@kw.test" };
    db.inspection.findUnique.mockResolvedValue({
      id: "i1",
      transactionId: "t1",
      status: "COMPLETED",
      property: { addressLine1: "123 Main Street", city: "Hickory", state: "NC", zip: "28601" },
      inspector: null,
      inspectionServices: [],
      transaction: {
        customers: [],
        realtors: [
          { role: "BUYER_AGENT", realtor },
          { role: "TRANSACTION_COORDINATOR", realtor },
          { role: "LISTING_AGENT", realtor },
        ],
      },
    });
    await onInspectionCompleted("i1");
    await onInspectionCompleted("i1");
    expect([...rows.values()].filter((r) => r.realtorId === "r1")).toHaveLength(1);
  });

  it("skips safely when the realtor has no email", async () => {
    db.realtor.findUnique.mockResolvedValue({ archivedAt: null, relationshipEmailsEnabled: true, marketingOptIn: false, marketingUnsubscribedAt: null });
    db.inspection.findUnique.mockResolvedValue({
      id: "i1",
      transactionId: "t1",
      status: "COMPLETED",
      property: null,
      inspector: null,
      inspectionServices: [],
      transaction: { customers: [], realtors: [{ role: "BUYER_AGENT", realtor: { id: "r2", firstName: "Dana", lastName: "Noemail", email: null } }] },
    });
    await onInspectionCompleted("i1");
    expect([...rows.values()][0]).toMatchObject({ status: "SKIPPED", statusReason: "Realtor email not provided" });
  });
});

describe("birthdays and anniversaries", () => {
  it("targets the calendar day in the company's time zone", () => {
    expect(targetCalendarDate(new Date("2026-10-01T02:00:00Z"), 0, "America/New_York")).toEqual({ year: 2026, month: 9, day: 30 });
    expect(targetCalendarDate(new Date("2026-10-01T02:00:00Z"), 1, "America/New_York")).toEqual({ year: 2026, month: 10, day: 1 });
  });

  it("celebrates Feb 29 birthdays on Feb 28 in non-leap years", () => {
    expect(matchingMonthDays({ year: 2027, month: 2, day: 28 })).toEqual([{ month: 2, day: 28 }, { month: 2, day: 29 }]);
    expect(matchingMonthDays({ year: 2028, month: 2, day: 28 })).toEqual([{ month: 2, day: 28 }]);
  });

  it("prepares a birthday draft only for realtors whose optional birthday matches", async () => {
    db.realtor.findMany.mockResolvedValue([{ id: "r1", firstName: "Sarah", lastName: "Jones", email: "sarah@kw.test" }]);
    await sweepRealtorBirthdays(new Date("2026-10-02T16:00:00Z"));
    expect(db.realtor.findMany).toHaveBeenCalledWith(expect.objectContaining({ where: { archivedAt: null, OR: [{ birthdayMonth: 10, birthdayDay: 3 }] } }));
    const [draft] = [...rows.values()];
    expect(draft).toMatchObject({ status: "DRAFT", mode: "REVIEW", idempotencyKey: "birthday:r1:2026", subject: "Happy birthday, Sarah!" });
  });

  it("does nothing when no realtor has a birthday on file", async () => {
    db.realtor.findMany.mockResolvedValue([]);
    await sweepRealtorBirthdays(new Date("2026-10-02T16:00:00Z"));
    expect(rows.size).toBe(0);
  });

  it("uses the career start date for career anniversaries, never the relationship date", async () => {
    db.$queryRaw.mockResolvedValueOnce([{ id: "r1", firstName: "Sarah", lastName: "Jones", email: "sarah@kw.test" }]).mockResolvedValueOnce([]);
    await sweepRealtorAnniversaries(new Date("2026-10-01T16:00:00Z"));
    const sql = db.$queryRaw.mock.calls[0][0] as Prisma.Sql;
    expect(sql.sql).toContain('"careerStartDate"');
    expect(sql.values).toEqual(expect.arrayContaining([2026, 10, 1]));
    const [draft] = [...rows.values()];
    expect(draft).toMatchObject({ idempotencyKey: "career-anniversary:r1:2026", subject: "Congratulations on 10 years in real estate" });
    expect((db.$queryRaw.mock.calls[1][0] as Prisma.Sql).sql).toContain('"relationshipStartDate"');
  });
});
