import { describe, it, expect, vi, beforeEach } from "vitest";
import { Prisma } from "@prisma/client";

vi.mock("@/lib/prisma", async () => {
  const { createMockPrisma } = await import("@/test-utils/mockPrisma");
  return { prisma: createMockPrisma() };
});

import { prisma } from "@/lib/prisma";
import { filterBrokerageTimeline, getBrokerageMetrics, loadBrokerageRealtors, loadBrokerageTimeline, parseBrokerageTimelineFilter } from "./record";

type Fn = ReturnType<typeof vi.fn>;
const db = prisma as unknown as Record<string, Record<string, Fn>>;
const sarah = { id: "r1", firstName: "Sarah", lastName: "Jones", preferredName: "Sally" };

beforeEach(() => vi.clearAllMocks());

describe("getBrokerageMetrics", () => {
  it("counts deals by the brokerage snapshot, and only computes revenue for financial viewers", async () => {
    db.realtor.count.mockResolvedValueOnce(3).mockResolvedValueOnce(1);
    db.transaction.count.mockResolvedValue(4);
    db.invoiceItem.aggregate.mockResolvedValue({ _sum: { amount: new Prisma.Decimal("1050") } });

    expect(await getBrokerageMetrics("b1", { includeFinancials: true })).toEqual({ currentRealtors: 3, formerRealtors: 1, transactions: 4, associatedRevenue: "1050.00" });
    expect(db.transaction.count).toHaveBeenCalledWith({ where: { archivedAt: null, realtors: { some: { brokerageId: "b1" } } } });

    db.realtor.count.mockResolvedValue(0);
    expect((await getBrokerageMetrics("b1", { includeFinancials: false })).associatedRevenue).toBeNull();
    expect(db.invoiceItem.aggregate).toHaveBeenCalledTimes(1);
  });
});

describe("loadBrokerageRealtors", () => {
  it("adds per-realtor deal counts and start dates, and a returning realtor isn't listed as former", async () => {
    db.realtor.findMany.mockResolvedValue([{ ...sarah, phone: null, email: null }]);
    db.transactionRealtor.groupBy.mockResolvedValue([{ realtorId: "r1", _count: { transactionId: 3 } }]);
    db.realtorBrokerageHistory.findMany
      .mockResolvedValueOnce([{ realtorId: "r1", startDate: new Date("2025-08-22") }])
      .mockResolvedValueOnce([
        { id: "h1", startDate: new Date("2020-01-01"), endDate: new Date("2022-01-01"), realtor: { ...sarah, brokerageId: "b1", brokerage: null } },
        { id: "h2", startDate: new Date("2019-01-01"), endDate: new Date("2024-01-01"), realtor: { id: "r2", firstName: "Tom", lastName: "Reed", preferredName: null, brokerageId: "b9", brokerage: { id: "b9", name: "RE/MAX" } } },
      ]);

    const { current, former } = await loadBrokerageRealtors("b1");
    expect(current).toEqual([{ id: "r1", name: "Sally Jones", phone: null, email: null, transactions: 3, since: new Date("2025-08-22") }]);
    expect(former).toEqual([expect.objectContaining({ id: "r2", name: "Tom Reed", nowAt: { id: "b9", name: "RE/MAX" } })]);
  });
});

describe("loadBrokerageTimeline", () => {
  beforeEach(() => {
    db.realtorBrokerageHistory.findMany.mockResolvedValue([
      { id: "h1", startDate: new Date("2026-01-01"), endDate: new Date("2026-06-01"), realtor: sarah },
    ]);
    db.transactionRealtor.findMany.mockResolvedValue([
      { id: "tr1", createdAt: new Date("2026-03-01"), role: "BUYER_AGENT", realtor: sarah, transaction: { id: "t1", property: { addressLine1: "12 Main St", city: "Hickory" } } },
    ]);
    db.activityLog.findMany.mockResolvedValue([
      { id: "l1", createdAt: new Date("2026-07-01"), action: "brokerage.updated", after: { phone: "8285550100" }, actor: { name: "Admin" } },
      { id: "l2", createdAt: new Date("2026-08-01"), action: "brokerage.updated", after: { email: null }, actor: null },
    ]);
  });

  it("merges joins, departures, deals, and edits newest first, saying what changed", async () => {
    const items = await loadBrokerageTimeline("b1", { limit: 10 });
    expect(items.map((i) => [i.kind, i.title, i.detail])).toEqual([
      ["changes", "Email cleared", null],
      ["changes", "Phone: (828)555-0100", "by Admin"],
      ["realtors", "Sally Jones left", null],
      ["transactions", "12 Main St, Hickory", "Sally Jones · Buyer agent"],
      ["realtors", "Sally Jones joined", null],
    ]);
    expect(items.find((i) => i.kind === "transactions")?.href).toBe("/transactions/t1");
  });

  it("filters by kind and ignores unknown filters", async () => {
    const items = await loadBrokerageTimeline("b1", { limit: 10 });
    expect(filterBrokerageTimeline(items, parseBrokerageTimelineFilter("realtors")).map((i) => i.title)).toEqual(["Sally Jones left", "Sally Jones joined"]);
    expect(parseBrokerageTimelineFilter("drop table")).toBe("all");
    expect(await loadBrokerageTimeline("b1", { limit: 2 })).toHaveLength(2);
  });
});
