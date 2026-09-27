import { describe, it, expect, vi, beforeEach } from "vitest";

vi.mock("@/lib/prisma", async () => {
  const { createMockPrisma } = await import("@/test-utils/mockPrisma");
  return { prisma: createMockPrisma() };
});

import { prisma } from "@/lib/prisma";
import { primeEmailDb, type MockDb } from "@/test-utils/emailFixtures";
import { evaluateGuardCheck } from "../guards";
import { onInspectionCancelled, onInspectionRescheduled, onInspectionScheduled } from "./inspection";

const db = prisma as unknown as MockDb;
const NOW = new Date("2026-09-27T12:00:00Z");
const IN_THREE_DAYS = new Date("2026-09-30T13:00:00Z");

let rows: Map<string, Record<string, unknown>>;
let inspection: Record<string, unknown>;

const customers = [
  { id: "c1", firstName: "John", lastName: "Smith", email: "john@example.com" },
  { id: "c2", firstName: "Jane", lastName: "Smith", email: null },
];

beforeEach(() => {
  vi.clearAllMocks();
  rows = primeEmailDb(db);
  inspection = {
    id: "i1",
    transactionId: "t1",
    status: "SCHEDULED",
    scheduledAt: IN_THREE_DAYS,
    scheduleVersion: 0,
    property: { addressLine1: "123 Main Street", city: "Hickory", state: "NC", zip: "28601" },
    inspector: { name: "Jordan Inspector" },
    inspectionServices: [],
    transaction: {
      customers: customers.map((c, i) => ({ primaryContact: i === 0, customer: c })),
      realtors: [{ role: "BUYER_AGENT", realtor: { id: "r1", firstName: "Sarah", lastName: "Jones", email: "sarah@kw.test", archivedAt: null } }],
    },
  };
  db.inspection.findUnique.mockImplementation(async () => inspection);
  db.customer.findUnique.mockImplementation(async ({ where }: { where: { id: string } }) => customers.find((c) => c.id === where.id) ?? null);
  db.realtor.findUnique.mockResolvedValue(null);
  db.transaction.findUnique.mockResolvedValue(null);
  db.automation.findMany.mockResolvedValue([{ id: "auto-inspection_confirmation" }, { id: "auto-inspection_reminder" }, { id: "auto-appointment_change" }]);
});

const byKey = (fragment: string) => [...rows.values()].filter((r) => String(r.idempotencyKey).includes(fragment));

describe("inspection confirmation", () => {
  it("queues exactly once per customer, however many times the event fires", async () => {
    await onInspectionScheduled("i1", { now: NOW });
    await onInspectionScheduled("i1", { now: NOW });
    await onInspectionScheduled("i1", { now: NOW, quiet: true });

    const confirmations = byKey(":confirmation:");
    expect(confirmations).toHaveLength(2);
    expect(confirmations.find((r) => r.customerId === "c1")).toMatchObject({ status: "QUEUED", mode: "AUTOMATIC", category: "TRANSACTIONAL" });
  });

  it("a customer with no email is SKIPPED with a reason — the others still go", async () => {
    await onInspectionScheduled("i1", { now: NOW });
    const jane = byKey(":confirmation:customer:c2")[0];
    expect(jane).toMatchObject({ status: "SKIPPED", statusReason: "Customer email not provided" });
    expect(byKey(":confirmation:customer:c1")[0]).toMatchObject({ status: "QUEUED" });
  });

  it("doesn't email the realtor unless that's explicitly switched on", async () => {
    await onInspectionScheduled("i1", { now: NOW });
    expect([...rows.values()].some((r) => r.realtorId === "r1")).toBe(false);
  });

  it("schedules the reminder for the current appointment version, 24h ahead", async () => {
    await onInspectionScheduled("i1", { now: NOW });
    const reminder = byKey(":reminder:v0:customer:c1")[0];
    expect(reminder).toMatchObject({ status: "SCHEDULED" });
    expect((reminder.scheduledFor as Date).toISOString()).toBe("2026-09-29T13:00:00.000Z");
  });

  it("does nothing for an inspection without a scheduled time", async () => {
    inspection.scheduledAt = null;
    await onInspectionScheduled("i1", { now: NOW });
    expect(rows.size).toBe(0);
  });
});

