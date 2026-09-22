import { describe, it, expect, vi, beforeEach } from "vitest";

vi.mock("@/lib/prisma", async () => {
  const { createMockPrisma } = await import("@/test-utils/mockPrisma");
  return { prisma: createMockPrisma() };
});
vi.mock("@/lib/auth", () => ({ auth: vi.fn() }));
vi.mock("next/cache", () => ({ revalidatePath: vi.fn() }));

import { prisma } from "@/lib/prisma";
import { auth } from "@/lib/auth";
import { createAppointment, cancelAppointment } from "./actions";

const mockAuth = vi.mocked(auth);
const mockPrisma = prisma as unknown as {
  appointment: { create: ReturnType<typeof vi.fn>; update: ReturnType<typeof vi.fn> };
};

beforeEach(() => {
  vi.clearAllMocks();
  mockAuth.mockResolvedValue({ user: { role: "OFFICE_STAFF" } } as never);
});

describe("createAppointment", () => {
  it("rejects when the session lacks crm:write", async () => {
    mockAuth.mockResolvedValue({ user: { role: "INSPECTOR" } } as never);
    const form = new FormData();
    form.set("title", "Walkthrough");
    form.set("startAt", "2026-01-01T10:00");
    form.set("endAt", "2026-01-01T11:00");
    await expect(createAppointment(form)).rejects.toThrow();
  });

  it("rejects an end time before the start time", async () => {
    const form = new FormData();
    form.set("title", "Walkthrough");
    form.set("startAt", "2026-01-01T11:00");
    form.set("endAt", "2026-01-01T10:00");
    await expect(createAppointment(form)).rejects.toThrow(/end time/i);
    expect(mockPrisma.appointment.create).not.toHaveBeenCalled();
  });

  it("creates an appointment with no transaction attached", async () => {
    mockPrisma.appointment.create.mockResolvedValue({});
    const form = new FormData();
    form.set("title", "Site visit");
    form.set("startAt", "2026-01-01T10:00");
    form.set("endAt", "2026-01-01T11:00");
    await createAppointment(form);

    expect(mockPrisma.appointment.create).toHaveBeenCalledWith({
      data: expect.objectContaining({ title: "Site visit", transactionId: null }),
    });
  });
});

describe("cancelAppointment", () => {
  it("rejects an unauthorized role", async () => {
    mockAuth.mockResolvedValue({ user: { role: "INSPECTOR" } } as never);
    await expect(cancelAppointment("appt-1")).rejects.toThrow();
    expect(mockPrisma.appointment.update).not.toHaveBeenCalled();
  });

  it("sets cancelledAt", async () => {
    mockPrisma.appointment.update.mockResolvedValue({ transactionId: null });
    await cancelAppointment("appt-1");

    expect(mockPrisma.appointment.update).toHaveBeenCalledWith({
      where: { id: "appt-1" },
      data: { cancelledAt: expect.any(Date) },
    });
  });
});
