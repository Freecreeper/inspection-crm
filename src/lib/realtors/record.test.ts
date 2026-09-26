import { describe, it, expect, vi, beforeEach } from "vitest";
import { Prisma } from "@prisma/client";

vi.mock("@/lib/prisma", async () => {
  const { createMockPrisma } = await import("@/test-utils/mockPrisma");
  return { prisma: createMockPrisma() };
});

import { prisma } from "@/lib/prisma";
import { loadAssociatedTransactions, loadReferredTransactions, monthlyCounts } from "./record";

type Fn = ReturnType<typeof vi.fn>;
const db = prisma as unknown as Record<string, Record<string, Fn>>;

const baseTransaction = {
  id: "t1",
  status: "COMPLETED",
  createdAt: new Date("2026-05-01"),
  property: { addressLine1: "5 Willow Way", city: "Hickory" },
  customers: [{ primaryContact: true, customer: { firstName: "Nina", lastName: "Patel" } }],
  inspections: [{ status: "COMPLETED", completedAt: new Date("2026-05-06"), scheduledAt: new Date("2026-05-06") }],
};

beforeEach(() => {
  vi.clearAllMocks();
  db.invoice.findMany.mockResolvedValue([{ transactionId: "t1", items: [{ amount: new Prisma.Decimal("500.00") }] }]);
});

describe("loadAssociatedTransactions", () => {
  it("shows each associated transaction once, with every role they held on it", async () => {
    db.transaction.findMany.mockResolvedValue([
      {
        ...baseTransaction,
        realtors: [
          { role: "LISTING_AGENT", brokerageName: "EXP Realty" },
          { role: "TRANSACTION_COORDINATOR", brokerageName: "EXP Realty" },
        ],
      },
    ]);

    const rows = await loadAssociatedTransactions("r1", { take: 50, includeFinancials: true });

    expect(db.transaction.findMany.mock.calls[0][0].where).toEqual({ archivedAt: null, realtors: { some: { realtorId: "r1" } } });
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({ roles: ["Listing agent", "Transaction coordinator"], primaryCustomer: "Nina Patel", revenue: "500.00" });
  });

  it("keeps the brokerage the realtor was with at the time, not their current one", async () => {
    db.transaction.findMany.mockResolvedValue([{ ...baseTransaction, realtors: [{ role: "BUYER_AGENT", brokerageName: "EXP Realty" }] }]);
    const rows = await loadAssociatedTransactions("r1", { take: 50, includeFinancials: false });
    expect(rows[0].brokerageAtTheTime).toBe("EXP Realty");
  });

  it("omits revenue entirely without financial access", async () => {
    db.transaction.findMany.mockResolvedValue([{ ...baseTransaction, realtors: [{ role: "BUYER_AGENT", brokerageName: null }] }]);
    const rows = await loadAssociatedTransactions("r1", { take: 50, includeFinancials: false });
    expect(rows[0].revenue).toBeNull();
    expect(db.invoice.findMany).not.toHaveBeenCalled();
  });
});

describe("loadReferredTransactions", () => {
  it("only loads transactions whose referral source is linked to the realtor", async () => {
    db.transaction.findMany.mockResolvedValue([baseTransaction]);
    await loadReferredTransactions("r1", { take: 50, includeFinancials: true });
    const where = db.transaction.findMany.mock.calls[0][0].where;
    expect(where).toEqual({ archivedAt: null, referralSource: { realtorId: "r1" } });
    expect(where).not.toHaveProperty("realtors");
  });
});

describe("monthlyCounts", () => {
  it("buckets dates into the last N calendar months, oldest first", () => {
    const now = new Date(2026, 8, 26);
    const counts = monthlyCounts([new Date(2026, 8, 1), new Date(2026, 8, 20), new Date(2026, 6, 4), new Date(2025, 0, 1)], now, 3);
    expect(counts.map((c) => [c.month, c.count])).toEqual([
      ["2026-07", 1],
      ["2026-08", 0],
      ["2026-09", 2],
    ]);
  });
});
