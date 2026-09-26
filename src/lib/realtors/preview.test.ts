import { describe, it, expect, vi, beforeEach } from "vitest";
import { Prisma } from "@prisma/client";

vi.mock("@/lib/prisma", async () => {
  const { createMockPrisma } = await import("@/test-utils/mockPrisma");
  return { prisma: createMockPrisma() };
});

import { prisma } from "@/lib/prisma";
import { loadRealtorPreview } from "./preview";
import { DEFAULT_PREVIEW_SECTIONS, normalizePreviewSections } from "./previewLayout";

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
  archivedAt: null,
  brokerage: { id: "b1", name: "Keller Williams", city: "Hickory" },
};

beforeEach(() => {
  vi.clearAllMocks();
  db.realtor.findFirst.mockResolvedValue(realtor);
  db.user.findUnique.mockResolvedValue({ realtorPreviewSections: null });
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
    const preview = await loadRealtorPreview("r1", "OFFICE_STAFF", "u1");
    expect(db.realtor.findFirst).toHaveBeenCalledWith(expect.objectContaining({ where: { id: "r1", archivedAt: null } }));
    expect(preview).toMatchObject({ id: "r1", displayName: "Sally Jones", legalName: "Sarah Jones", nextAction: { id: "t1" } });
  });

  it("returns null for a missing or archived realtor", async () => {
    db.realtor.findFirst.mockResolvedValue(null);
    expect(await loadRealtorPreview("nope", "OFFICE_STAFF", "u1")).toBeNull();
  });

  it("shows revenue to every staff role, including inspectors", async () => {
    for (const role of ["OWNER_ADMIN", "OFFICE_STAFF", "INSPECTOR", "REPORTING_ANALYST"] as const) {
      const preview = await loadRealtorPreview("r1", role, "u1");
      expect(preview!.permissions.canViewFinancials).toBe(true);
      expect(preview!.metrics!.associatedRevenue).toBe("100.00");
    }
  });

  it("never queries revenue without a role (no financial access)", async () => {
    const preview = await loadRealtorPreview("r1", undefined, null);
    expect(preview!.permissions).toEqual({ canWrite: false, canViewFinancials: false });
    expect(preview!.metrics!.associatedRevenue).toBeNull();
    expect(db.invoiceItem.aggregate).not.toHaveBeenCalled();
  });

  it("hides write actions from read-only roles", async () => {
    const preview = await loadRealtorPreview("r1", "INSPECTOR", "u1");
    expect(preview!.permissions.canWrite).toBe(false);
  });

  it("a missing email leaves the rest of the preview intact", async () => {
    const preview = await loadRealtorPreview("r1", "OFFICE_STAFF", "u1");
    expect(preview!.email).toBeNull();
    expect(preview!.phone).toBe("8285550101");
    expect(preview!.brokerage).toEqual(realtor.brokerage);
  });

  it("uses the default sections when the user hasn't customized the card", async () => {
    const preview = await loadRealtorPreview("r1", "OFFICE_STAFF", "u1");
    expect(preview!.sections).toEqual(DEFAULT_PREVIEW_SECTIONS);
  });

  it("only loads data for the sections the user has switched on", async () => {
    db.user.findUnique.mockResolvedValue({ realtorPreviewSections: ["contact"] });
    const preview = await loadRealtorPreview("r1", "OFFICE_STAFF", "u1");

    expect(preview!.sections).toEqual(["contact"]);
    expect(preview!.metrics).toBeNull();
    expect(preview!.nextAction).toBeNull();
    expect(db.transaction.count).not.toHaveBeenCalled();
    expect(db.task.findFirst).not.toHaveBeenCalled();
    expect(db.communication.findMany).not.toHaveBeenCalled();
  });

  it("skips the revenue query when revenue is hidden but counts are shown", async () => {
    db.user.findUnique.mockResolvedValue({ realtorPreviewSections: ["transactions", "referrals"] });
    const preview = await loadRealtorPreview("r1", "OFFICE_STAFF", "u1");
    expect(preview!.metrics).not.toBeNull();
    expect(db.invoiceItem.aggregate).not.toHaveBeenCalled();
  });
});

describe("normalizePreviewSections", () => {
  it("keeps only known sections, in display order", () => {
    expect(normalizePreviewSections(["activity", "bogus", "nextAction", 7, "activity"])).toEqual(["nextAction", "activity"]);
  });

  it("falls back to defaults for anything that isn't a list", () => {
    expect(normalizePreviewSections(null)).toEqual(DEFAULT_PREVIEW_SECTIONS);
    expect(normalizePreviewSections({ contact: true })).toEqual(DEFAULT_PREVIEW_SECTIONS);
  });

  it("allows an intentionally empty card", () => {
    expect(normalizePreviewSections([])).toEqual([]);
  });
});