describe("reminders never send stale information", () => {
  it("a reminder is refused once the inspection is cancelled", async () => {
    db.inspection.findUnique.mockResolvedValue({ status: "CANCELLED", scheduleVersion: 1, scheduledAt: IN_THREE_DAYS });
    const result = await evaluateGuardCheck({ kind: "inspectionScheduled", inspectionId: "i1", scheduleVersion: 1 });
    expect(result).toEqual({ ok: false, reason: "Inspection is cancelled" });
  });

  it("a reminder written for the old time is refused after a reschedule", async () => {
    db.inspection.findUnique.mockResolvedValue({ status: "SCHEDULED", scheduleVersion: 2, scheduledAt: IN_THREE_DAYS });
    const result = await evaluateGuardCheck({ kind: "inspectionScheduled", inspectionId: "i1", scheduleVersion: 1 });
    expect(result).toEqual({ ok: false, reason: "Appointment changed after this email was written" });
  });

  it("cancelling withdraws pending reminders and sends one cancellation notice", async () => {
    await onInspectionScheduled("i1", { now: NOW });
    inspection = { ...inspection, status: "CANCELLED", scheduleVersion: 1 };
    await onInspectionCancelled("i1", { now: NOW });

    expect(db.emailMessage.updateMany).toHaveBeenCalledWith({
      where: { inspectionId: "i1", automationId: { in: ["auto-inspection_confirmation", "auto-inspection_reminder", "auto-appointment_change"] }, status: { in: ["SCHEDULED", "QUEUED"] } },
      data: expect.objectContaining({ status: "CANCELLED", statusReason: "Inspection cancelled" }),
    });
    const notice = byKey(":cancelled:v1:customer:c1")[0];
    expect(notice).toMatchObject({ status: "QUEUED", subject: "Your inspection at 123 Main Street has been cancelled" });
    expect(notice.guard).toMatchObject({ checks: [{ kind: "inspectionCancelled", scheduleVersion: 1 }] });
  });
});

describe("appointment changed", () => {
  it("rescheduling withdraws the old reminder, sends an update with both times, and schedules a new reminder", async () => {
    await onInspectionScheduled("i1", { now: NOW });
    const previous = inspection.scheduledAt as Date;
    inspection = { ...inspection, scheduledAt: new Date("2026-10-02T15:00:00Z"), scheduleVersion: 1 };
    await onInspectionRescheduled("i1", previous, { now: NOW });

    expect(db.emailMessage.updateMany).toHaveBeenCalledWith(expect.objectContaining({ data: expect.objectContaining({ statusReason: "Inspection rescheduled" }) }));
    const update = byKey(":updated:v1:customer:c1")[0];
    expect(update).toMatchObject({ status: "QUEUED", templateId: "tpl-appointment_updated" });
    expect(update.bodyText).toContain("Previously Wednesday, September 30, 2026");
    expect(byKey(":reminder:v1:customer:c1")).toHaveLength(1);
    // The old confirmation isn't repeated for a reschedule.
    expect(byKey(":confirmation:")).toHaveLength(2);
  });

  it("with notify off (staff unticked it), the stale reminder is still withdrawn and a new one scheduled — only the notice is skipped", async () => {
    await onInspectionScheduled("i1", { now: NOW });
    const previous = inspection.scheduledAt as Date;
    inspection = { ...inspection, scheduledAt: new Date("2026-10-02T15:00:00Z"), scheduleVersion: 1 };
    await onInspectionRescheduled("i1", previous, { now: NOW, notify: false });

    expect(db.emailMessage.updateMany).toHaveBeenCalledWith(expect.objectContaining({ data: expect.objectContaining({ statusReason: "Inspection rescheduled" }) }));
    expect(byKey(":updated:")).toHaveLength(0);
    expect(byKey(":reminder:v1:customer:c1")[0]).toMatchObject({ status: "SCHEDULED" });
  });

  it("cancelling with notify off withdraws reminders but sends no cancellation notice", async () => {
    await onInspectionScheduled("i1", { now: NOW });
    inspection = { ...inspection, status: "CANCELLED", scheduleVersion: 1 };
    await onInspectionCancelled("i1", { now: NOW, notify: false });
    expect(db.emailMessage.updateMany).toHaveBeenCalledWith(expect.objectContaining({ data: expect.objectContaining({ statusReason: "Inspection cancelled" }) }));
    expect(byKey(":cancelled:")).toHaveLength(0);
  });
});
