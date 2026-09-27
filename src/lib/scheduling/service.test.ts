import { describe, it, expect, vi, beforeEach } from "vitest";
import { Prisma } from "@prisma/client";

vi.mock("@/lib/prisma", async () => {
  const { createMockPrisma } = await import("@/test-utils/mockPrisma");
  return { prisma: createMockPrisma() };
});
vi.mock("@/lib/email/automations/safe", () => ({ runAutomationSafely: vi.fn(async (_ctx: unknown, fn: () => Promise<unknown>) => fn()) }));
vi.mock("@/lib/email/automations/inspection", () => ({
  onInspectionScheduled: vi.fn(async () => []),
  onInspectionRescheduled: vi.fn(async () => []),
  onInspectionCancelled: vi.fn(async () => []),
}));

import { prisma } from "@/lib/prisma";
import { runAutomationSafely } from "@/lib/email/automations/safe";
import * as hooks from "@/lib/email/automations/inspection";
import { cancelInspection, rescheduleInspection, scheduleInspection } from "./service";

type Fn = ReturnType<typeof vi.fn>;
const db = prisma as unknown as Record<string, Record<string, Fn>> & { $queryRaw: Fn; $executeRaw: Fn };

const GENERAL = { id: "s-gen", basePrice: new Prisma.Decimal("450"), defaultDurationMinutes: 180 };
const RADON = { id: "s-rad", basePrice: new Prisma.Decimal("150"), defaultDurationMinutes: 30 };

beforeEach(() => {
  vi.clearAllMocks();
  vi.stubEnv("APP_TIMEZONE", "America/New_York");
  db.property.findUnique.mockResolvedValue({ id: "p1" });
  db.customer.findUnique.mockResolvedValue({ archivedAt: null });
  db.user.findUnique.mockResolvedValue({ active: true });
  db.service.findMany.mockImplementation(async ({ where }: { where: { id: { in: string[] } } }) => [GENERAL, RADON].filter((s) => where.id.in.includes(s.id)));
  db.$queryRaw.mockResolvedValue([]);
  db.$executeRaw.mockResolvedValue(1);
  db.appointment.findMany.mockResolvedValue([]);
  db.transaction.findFirst.mockResolvedValue(null);
  db.transaction.create.mockResolvedValue({ id: "t-new", customers: [] });
  db.inspection.create.mockImplementation(async ({ data }: { data: Record<string, unknown> }) => ({ id: "i-new", ...data }));
  db.activityLog.create.mockResolvedValue({});
});

