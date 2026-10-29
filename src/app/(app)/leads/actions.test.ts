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
import { createLead, convertLead, setLeadStatus } from "./actions";

const mockAuth = vi.mocked(auth);
const mockPrisma = prisma as unknown as {
  lead: { create: ReturnType<typeof vi.fn>; findUniqueOrThrow: ReturnType<typeof vi.fn>; update: ReturnType<typeof vi.fn>; updateMany: ReturnType<typeof vi.fn> };
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
    mockPrisma.lead.updateMany.mockResolvedValue({ count: 1 });
    mockPrisma.customer.create.mockResolvedValue({ id: "cust-1" });
    mockPrisma.transaction.create.mockResolvedValue({ id: "txn-1" });

    await expect(convertLead("lead-1")).rejects.toThrow("NEXT_REDIRECT:/transactions/txn-1");

    expect(mockPrisma.transaction.create).toHaveBeenCalledWith({
      data: { referralSourceId: "ref-1", status: "LEAD_IN_PROGRESS" },
    });
    expect(mockPrisma.transactionCustomer.create).toHaveBeenCalledWith({
      data: { transactionId: "txn-1", customerId: "cust-1", role: "PRIMARY_BUYER", primaryContact: true },
    });
    // Marked CONVERTED by the atomic claim, then linked to the new customer.
    expect(mockPrisma.lead.updateMany).toHaveBeenCalledWith({
      where: { id: "lead-1", status: { not: "CONVERTED" } },
      data: expect.objectContaining({ status: "CONVERTED" }),
    });
    expect(mockPrisma.lead.update).toHaveBeenCalledWith({ where: { id: "lead-1" }, data: { convertedCustomerId: "cust-1" } });
  });
});

describe("setLeadStatus", () => {
  const db = prisma as unknown as Record<string, Record<string, ReturnType<typeof vi.fn>>>;
  const form = (status: string) => {
    const f = new FormData();
    f.set("status", status);
    return f;
  };

  it("rejects an unauthorized role", async () => {
    mockAuth.mockResolvedValue({ user: { role: "INSPECTOR" } } as never);
    await expect(setLeadStatus("l1", form("CONTACTED"))).rejects.toThrow();
    expect(db.lead.update).not.toHaveBeenCalled();
  });

  it("refuses Converted and unknown statuses", async () => {
    await expect(setLeadStatus("l1", form("CONVERTED"))).rejects.toThrow();
    await expect(setLeadStatus("l1", form("WON"))).rejects.toThrow();
    expect(db.lead.update).not.toHaveBeenCalled();
  });

  it("moves the lead and records who did it", async () => {
    mockAuth.mockResolvedValue({ user: { id: "u1", role: "OFFICE_STAFF" } } as never);
    db.lead.findUnique.mockResolvedValue({ status: "NEW" });
    await setLeadStatus("l1", form("CONTACTED"));
    expect(db.lead.update).toHaveBeenCalledWith({ where: { id: "l1" }, data: { status: "CONTACTED" } });
    expect(db.activityLog.create).toHaveBeenCalledWith({
      data: expect.objectContaining({ actorId: "u1", action: "lead.status_changed", entityId: "l1", before: { status: "NEW" }, after: { status: "CONTACTED" } }),
    });
  });

  it("never moves a converted lead", async () => {
    db.lead.findUnique.mockResolvedValue({ status: "CONVERTED" });
    await setLeadStatus("l1", form("LOST"));
    expect(db.lead.update).not.toHaveBeenCalled();
  });
});
