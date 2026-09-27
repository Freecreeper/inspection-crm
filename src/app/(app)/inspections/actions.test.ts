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
  onInspectionCompleted: vi.fn(async () => []),
}));
vi.mock("@/lib/email/automations/registry", () => ({ getAutomation: vi.fn(async () => ({ row: { id: "a1" } })), logAutomationEvent: vi.fn() }));
vi.mock("@/lib/scheduling/service", () => ({
  scheduleInspection: vi.fn(async () => ({ ok: true, data: { inspectionId: "i1", transactionId: "t1" } })),
  rescheduleInspection: vi.fn(async () => ({ ok: true, data: { changed: true, transactionId: "t1" } })),
  cancelInspection: vi.fn(async () => ({ ok: true, data: { changed: true, transactionId: "t1" } })),
}));

import { prisma } from "@/lib/prisma";
import { auth } from "@/lib/auth";
import * as hooks from "@/lib/email/automations/inspection";
import * as service from "@/lib/scheduling/service";
import { assignInspector, createInspection, rescheduleInspection, updateInspectionConditions, updateInspectionStatus } from "./actions";

type Fn = ReturnType<typeof vi.fn>;
const db = prisma as unknown as Record<string, Record<string, Fn>> & { $transaction: Fn };
const form = (entries: Record<string, string>) => {
  const f = new FormData();
  for (const [k, v] of Object.entries(entries)) f.set(k, v);
  return f;
};
const as = (role: string) => vi.mocked(auth).mockResolvedValue({ user: { id: "u1", role } } as never);

beforeEach(() => {
  vi.clearAllMocks();
  as("OWNER_ADMIN");
  db.inspection.update.mockResolvedValue({ id: "i1", transactionId: "t1" });
  db.activityLog.create.mockResolvedValue({});
});

describe("inspection page actions go through the shared scheduling service", () => {
  it("scheduling passes the datetime-local value as a business-time-zone day + time", async () => {
    await expect(createInspection("t1", form({ propertyId: "p1", scheduledAt: "2026-10-03T09:00", inspectorId: "u2" }))).rejects.toThrow("NEXT_REDIRECT:/inspections/i1");
    expect(service.scheduleInspection).toHaveBeenCalledWith(
      { transactionId: "t1", propertyId: "p1", inspectorId: "u2", day: "2026-10-03", time: "09:00" },
      "u1"
    );
  });

  it("a scheduling conflict surfaces as an error, not a redirect", async () => {
    vi.mocked(service.scheduleInspection).mockResolvedValueOnce({ ok: false, error: "That time overlaps something already on the inspector's calendar.", conflicts: [] });
    await expect(createInspection("t1", form({ propertyId: "p1", scheduledAt: "2026-10-03T09:00" }))).rejects.toThrow(/overlaps/);
  });

  it("rescheduling needs inspection:reschedule and delegates with the new day/time", async () => {
    as("INSPECTOR");
    await expect(rescheduleInspection("i1", form({ scheduledAt: "2026-10-04T13:00" }))).rejects.toThrow();
    expect(service.rescheduleInspection).not.toHaveBeenCalled();

    as("OFFICE_STAFF");
    await rescheduleInspection("i1", form({ scheduledAt: "2026-10-04T13:00" }));
    expect(service.rescheduleInspection).toHaveBeenCalledWith("i1", { day: "2026-10-04", time: "13:00" }, "u1");
  });

  it("reassigning a scheduled inspection is conflict-checked via the service", async () => {
    db.inspection.findUniqueOrThrow.mockResolvedValue({ status: "SCHEDULED", scheduledAt: new Date(), inspectorId: "u1" });
    await assignInspector("i1", form({ inspectorId: "u2" }));
    expect(service.rescheduleInspection).toHaveBeenCalledWith("i1", { inspectorId: "u2" }, "u1");
  });

  it("cancelling via the status control needs inspection:cancel and uses the shared cancel path", async () => {
    as("REPORTING_ANALYST");
    await expect(updateInspectionStatus("i1", form({ status: "CANCELLED" }))).rejects.toThrow();
    as("INSPECTOR");
    await updateInspectionStatus("i1", form({ status: "CANCELLED" }));
    expect(service.cancelInspection).toHaveBeenCalledWith("i1", {}, "u1");
    expect(db.inspection.update).not.toHaveBeenCalled();
  });

  it("completing still prepares thank-yous; re-saving the same status is a no-op", async () => {
    db.inspection.findUniqueOrThrow.mockResolvedValue({ status: "IN_PROGRESS" });
    await updateInspectionStatus("i1", form({ status: "COMPLETED" }));
    expect(hooks.onInspectionCompleted).toHaveBeenCalled();

    vi.clearAllMocks();
    db.inspection.findUniqueOrThrow.mockResolvedValue({ status: "SCHEDULED" });
    await updateInspectionStatus("i1", form({ status: "SCHEDULED" }));
    expect(db.inspection.update).not.toHaveBeenCalled();
  });

  it("unrelated edits (conditions) never touch the schedule", async () => {
    await updateInspectionConditions("i1", form({ weather: "Sunny" }));
    expect(service.rescheduleInspection).not.toHaveBeenCalled();
    expect(service.cancelInspection).not.toHaveBeenCalled();
  });
});