describe("scheduling an inspection", () => {
  it("needs only a property — no customer, realtor, time, or inspector", async () => {
    const result = await scheduleInspection({ propertyId: "p1" }, "u1");
    expect(result).toEqual({ ok: true, data: { inspectionId: "i-new", transactionId: "t-new" } });
    expect(db.inspection.create).toHaveBeenCalledWith({ data: expect.objectContaining({ propertyId: "p1", scheduledAt: null, inspectorId: null, status: "SCHEDULED", durationMinutes: 180 }) });
    // Not on the calendar yet, so nothing to confirm.
    expect(hooks.onInspectionScheduled).not.toHaveBeenCalled();
  });

  it("a customer with no email and no realtor never block scheduling; the confirmation automation still runs", async () => {
    const result = await scheduleInspection({ propertyId: "p1", customerId: "c1", day: "2026-09-29", time: "09:00" }, "u1");
    expect(result.ok).toBe(true);
    expect(db.transactionCustomer.create).toHaveBeenCalledWith({ data: expect.objectContaining({ customerId: "c1", primaryContact: true }) });
    expect(db.transactionRealtor.create).not.toHaveBeenCalled();
    expect(runAutomationSafely).toHaveBeenCalledWith(expect.objectContaining({ key: "inspection_confirmation", entityId: "i-new" }), expect.any(Function));
    expect(hooks.onInspectionScheduled).toHaveBeenCalledWith("i-new", { actorId: "u1" });
  });

  it("stores the business-time-zone start and the chosen services' longest default duration", async () => {
    await scheduleInspection({ propertyId: "p1", serviceIds: ["s-gen", "s-rad"], day: "2026-09-29", time: "09:00" }, "u1");
    const data = db.inspection.create.mock.calls[0][0].data;
    expect(data.scheduledAt.toISOString()).toBe("2026-09-29T13:00:00.000Z");
    expect(data.durationMinutes).toBe(180);
    expect(data.inspectionServices.create).toEqual([
      { serviceId: "s-gen", price: GENERAL.basePrice },
      { serviceId: "s-rad", price: RADON.basePrice },
    ]);
  });

  it("an explicit duration overrides the default; nonsense durations are refused", async () => {
    await scheduleInspection({ propertyId: "p1", serviceIds: ["s-rad"], day: "2026-09-29", time: "09:00", durationMinutes: 90 }, "u1");
    expect(db.inspection.create.mock.calls[0][0].data.durationMinutes).toBe(90);
    expect(await scheduleInspection({ propertyId: "p1", day: "2026-09-29", time: "09:00", durationMinutes: 7 }, "u1")).toMatchObject({ ok: false });
  });

  it("reuses the property's open transaction for this customer instead of starting another", async () => {
    db.transaction.findFirst.mockResolvedValue({ id: "t-open", customers: [{ customerId: "c1", primaryContact: true }] });
    const result = await scheduleInspection({ propertyId: "p1", customerId: "c1", day: "2026-09-29", time: "09:00" }, "u1");
    expect(result).toMatchObject({ ok: true, data: { transactionId: "t-open" } });
    expect(db.transaction.create).not.toHaveBeenCalled();
    expect(db.transactionCustomer.create).not.toHaveBeenCalled();
  });

  it("detects an overlapping inspection for the same inspector and refuses to save it — whatever the client said", async () => {
    db.$queryRaw.mockResolvedValue([{ id: "i-other", scheduledAt: new Date("2026-09-29T13:00:00Z"), durationMinutes: 180, addressLine1: "123 Main Street", city: "Hickory" }]);
    const result = await scheduleInspection({ propertyId: "p1", inspectorId: "u-ed", day: "2026-09-29", time: "11:00", durationMinutes: 180 }, "u1");
    expect(result).toMatchObject({ ok: false, conflicts: [{ kind: "inspection", id: "i-other", title: "123 Main Street, Hickory", start: "2026-09-29T13:00:00.000Z", end: "2026-09-29T16:00:00.000Z" }] });
    expect(db.inspection.create).not.toHaveBeenCalled();
    expect(db.transaction.create).not.toHaveBeenCalled();
    // The check runs under a per-inspector lock.
    expect(db.$executeRaw).toHaveBeenCalled();
    // And it looks for overlap, not just the same start time.
    const sql = db.$queryRaw.mock.calls[0][0] as Prisma.Sql;
    expect(sql.sql).toContain(`"scheduledAt" + (i."durationMinutes" * INTERVAL '1 minute') >`);
    expect(sql.values).toContain("u-ed");
  });

  it("blocked time (vacation, meeting) is a conflict too", async () => {
    db.appointment.findMany.mockResolvedValue([{ id: "b1", title: "Vacation", startAt: new Date("2026-09-29T12:00:00Z"), endAt: new Date("2026-09-29T22:00:00Z") }]);
    const result = await scheduleInspection({ propertyId: "p1", inspectorId: "u-ed", day: "2026-09-29", time: "09:00" }, "u1");
    expect(result).toMatchObject({ ok: false, conflicts: [{ kind: "block", title: "Vacation" }] });
  });

  it("records who scheduled what in the activity log", async () => {
    await scheduleInspection({ propertyId: "p1", inspectorId: "u-ed", day: "2026-09-29", time: "09:00" }, "u1");
    expect(db.activityLog.create).toHaveBeenCalledWith({
      data: expect.objectContaining({ actorId: "u1", action: "inspection.scheduled", entityId: "i-new", after: expect.objectContaining({ scheduledAt: "2026-09-29T13:00:00.000Z", inspectorId: "u-ed" }) }),
    });
  });
});

