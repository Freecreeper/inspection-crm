import { describe, it, expect, vi, beforeEach } from "vitest";

vi.mock("@/lib/prisma", async () => {
  const { createMockPrisma } = await import("@/test-utils/mockPrisma");
  return { prisma: createMockPrisma() };
});
vi.mock("@/lib/auth", () => ({ auth: vi.fn() }));
vi.mock("next/cache", () => ({ revalidatePath: vi.fn() }));

import { prisma } from "@/lib/prisma";
import { auth } from "@/lib/auth";
import { createTask, completeTask } from "./actions";

const mockAuth = vi.mocked(auth);
const mockPrisma = prisma as unknown as {
  task: { create: ReturnType<typeof vi.fn>; update: ReturnType<typeof vi.fn> };
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
});
