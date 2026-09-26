import { describe, it, expect, vi, beforeEach } from "vitest";
import { Prisma } from "@prisma/client";

vi.mock("@/lib/prisma", async () => {
  const { createMockPrisma } = await import("@/test-utils/mockPrisma");
  return { prisma: createMockPrisma() };
});

import { prisma } from "@/lib/prisma";
import {
  BILLED_INVOICE_STATUSES,
  associatedTransactionWhere,
  getRealtorMetrics,
  referredTransactionWhere,
  sumInvoicesByTransaction,
} from "./metrics";

type Fn = ReturnType<typeof vi.fn>;
const db = prisma as unknown as Record<string, Record<string, Fn>>;

beforeEach(() => {
  vi.clearAllMocks();
  db.transaction.count.mockImplementation(async ({ where }) => (where.referralSource ? 2 : 5));
  db.transactionCustomer.groupBy.mockResolvedValue([{ customerId: "c1" }, { customerId: "c2" }]);
  db.invoiceItem.aggregate.mockImplementation(async ({ where }) => ({
    _sum: { amount: new Prisma.Decimal(where.invoice.transaction.referralSource ? "975.00" : "1050.50") },
  }));
});

describe("attribution rules", () => {
  it("associated means the realtor had a role on the deal", () => {
    expect(associatedTransactionWhere("r1")).toEqual({ archivedAt: null, realtors: { some: { realtorId: "r1" } } });
  });

  it("referred means the deal's recorded referral source is linked to the realtor — nothing else", () => {
    const where = referredTransactionWhere("r1");
    expect(where).toEqual({ archivedAt: null, referralSource: { realtorId: "r1" } });
    expect(where).not.toHaveProperty("realtors");
  });
});

describe("getRealtorMetrics", () => {
  it("counts associated transactions by transaction (not join rows) and referrals separately", async () => {
    const m = await getRealtorMetrics("r1", { includeFinancials: true });

    expect(db.transaction.count).toHaveBeenCalledWith({ where: associatedTransactionWhere("r1") });
    expect(db.transaction.count).toHaveBeenCalledWith({ where: referredTransactionWhere("r1") });
    expect(m.associatedTransactions).toBe(5);
    expect(m.referrals).toBe(2);
    // Being on five deals does not make any of them referrals.
    expect(m.referrals).not.toBe(m.associatedTransactions);
  });

  it("counts distinct referred customers", async () => {
    const m = await getRealtorMetrics("r1", { includeFinancials: false });
    expect(db.transactionCustomer.groupBy).toHaveBeenCalledWith({ by: ["customerId"], where: { transaction: referredTransactionWhere("r1") } });
    expect(m.customersReferred).toBe(2);
  });

  it("calculates referral and associated revenue as two separate billed-revenue aggregates", async () => {
    const m = await getRealtorMetrics("r1", { includeFinancials: true });

    expect(db.invoiceItem.aggregate).toHaveBeenCalledTimes(2);
    expect(db.invoiceItem.aggregate).toHaveBeenCalledWith({
      _sum: { amount: true },
      where: { invoice: { status: { in: BILLED_INVOICE_STATUSES }, transaction: associatedTransactionWhere("r1") } },
    });
    expect(db.invoiceItem.aggregate).toHaveBeenCalledWith({
      _sum: { amount: true },
      where: { invoice: { status: { in: BILLED_INVOICE_STATUSES }, transaction: referredTransactionWhere("r1") } },
    });
    expect(m.associatedRevenue).toBe("1050.50");
    expect(m.referralRevenue).toBe("975.00");
  });

  it("never counts draft or voided invoices as revenue", () => {
    expect(BILLED_INVOICE_STATUSES).not.toContain("DRAFT");
    expect(BILLED_INVOICE_STATUSES).not.toContain("VOID");
  });

  it("doesn't even query revenue for a viewer without financial access", async () => {
    const m = await getRealtorMetrics("r1", { includeFinancials: false });
    expect(db.invoiceItem.aggregate).not.toHaveBeenCalled();
    expect(m.associatedRevenue).toBeNull();
    expect(m.referralRevenue).toBeNull();
  });

  it("reports zero revenue (not null) when there are no billed invoices", async () => {
    db.invoiceItem.aggregate.mockResolvedValue({ _sum: { amount: null } });
    const m = await getRealtorMetrics("r1", { includeFinancials: true });
    expect(m.associatedRevenue).toBe("0.00");
  });
});

describe("sumInvoicesByTransaction", () => {
  it("sums with exact decimal arithmetic per transaction", () => {
    const totals = sumInvoicesByTransaction([
      { transactionId: "t1", items: [{ amount: new Prisma.Decimal("0.10") }, { amount: new Prisma.Decimal("0.20") }] },
      { transactionId: "t1", items: [{ amount: new Prisma.Decimal("100.00") }] },
      { transactionId: "t2", items: [] },
    ]);
    expect(totals.get("t1")).toBe("100.30");
    expect(totals.get("t2")).toBe("0.00");
  });
});