describe("rescheduling", () => {
  const current = { id: "i1", status: "SCHEDULED", transactionId: "t1", scheduledAt: new Date("2026-09-29T13:00:00Z"), durationMinutes: 180, inspectorId: "u-ed" };
  beforeEach(() => db.inspection.findUnique.mockResolvedValue(current));

  it("updates the authoritative schedule, bumps the version, and audits old → new", async () => {
    const result = await rescheduleInspection("i1", { day: "2026-09-30", time: "10:00" }, "u1");
    expect(result).toEqual({ ok: true, data: { changed: true, transactionId: "t1" } });
    expect(db.inspection.update).toHaveBeenCalledWith({
      where: { id: "i1" },
      data: { scheduledAt: new Date("2026-09-30T14:00:00Z"), durationMinutes: 180, inspectorId: "u-ed", scheduleVersion: { increment: 1 } },
    });
    expect(db.activityLog.create).toHaveBeenCalledWith({
      data: expect.objectContaining({ action: "inspection.rescheduled", before: { scheduledAt: "2026-09-29T13:00:00.000Z" }, after: { scheduledAt: "2026-09-30T14:00:00.000Z" } }),
    });
  });

  it("fires the appointment-change automation with the previous time (which withdraws the stale reminder and schedules a new one)", async () => {
    await rescheduleInspection("i1", { day: "2026-09-30", time: "10:00" }, "u1");
    expect(runAutomationSafely).toHaveBeenCalledWith(expect.objectContaining({ key: "appointment_change", entityId: "i1" }), expect.any(Function));
    expect(hooks.onInspectionRescheduled).toHaveBeenCalledWith("i1", current.scheduledAt, { actorId: "u1", notify: true });
  });

  it("notify off is passed through; the reminder is still re-created by the hook", async () => {
    await rescheduleInspection("i1", { day: "2026-09-30", time: "10:00", notify: false }, "u1");
    expect(hooks.onInspectionRescheduled).toHaveBeenCalledWith("i1", current.scheduledAt, { actorId: "u1", notify: false });
  });

  it("the same minute is not a reschedule: no write, no email", async () => {
    const result = await rescheduleInspection("i1", { day: "2026-09-29", time: "09:00" }, "u1");
    expect(result).toMatchObject({ ok: true, data: { changed: false } });
    expect(db.inspection.update).not.toHaveBeenCalled();
    expect(hooks.onInspectionRescheduled).not.toHaveBeenCalled();
  });

  it("reassigning or changing duration is checked for conflicts and audited, but sends no reschedule email", async () => {
    await rescheduleInspection("i1", { inspectorId: "u-pat", durationMinutes: 240 }, "u1");
    expect(db.inspection.update.mock.calls[0][0].data).toEqual({ scheduledAt: current.scheduledAt, durationMinutes: 240, inspectorId: "u-pat" });
    expect((db.$queryRaw.mock.calls[0][0] as Prisma.Sql).values).toEqual(expect.arrayContaining(["u-pat", "i1"]));
    const actions = db.activityLog.create.mock.calls.map((c) => c[0].data.action);
    expect(actions).toEqual(["inspection.duration_changed", "inspection.inspector_reassigned"]);
    expect(hooks.onInspectionRescheduled).not.toHaveBeenCalled();
  });

  it("rejects a move onto another inspection, excluding the one being moved", async () => {
    db.$queryRaw.mockResolvedValue([{ id: "i2", scheduledAt: new Date("2026-09-30T13:00:00Z"), durationMinutes: 180, addressLine1: "455 Oak Avenue", city: "Hickory" }]);
    const result = await rescheduleInspection("i1", { day: "2026-09-30", time: "10:00" }, "u1");
    expect(result).toMatchObject({ ok: false, conflicts: [{ id: "i2" }] });
    expect(db.inspection.update).not.toHaveBeenCalled();
  });

  it("only a scheduled inspection can be moved", async () => {
    db.inspection.findUnique.mockResolvedValue({ ...current, status: "COMPLETED" });
    expect(await rescheduleInspection("i1", { day: "2026-09-30", time: "10:00" }, "u1")).toEqual({ ok: false, error: "Only a scheduled inspection can be rescheduled." });
  });
});

describe("cancelling", () => {
  const current = { id: "i1", status: "SCHEDULED", transactionId: "t1", scheduledAt: new Date("2026-09-29T13:00:00Z") };

  it("marks it cancelled (never deletes it), bumps the version, audits, and runs the cancellation automation", async () => {
    db.inspection.findUnique.mockResolvedValue(current);
    const result = await cancelInspection("i1", { reason: "Buyer walked" }, "u1");
    expect(result).toEqual({ ok: true, data: { changed: true, transactionId: "t1" } });
    expect(db.inspection.update).toHaveBeenCalledWith({ where: { id: "i1" }, data: { status: "CANCELLED", scheduleVersion: { increment: 1 } } });
    expect(db.inspection.delete).not.toHaveBeenCalled();
    expect(db.activityLog.create).toHaveBeenCalledWith({ data: expect.objectContaining({ action: "inspection.cancelled", after: { status: "CANCELLED", reason: "Buyer walked" } }) });
    expect(hooks.onInspectionCancelled).toHaveBeenCalledWith("i1", { actorId: "u1", notify: true });
  });

  it("is idempotent, and a completed inspection can't be cancelled", async () => {
    db.inspection.findUnique.mockResolvedValue({ ...current, status: "CANCELLED" });
    expect(await cancelInspection("i1", {}, "u1")).toEqual({ ok: true, data: { changed: false, transactionId: "t1" } });
    db.inspection.findUnique.mockResolvedValue({ ...current, status: "COMPLETED" });
    expect(await cancelInspection("i1", {}, "u1")).toMatchObject({ ok: false });
    expect(db.inspection.update).not.toHaveBeenCalled();
  });
});
