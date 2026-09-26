import { describe, it, expect, vi, beforeEach } from "vitest";

vi.mock("@/lib/prisma", async () => {
  const { createMockPrisma } = await import("@/test-utils/mockPrisma");
  return { prisma: createMockPrisma() };
});
vi.mock("@/lib/auth", () => ({ auth: vi.fn() }));
vi.mock("next/cache", () => ({ revalidatePath: vi.fn() }));

import { revalidatePath } from "next/cache";
import { prisma } from "@/lib/prisma";
import { auth } from "@/lib/auth";
import { createTask, completeTask, rescheduleTask } from "./actions";

const mockAuth = vi.mocked(auth);
const mockPrisma = prisma as unknown as {
  task: { create: ReturnType<typeof vi.fn>; update: ReturnType<typeof vi.fn>; findUnique: ReturnType<typeof vi.fn> };
  activityLog: { create: ReturnType<typeof vi.fn> };
};

beforeEach(() => {
  // clearAllMocks (not resetAllMocks) — resetting would also wipe the
  // $transaction(cb) => cb(mockPrisma) implementation the shared mock relies
  // on; clearing just drops call history between tests.
  vi.clearAllMocks();
});

describe("createTask", () => {
  it("rejects when there is no session (authentication)", async () => {
    // auth() is overloaded (also usable as NextMiddleware in proxy.ts), which
    // confuses vi.mocked()'s inference for a bare `null` argument — cast it
    // like every other mockResolvedValue call in this file.
    mockAuth.mockResolvedValue(null as never);
    const form = new FormData();
    form.set("title", "Call the customer back");
    await expect(createTask(form)).rejects.toThrow();
    expect(mockPrisma.task.create).not.toHaveBeenCalled();
  });

  it("rejects a role without crm:write (RBAC)", async () => {
    mockAuth.mockResolvedValue({ user: { role: "INSPECTOR" } } as never);
    const form = new FormData();
    form.set("title", "Call the customer back");
    await expect(createTask(form)).rejects.toThrow();
    expect(mockPrisma.task.create).not.toHaveBeenCalled();
  });

  it("requires a title", async () => {
    mockAuth.mockResolvedValue({ user: { role: "OFFICE_STAFF" } } as never);
    const form = new FormData();
    await expect(createTask(form)).rejects.toThrow(/title/i);
  });

  it("creates a general task with no transaction (incomplete-data behavior)", async () => {
    mockAuth.mockResolvedValue({ user: { role: "OFFICE_STAFF" } } as never);
    mockPrisma.task.create.mockResolvedValue({});
    const form = new FormData();
    form.set("title", "Call the vendor back");
    await createTask(form);

    expect(mockPrisma.task.create).toHaveBeenCalledWith({
      data: expect.objectContaining({ title: "Call the vendor back", transactionId: null, assigneeId: null }),
    });
  });
});

describe("completeTask", () => {
  it("rejects an unauthorized role", async () => {
    mockAuth.mockResolvedValue({ user: { role: "REPORTING_ANALYST" } } as never);
    await expect(completeTask("task-1")).rejects.toThrow();
    expect(mockPrisma.task.update).not.toHaveBeenCalled();
  });

  it("marks the task completed", async () => {
    mockAuth.mockResolvedValue({ user: { role: "OWNER_ADMIN" } } as never);
    mockPrisma.task.update.mockResolvedValue({ transactionId: null });
    await completeTask("task-1");

    expect(mockPrisma.task.update).toHaveBeenCalledWith({
      where: { id: "task-1" },
      data: { completedAt: expect.any(Date) },
    });
  });

  it("completing a realtor follow-up updates that same Task, audits it, and refreshes the realtor", async () => {
    mockAuth.mockResolvedValue({ user: { id: "user-1", role: "OFFICE_STAFF" } } as never);
    mockPrisma.task.update.mockResolvedValue({ transactionId: null, realtorId: "r1" });
    await completeTask("task-1");

    expect(mockPrisma.task.update).toHaveBeenCalledWith({ where: { id: "task-1" }, data: { completedAt: expect.any(Date) } });
    expect(mockPrisma.activityLog.create).toHaveBeenCalledWith({
      data: expect.objectContaining({ action: "task.completed", entityType: "Task", entityId: "task-1", actorId: "user-1" }),
    });
    expect(vi.mocked(revalidatePath)).toHaveBeenCalledWith("/realtors/r1");
  });
});

describe("rescheduleTask", () => {
  it("rejects an unauthorized role", async () => {
    mockAuth.mockResolvedValue({ user: { role: "INSPECTOR" } } as never);
    await expect(rescheduleTask("task-1", "2026-10-10")).rejects.toThrow();
    expect(mockPrisma.task.update).not.toHaveBeenCalled();
  });

  it("moves the due date to local noon of the chosen day and audits the change", async () => {
    mockAuth.mockResolvedValue({ user: { id: "user-1", role: "OFFICE_STAFF" } } as never);
    mockPrisma.task.findUnique.mockResolvedValue({ id: "task-1", dueAt: null, completedAt: null });
    mockPrisma.task.update.mockResolvedValue({ transactionId: null, realtorId: "r1" });

    expect(await rescheduleTask("task-1", "2026-10-10")).toEqual({ ok: true });
    const dueAt: Date = mockPrisma.task.update.mock.calls[0][0].data.dueAt;
    expect([dueAt.getFullYear(), dueAt.getMonth(), dueAt.getDate(), dueAt.getHours()]).toEqual([2026, 9, 10, 12]);
    expect(mockPrisma.activityLog.create).toHaveBeenCalledWith({ data: expect.objectContaining({ action: "task.rescheduled" }) });
  });

  it("won't reschedule a completed task or accept a bad date", async () => {
    mockAuth.mockResolvedValue({ user: { role: "OFFICE_STAFF" } } as never);
    expect(await rescheduleTask("task-1", "soon")).toMatchObject({ ok: false });
    mockPrisma.task.findUnique.mockResolvedValue({ id: "task-1", completedAt: new Date() });
    expect(await rescheduleTask("task-1", "2026-10-10")).toMatchObject({ ok: false });
    expect(mockPrisma.task.update).not.toHaveBeenCalled();
  });
});
