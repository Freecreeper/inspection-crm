import { describe, it, expect, vi, beforeEach } from "vitest";

vi.mock("@/lib/prisma", async () => {
  const { createMockPrisma } = await import("@/test-utils/mockPrisma");
  return { prisma: createMockPrisma() };
});
vi.mock("@/lib/auth", () => ({ auth: vi.fn() }));
vi.mock("next/cache", () => ({ revalidatePath: vi.fn() }));

import { prisma } from "@/lib/prisma";
import { auth } from "@/lib/auth";
import { createRealtor, changeRealtorBrokerage } from "./actions";

const mockAuth = vi.mocked(auth);
const mockPrisma = prisma as unknown as {
  realtor: { create: ReturnType<typeof vi.fn>; update: ReturnType<typeof vi.fn> };
  realtorBrokerageHistory: { create: ReturnType<typeof vi.fn>; updateMany: ReturnType<typeof vi.fn> };
};

beforeEach(() => {
  vi.clearAllMocks();
  mockAuth.mockResolvedValue({ user: { role: "OFFICE_STAFF" } } as never);
});

describe("createRealtor", () => {
  it("rejects an unauthorized role", async () => {
    mockAuth.mockResolvedValue({ user: { role: "INSPECTOR" } } as never);
    const form = new FormData();
    form.set("firstName", "Jamie");
    form.set("lastName", "Rivera");
    await expect(createRealtor(form)).rejects.toThrow();
    expect(mockPrisma.realtor.create).not.toHaveBeenCalled();
  });

  it("does not seed brokerage history when no brokerage is given", async () => {
    mockPrisma.realtor.create.mockResolvedValue({ id: "r1", createdAt: new Date("2026-01-01") });
    const form = new FormData();
    form.set("firstName", "Jamie");
    form.set("lastName", "Rivera");
    await createRealtor(form);

    expect(mockPrisma.realtor.create).toHaveBeenCalled();
    expect(mockPrisma.realtorBrokerageHistory.create).not.toHaveBeenCalled();
  });

  it("seeds an initial brokerage-history row when created with a brokerage (item 5)", async () => {
    const createdAt = new Date("2026-01-01T00:00:00.000Z");
    mockPrisma.realtor.create.mockResolvedValue({ id: "r1", createdAt });
    const form = new FormData();
    form.set("firstName", "Jamie");
    form.set("lastName", "Rivera");
    form.set("brokerageId", "brok-1");
    await createRealtor(form);

    expect(mockPrisma.realtorBrokerageHistory.create).toHaveBeenCalledWith({
      data: { realtorId: "r1", brokerageId: "brok-1", startDate: createdAt },
    });
  });
});

describe("changeRealtorBrokerage", () => {
  it("rejects an unauthorized role", async () => {
    mockAuth.mockResolvedValue({ user: { role: "INSPECTOR" } } as never);
    const form = new FormData();
    form.set("brokerageId", "brok-2");
    await expect(changeRealtorBrokerage("r1", form)).rejects.toThrow();
    expect(mockPrisma.realtorBrokerageHistory.updateMany).not.toHaveBeenCalled();
  });

  it("requires a brokerage", async () => {
    await expect(changeRealtorBrokerage("r1", new FormData())).rejects.toThrow(/brokerage/i);
  });

  it("closes the open history row and opens a new one", async () => {
    const form = new FormData();
    form.set("brokerageId", "brok-2");
    await changeRealtorBrokerage("r1", form);

    expect(mockPrisma.realtorBrokerageHistory.updateMany).toHaveBeenCalledWith({
      where: { realtorId: "r1", endDate: null },
      data: { endDate: expect.any(Date) },
    });
    expect(mockPrisma.realtorBrokerageHistory.create).toHaveBeenCalledWith({
      data: { realtorId: "r1", brokerageId: "brok-2", startDate: expect.any(Date) },
    });
    expect(mockPrisma.realtor.update).toHaveBeenCalledWith({
      where: { id: "r1" },
      data: { brokerageId: "brok-2" },
    });
  });
});
