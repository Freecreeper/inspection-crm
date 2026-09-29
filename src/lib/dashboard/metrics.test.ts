import { describe, it, expect, vi, beforeEach } from "vitest";
import { Prisma } from "@prisma/client";

vi.mock("@/lib/prisma", async () => {
  const { createMockPrisma } = await import("@/test-utils/mockPrisma");
  return { prisma: createMockPrisma() };
});

import { prisma } from "@/lib/prisma";
import { billedInvoiceWhere, loadKpis, monthPeriod, weekPeriod } from "./metrics";
import { createDashboardContext } from "./sources";

type Fn = ReturnType<typeof vi.fn>;
const db = prisma as unknown as Record<string, Record<string, Fn>>;
const NOW = new Date("2026-09-29T15:00:00Z"); // Tue Sep 29, 11 AM New York
const ctx = () => createDashboardContext({ userId: "u-admin", role: "OWNER_ADMIN" }, NOW);

// September in New York: Sep 1 00:00 EDT → Oct 1 00:00 EDT.
const SEPTEMBER = { gte: new Date("2026-09-01T04:00:00Z"), lt: new Date("2026-10-01T04:00:00Z") };

beforeEach(() => {
  vi.clearAllMocks();
  vi.stubEnv("APP_TIMEZONE", "America/New_York");
  vi.stubEnv("CALENDAR_WEEK_STARTS_ON", "0");
});

describe("periods are business-time-zone calendar periods", () => {
  it("month and week boundaries fall at local midnight", () => {
    expect(monthPeriod("2026-09-29", "America/New_York")).toEqual({ start: SEPTEMBER.gte, end: SEPTEMBER.lt });
    // Week of Sun Sep 27 – Sat Oct 3.
    expect(weekPeriod("2026-09-29", "America/New_York", 0)).toEqual({ start: new Date("2026-09-27T04:00:00Z"), end: new Date("2026-10-04T04:00:00Z") });
  });
});

describe("KPIs", () => {
  it("Inspections this month counts scheduled, in-progress, and completed — never cancelled", async () => {
    db.inspection.count.mockResolvedValue(31);
    expect(await loadKpis(ctx(), ["inspectionsMonth"])).toEqual([{ key: "inspectionsMonth", value: 31 }]);
    expect(db.inspection.count).toHaveBeenCalledWith({ where: { status: { in: ["SCHEDULED", "IN_PROGRESS", "COMPLETED"] }, scheduledAt: SEPTEMBER } });
  });

  it("Revenue is billed revenue: line items on sent/partly paid/paid/overdue invoices dated this month", async () => {
    db.invoiceItem.aggregate.mockResolvedValue({ _sum: { amount: new Prisma.Decimal("16480.00") } });
    db.invoice.count.mockResolvedValue(31);
    expect(await loadKpis(ctx(), ["revenueMonth"])).toEqual([{ key: "revenueMonth", value: 16480 }]);
    const where = billedInvoiceWhere({ start: SEPTEMBER.gte, end: SEPTEMBER.lt });
    expect(where).toEqual({ status: { in: ["SENT", "PAID", "PARTIALLY_PAID", "OVERDUE"] }, OR: [{ issuedAt: SEPTEMBER }, { issuedAt: null, createdAt: SEPTEMBER }] });
    expect(db.invoiceItem.aggregate).toHaveBeenCalledWith({ _sum: { amount: true }, where: { invoice: where } });
    // Drafts and voids are never revenue.
    expect(where.status).toEqual({ in: expect.not.arrayContaining(["DRAFT", "VOID"]) });
  });

  it("Average inspection value = the same revenue ÷ the same invoices (and '—' when nothing is billed)", async () => {
    db.invoiceItem.aggregate.mockResolvedValue({ _sum: { amount: new Prisma.Decimal("16480.00") } });
    db.invoice.count.mockResolvedValue(31);
    const values = await loadKpis(ctx(), ["revenueMonth", "avgInspectionValue"]);
    expect(values).toEqual([
      { key: "revenueMonth", value: 16480 },
      { key: "avgInspectionValue", value: 531.61 },
    ]);
    // Revenue and average share one pair of queries.
    expect(db.invoiceItem.aggregate).toHaveBeenCalledTimes(1);
    expect(db.invoice.count).toHaveBeenCalledWith({ where: billedInvoiceWhere({ start: SEPTEMBER.gte, end: SEPTEMBER.lt }) });

    vi.clearAllMocks();
    db.invoiceItem.aggregate.mockResolvedValue({ _sum: { amount: null } });
    db.invoice.count.mockResolvedValue(0);
    expect(await loadKpis(ctx(), ["avgInspectionValue"])).toEqual([{ key: "avgInspectionValue", value: null }]);
  });

  it("Referrals count only transactions with a Referral Source — an associated Realtor alone is not a referral", async () => {
    db.transaction.count.mockResolvedValue(14);
    await loadKpis(ctx(), ["referralsMonth", "realtorReferralsMonth"]);
    expect(db.transaction.count).toHaveBeenNthCalledWith(1, { where: { referralSourceId: { not: null }, createdAt: SEPTEMBER } });
    expect(db.transaction.count).toHaveBeenNthCalledWith(2, { where: { referralSource: { realtorId: { not: null } }, createdAt: SEPTEMBER } });
    // Nothing about TransactionRealtor (being the agent on a deal).
    expect(JSON.stringify(db.transaction.count.mock.calls)).not.toContain("realtors");
  });

  it("Outstanding balance and unpaid count come from collectible invoices with a balance", async () => {
    const inv = (id: string, status: string, total: string, paid: string[]) => ({
      id,
      invoiceNumber: id,
      status,
      dueAt: null,
      transactionId: "tx",
      items: [{ amount: new Prisma.Decimal(total) }],
      payments: paid.map((p) => ({ amount: new Prisma.Decimal(p) })),
      transaction: { customers: [] },
    });
    db.invoice.findMany.mockResolvedValue([inv("a", "SENT", "475", []), inv("b", "PARTIALLY_PAID", "600", ["200"]), inv("c", "SENT", "300", ["300"])]);
    expect(await loadKpis(ctx(), ["outstandingBalance", "unpaidInvoices"])).toEqual([
      { key: "outstandingBalance", value: 875 },
      { key: "unpaidInvoices", value: 2 },
    ]);
    expect(db.invoice.findMany).toHaveBeenCalledTimes(1);
  });

  it("operational KPIs use their documented windows", async () => {
    db.inspection.count.mockResolvedValue(2);
    db.task.count.mockResolvedValue(5);
    db.lead.count.mockResolvedValue(7);
    await loadKpis(ctx(), ["unsignedAgreements", "overdueTasks", "newLeadsMonth", "reportsAwaiting"]);
    expect(db.inspection.count).toHaveBeenCalledWith({ where: { status: "SCHEDULED", agreementSignedAt: null, scheduledAt: { gte: new Date("2026-09-29T04:00:00Z"), lt: new Date("2026-10-14T04:00:00Z") } } });
    expect(db.task.count).toHaveBeenCalledWith({ where: { completedAt: null, dueAt: { lt: new Date("2026-09-29T04:00:00Z") } } });
    expect(db.lead.count).toHaveBeenCalledWith({ where: { createdAt: SEPTEMBER } });
    expect(db.inspection.count).toHaveBeenCalledWith({ where: { status: "COMPLETED", reports: { none: { status: { in: ["FINALIZED", "DELIVERED", "ARCHIVED"] } } } } });
  });
});
