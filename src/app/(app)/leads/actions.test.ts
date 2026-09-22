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

import { prisma } from "@/lib/prisma";
import { auth } from "@/lib/auth";
import { createLead, convertLead } from "./actions";

const mockAuth = vi.mocked(auth);
const mockPrisma = prisma as unknown as {
  lead: { create: ReturnType<typeof vi.fn>; findUniqueOrThrow: ReturnType<typeof vi.fn>; update: ReturnType<typeof vi.fn> };
  customer: { create: ReturnType<typeof vi.fn> };
  transaction: { create: ReturnType<typeof vi.fn> };
  transactionCustomer: { create: ReturnType<typeof vi.fn> };
};

beforeEach(() => {
  vi.clearAllMocks();
  mockAuth.mockResolvedValue({ user: { role: "OFFICE_STAFF" } } as never);
});

describe("createLead", () => {
  it("rejects an unauthorized role", async () => {
    mockAuth.mockResolvedValue({ user: { role: "INSPECTOR" } } as never);
    const form = new FormData();
    form.set("firstName", "Pat");
    form.set("lastName", "Doe");
    await expect(createLead(form)).rejects.toThrow();
    expect(mockPrisma.lead.create).not.toHaveBeenCalled();
  });
});

describe("convertLead", () => {
  it("rejects an unauthorized role", async () => {
    mockAuth.mockResolvedValue({ user: { role: "REPORTING_ANALYST" } } as never);
    await expect(convertLead("lead-1")).rejects.toThrow();
    expect(mockPrisma.lead.findUniqueOrThrow).not.toHaveBeenCalled();
  });

  it("creates a Customer, a Transaction, and marks the customer primary (item 1)", async () => {
    mockPrisma.lead.findUniqueOrThrow.mockResolvedValue({
      id: "lead-1",
      firstName: "Pat",
      lastName: "Doe",
      email: "pat@example.com",
      phone: null,
      referralSourceId: "ref-1",
    });
    mockPrisma.customer.create.mockResolvedValue({ id: "cust-1" });
    mockPrisma.transaction.create.mockResolvedValue({ id: "txn-1" });

    await expect(convertLead("lead-1")).rejects.toThrow("NEXT_REDIRECT:/transactions/txn-1");

    expect(mockPrisma.transaction.create).toHaveBeenCalledWith({
      data: { referralSourceId: "ref-1", status: "LEAD_IN_PROGRESS" },
    });
    expect(mockPrisma.transactionCustomer.create).toHaveBeenCalledWith({
      data: { transactionId: "txn-1", customerId: "cust-1", role: "PRIMARY_BUYER", primaryContact: true },
    });
    expect(mockPrisma.lead.update).toHaveBeenCalledWith({
      where: { id: "lead-1" },
      data: expect.objectContaining({ status: "CONVERTED", convertedCustomerId: "cust-1" }),
    });
  });
});
