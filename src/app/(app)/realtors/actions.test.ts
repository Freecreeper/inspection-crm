import { describe, it, expect, vi, beforeEach } from "vitest";

vi.mock("@/lib/prisma", async () => {
  const { createMockPrisma } = await import("@/test-utils/mockPrisma");
  return { prisma: createMockPrisma() };
});
vi.mock("@/lib/auth", () => ({ auth: vi.fn() }));
vi.mock("next/cache", () => ({ revalidatePath: vi.fn() }));
vi.mock("next/navigation", () => ({ redirect: vi.fn() }));

import { prisma } from "@/lib/prisma";
import { auth } from "@/lib/auth";
import {
  createRealtor,
  changeRealtorBrokerage,
  changeRealtorBrokerageInline,
  updateRealtorNameInline,
  updateRealtorEmailInline,
  updateRealtorPhoneInline,
} from "./actions";

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

  it("rejects a phone number that isn't exactly 10 digits", async () => {
    const form = new FormData();
    form.set("firstName", "Jamie");
    form.set("lastName", "Rivera");
    form.set("phone", "555-0101");
    await expect(createRealtor(form)).rejects.toThrow(/10 digits/i);
    expect(mockPrisma.realtor.create).not.toHaveBeenCalled();
  });

  it("normalizes a formatted 10-digit phone number to digits-only before storing", async () => {
    mockPrisma.realtor.create.mockResolvedValue({ id: "r1", createdAt: new Date() });
    const form = new FormData();
    form.set("firstName", "Jamie");
    form.set("lastName", "Rivera");
    form.set("phone", "(828) 555-0101");
    await createRealtor(form);

    expect(mockPrisma.realtor.create).toHaveBeenCalledWith(
      expect.objectContaining({ data: expect.objectContaining({ phone: "8285550101" }) })
    );
  });
});

describe("updateRealtorNameInline", () => {
  it("rejects an unauthorized role", async () => {
    mockAuth.mockResolvedValue({ user: { role: "INSPECTOR" } } as never);
    await expect(updateRealtorNameInline("r1", { firstName: "Jamie", lastName: "Rivera" })).rejects.toThrow();
    expect(mockPrisma.realtor.update).not.toHaveBeenCalled();
  });

  it("rejects a blank first or last name", async () => {
    await expect(updateRealtorNameInline("r1", { firstName: "", lastName: "Rivera" })).rejects.toThrow(/required/i);
    await expect(updateRealtorNameInline("r1", { firstName: "Jamie", lastName: "  " })).rejects.toThrow(/required/i);
    expect(mockPrisma.realtor.update).not.toHaveBeenCalled();
  });

  it("updates both names", async () => {
    await updateRealtorNameInline("r1", { firstName: "Jamie", lastName: "Rivera" });
    expect(mockPrisma.realtor.update).toHaveBeenCalledWith({
      where: { id: "r1" },
      data: { firstName: "Jamie", lastName: "Rivera" },
    });
  });
});

describe("updateRealtorEmailInline", () => {
  it("rejects an unauthorized role", async () => {
    mockAuth.mockResolvedValue({ user: { role: "INSPECTOR" } } as never);
    await expect(updateRealtorEmailInline("r1", "jamie@example.com")).rejects.toThrow();
    expect(mockPrisma.realtor.update).not.toHaveBeenCalled();
  });

  it("stores an empty value as null", async () => {
    await updateRealtorEmailInline("r1", "  ");
    expect(mockPrisma.realtor.update).toHaveBeenCalledWith({ where: { id: "r1" }, data: { email: null } });
  });

  it("trims and stores the email", async () => {
    await updateRealtorEmailInline("r1", "  jamie@example.com  ");
    expect(mockPrisma.realtor.update).toHaveBeenCalledWith({
      where: { id: "r1" },
      data: { email: "jamie@example.com" },
    });
  });
});

describe("updateRealtorPhoneInline", () => {
  it("rejects a phone number that isn't exactly 10 digits", async () => {
    await expect(updateRealtorPhoneInline("r1", "555-0101")).rejects.toThrow(/10 digits/i);
    expect(mockPrisma.realtor.update).not.toHaveBeenCalled();
  });

  it("normalizes a formatted phone number to digits-only", async () => {
    await updateRealtorPhoneInline("r1", "(828) 555-0101");
    expect(mockPrisma.realtor.update).toHaveBeenCalledWith({
      where: { id: "r1" },
      data: { phone: "8285550101" },
    });
  });

  it("clears the phone when given an empty value", async () => {
    await updateRealtorPhoneInline("r1", "");
    expect(mockPrisma.realtor.update).toHaveBeenCalledWith({ where: { id: "r1" }, data: { phone: null } });
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

describe("changeRealtorBrokerageInline", () => {
  it("rejects an unauthorized role", async () => {
    mockAuth.mockResolvedValue({ user: { role: "INSPECTOR" } } as never);
    await expect(changeRealtorBrokerageInline("r1", "brok-2")).rejects.toThrow();
    expect(mockPrisma.realtorBrokerageHistory.updateMany).not.toHaveBeenCalled();
  });

  it("requires a brokerage", async () => {
    await expect(changeRealtorBrokerageInline("r1", "")).rejects.toThrow(/brokerage/i);
  });

  it("closes the open history row and opens a new one, same as the form version", async () => {
    await changeRealtorBrokerageInline("r1", "brok-2");

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
