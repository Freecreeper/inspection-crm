import { describe, it, expect, vi, beforeEach } from "vitest";
import { Prisma } from "@prisma/client";

vi.mock("@/lib/prisma", async () => {
  const { createMockPrisma } = await import("@/test-utils/mockPrisma");
  return { prisma: createMockPrisma() };
});

import { prisma } from "@/lib/prisma";
import { loadRealtorPreview } from "./preview";

type Fn = ReturnType<typeof vi.fn>;
const db = prisma as unknown as Record<string, Record<string, Fn>>;

const realtor = {
  id: "r1",
  firstName: "Sarah",
  lastName: "Jones",
  preferredName: "Sally",
  email: null,
  phone: "8285550101",
  preferredContactMethod: "PHONE",
  notes: null,
  active: true,
  archivedAt: null,
  brokerage: { id: "b1", name: "Keller Williams", city: "Hickory" },
};

beforeEach(() => {
  vi.clearAllMocks();
  db.realtor.findFirst.mockResolvedValue(realtor);
  db.transaction.count.mockResolvedValue(0);
  db.transactionCustomer.groupBy.mockResolvedValue([]);
  db.invoiceItem.aggregate.mockResolvedValue({ _sum: { amount: new Prisma.Decimal("100") } });
  db.task.findFirst.mockResolvedValue({ id: "t1", title: "Follow up", dueAt: new Date("2026-10-03T12:00:00") });
  for (const model of ["communication", "task", "transactionRealtor", "inspection", "transaction", "realtorBrokerageHistory", "activityLog"]) {
    db[model].findMany.mockResolvedValue([]);
  }
});

describe("loadRealtorPreview", () => {
  it("loads the requested, non-archived realtor", async () => {
    const preview = await loadRealtorPreview("r1", "OFFICE_STAFF");
    expect(db.realtor.findFirst).toHaveBeenCalledWith(expect.objectContaining({ where: { id: "r1", archivedAt: null } }));
    expect(preview).toMatchObject({ id: "r1", displayName: "Sally Jones", legalName: "Sarah Jones", nextAction: { id: "t1" } });
  });

  it("returns null for a missing or archived realtor", async () => {
    db.realtor.findFirst.mockResolvedValue(null);
    expect(await loadRealtorPreview("nope", "OFFICE_STAFF")).toBeNull();
  });

  it("includes revenue and write actions for office staff", async () => {
    const preview = await loadRealtorPreview("r1", "OFFICE_STAFF");
    expect(preview!.permissions).toEqual({ canWrite: true, canViewFinancials: true });
    expect(preview!.metrics.associatedRevenue).toBe("100.00");
  });

  it("gives an inspector no revenue and no write actions — revenue is never even queried", async () => {
    const preview = await loadRealtorPreview("r1", "INSPECTOR");
    expect(preview!.permissions).toEqual({ canWrite: false, canViewFinancials: false });
    expect(preview!.metrics.associatedRevenue).toBeNull();
    expect(preview!.metrics.referralRevenue).toBeNull();
    expect(db.invoiceItem.aggregate).not.toHaveBeenCalled();
  });

  it("a missing email leaves the rest of the preview intact", async () => {
    const preview = await loadRealtorPreview("r1", "OFFICE_STAFF");
    expect(preview!.email).toBeNull();
    expect(preview!.phone).toBe("8285550101");
    expect(preview!.brokerage).toEqual(realtor.brokerage);
  });
});
