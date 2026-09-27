import { describe, it, expect, vi, beforeEach } from "vitest";

vi.mock("@/lib/prisma", async () => {
  const { createMockPrisma } = await import("@/test-utils/mockPrisma");
  return { prisma: createMockPrisma() };
});
vi.mock("@/lib/auth", () => ({ auth: vi.fn() }));
vi.mock("next/cache", () => ({ revalidatePath: vi.fn() }));
vi.mock("next/navigation", () => ({
  redirect: vi.fn((url: string) => {
    throw new Error(`NEXT_REDIRECT:${url}`);
  }),
}));
vi.mock("@/lib/email/automations/inspection", () => ({
  onInspectionScheduled: vi.fn(async () => []),
  onInspectionRescheduled: vi.fn(async () => []),
  onInspectionCancelled: vi.fn(async () => []),
  onInspectionCompleted: vi.fn(async () => []),
}));
vi.mock("@/lib/email/automations/registry", () => ({ getAutomation: vi.fn(async () => ({ row: { id: "a1" } })), logAutomationEvent: vi.fn() }));

import { prisma } from "@/lib/prisma";
import { auth } from "@/lib/auth";
import * as hooks from "@/lib/email/automations/inspection";
import { logAutomationEvent } from "@/lib/email/automations/registry";
import { assignInspector, createInspection, rescheduleInspection, updateInspectionConditions, updateInspectionStatus } from "./actions";

type Fn = ReturnType<typeof vi.fn>;
const db = prisma as unknown as Record<string, Record<string, Fn>> & { $transaction: Fn };
const form = (entries: Record<string, string>) => {
  const f = new FormData();
  for (const [k, v] of Object.entries(entries)) f.set(k, v);
  return f;
};

beforeEach(() => {
  vi.clearAllMocks();
  vi.mocked(auth).mockResolvedValue({ user: { id: "u1", role: "OWNER_ADMIN" } } as never);
  db.inspection.update.mockResolvedValue({ id: "i1", transactionId: "t1" });
  db.activityLog.create.mockResolvedValue({});
});

describe("inspection email triggers", () => {
  it("scheduling with a time queues the confirmation after saving", async () => {
    db.inspection.create.mockResolvedValue({ id: "i1", scheduledAt: new Date("2026-10-03T13:00:00Z") });
    await expect(createInspection("t1", form({ propertyId: "p1", scheduledAt: "2026-10-03T09:00" }))).rejects.toThrow("NEXT_REDIRECT");
    expect(hooks.onInspectionScheduled).toHaveBeenCalledWith("i1", { actorId: "u1" });
  });

  it("an email failure never fails the scheduling — it's logged instead", async () => {
    db.inspection.create.mockResolvedValue({ id: "i1", scheduledAt: new Date() });
    vi.mocked(hooks.onInspectionScheduled).mockRejectedValueOnce(new Error("template missing"));
    await expect(createInspection("t1", form({ propertyId: "p1", scheduledAt: "2026-10-03T09:00" }))).rejects.toThrow("NEXT_REDIRECT:/inspections/i1");
    expect(logAutomationEvent).toHaveBeenCalledWith("a1", expect.objectContaining({ result: "FAILED", detail: { reason: "template missing" } }));
  });

  it("unrelated edits (conditions, inspector) never trigger appointment emails", async () => {
    await updateInspectionConditions("i1", form({ weather: "Sunny" }));
    await assignInspector("i1", form({ inspectorId: "u2" }));
    for (const fn of Object.values(hooks)) expect(fn).not.toHaveBeenCalled();
  });

  it("re-saving the same status is a no-op", async () => {
    db.inspection.findUniqueOrThrow.mockResolvedValue({ status: "SCHEDULED" });
    await updateInspectionStatus("i1", form({ status: "SCHEDULED" }));
    expect(db.inspection.update).not.toHaveBeenCalled();
    for (const fn of Object.values(hooks)) expect(fn).not.toHaveBeenCalled();
  });

  it("re-saving the same time is not a reschedule", async () => {
    db.inspection.findUniqueOrThrow.mockResolvedValue({ id: "i1", status: "SCHEDULED", scheduledAt: new Date("2026-10-03T09:00:30"), transactionId: "t1" });
    await rescheduleInspection("i1", form({ scheduledAt: "2026-10-03T09:00" }));
    expect(db.inspection.update).not.toHaveBeenCalled();
    expect(hooks.onInspectionRescheduled).not.toHaveBeenCalled();
  });

  it("a real time change bumps the schedule version and notifies with the previous time", async () => {
    const previous = new Date("2026-10-03T09:00:00");
    db.inspection.findUniqueOrThrow.mockResolvedValue({ id: "i1", status: "SCHEDULED", scheduledAt: previous, transactionId: "t1" });
    await rescheduleInspection("i1", form({ scheduledAt: "2026-10-04T13:00" }));
    expect(db.inspection.update).toHaveBeenCalledWith({ where: { id: "i1" }, data: { scheduledAt: new Date("2026-10-04T13:00"), scheduleVersion: { increment: 1 } } });
    expect(hooks.onInspectionRescheduled).toHaveBeenCalledWith("i1", previous, { actorId: "u1" });
  });

  it("cancelling bumps the version and sends the cancellation path; completing prepares thank-yous", async () => {
    db.inspection.findUniqueOrThrow.mockResolvedValue({ status: "SCHEDULED" });
    await updateInspectionStatus("i1", form({ status: "CANCELLED" }));
    expect(db.inspection.update).toHaveBeenCalledWith({ where: { id: "i1" }, data: { status: "CANCELLED", scheduleVersion: { increment: 1 } } });
    expect(hooks.onInspectionCancelled).toHaveBeenCalled();

    db.inspection.findUniqueOrThrow.mockResolvedValue({ status: "IN_PROGRESS" });
    await updateInspectionStatus("i1", form({ status: "COMPLETED" }));
    expect(hooks.onInspectionCompleted).toHaveBeenCalled();
  });
});
