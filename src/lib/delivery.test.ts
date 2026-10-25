import { describe, it, expect, vi, beforeEach } from "vitest";

vi.mock("@/lib/prisma", async () => {
  const { createMockPrisma } = await import("@/test-utils/mockPrisma");
  return { prisma: createMockPrisma() };
});

import { prisma } from "@/lib/prisma";
import { resolveDeliveryByToken, markDeliveryViewed } from "./delivery";
import { evaluateGuard } from "./email/guards";

const mockPrisma = prisma as unknown as {
  reportDelivery: { findUnique: ReturnType<typeof vi.fn>; updateMany: ReturnType<typeof vi.fn> };
};

describe("resolveDeliveryByToken — finalized-version snapshot integrity", () => {
  beforeEach(() => vi.clearAllMocks());

  it("only ever fetches the immutable `version` relation, never the live report/inspection/property chain", async () => {
    mockPrisma.reportDelivery.findUnique.mockResolvedValue({
      id: "delivery-1",
      accessExpiresAt: new Date(Date.now() + 1000 * 60 * 60),
      version: { snapshot: { property: { addressLine1: "123 Original St" } } },
    });

    await resolveDeliveryByToken("raw-token");

    // This is the structural guarantee behind the whole fix: if the live
    // report/inspection/property relations are never even fetched here, the
    // public delivery path has no way to accidentally read post-finalization
    // CRM edits, regardless of what any page does with the result.
    expect(mockPrisma.reportDelivery.findUnique).toHaveBeenCalledWith(
      expect.objectContaining({ include: { version: true } })
    );
  });

  it("hands back exactly what's in the version snapshot, which is what a delivered version must keep showing", async () => {
    // Simulates a Property edited AFTER this version was finalized — the
    // snapshot below is what finalizeReport captured at the time, frozen.
    mockPrisma.reportDelivery.findUnique.mockResolvedValue({
      id: "delivery-1",
      accessExpiresAt: new Date(Date.now() + 1000 * 60 * 60),
      version: {
        snapshot: {
          reportNumber: "RPT-2026-AAAAAAAA",
          property: { addressLine1: "123 Original St", city: "Springfield", state: "IL", zip: "62704" },
        },
      },
    });

    const delivery = await resolveDeliveryByToken("raw-token");

    expect(delivery?.version.snapshot).toMatchObject({
      reportNumber: "RPT-2026-AAAAAAAA",
      property: { addressLine1: "123 Original St" },
    });
  });

  it("returns null once the access token has expired", async () => {
    mockPrisma.reportDelivery.findUnique.mockResolvedValue({
      id: "delivery-1",
      accessExpiresAt: new Date(Date.now() - 1000),
      version: { snapshot: {} },
    });

    expect(await resolveDeliveryByToken("raw-token")).toBeNull();
  });

  it("returns null when no delivery matches the token hash", async () => {
    mockPrisma.reportDelivery.findUnique.mockResolvedValue(null);
    expect(await resolveDeliveryByToken("raw-token")).toBeNull();
  });
});

describe("markDeliveryViewed", () => {
  it("only flips status for a delivery not already VIEWED", async () => {
    await markDeliveryViewed("delivery-1");
    expect(mockPrisma.reportDelivery.updateMany).toHaveBeenCalledWith({
      where: { id: "delivery-1", status: { not: "VIEWED" } },
      data: { status: "VIEWED" },
    });
  });
});

// ---------------------------------------------------------------------------
// Revocation and superseded versions (audit findings #9, #73)
// ---------------------------------------------------------------------------

type Fn = ReturnType<typeof vi.fn>;
const db = prisma as unknown as Record<string, Record<string, Fn>>;
const future = new Date(Date.now() + 86_400_000);
const delivery = (over: Record<string, unknown> = {}) => ({ id: "d1", reportId: "rep-1", accessExpiresAt: future, revokedAt: null, version: { versionNumber: 1, snapshot: {} }, ...over });

beforeEach(() => vi.clearAllMocks());

describe("report links", () => {
  it("a revoked link stops working", async () => {
    db.reportDelivery.findUnique.mockResolvedValue(delivery({ revokedAt: new Date() }));
    expect(await resolveDeliveryByToken("token")).toBeNull();
  });

  it("an older version's link still opens, but says a newer version exists", async () => {
    db.reportDelivery.findUnique.mockResolvedValue(delivery());
    db.reportVersion.findFirst.mockResolvedValue({ versionNumber: 2 });
    expect(await resolveDeliveryByToken("token")).toMatchObject({ id: "d1", supersededBy: 2 });
    db.reportVersion.findFirst.mockResolvedValue({ versionNumber: 1 });
    expect(await resolveDeliveryByToken("token")).toMatchObject({ supersededBy: null });
  });

  it("a queued report email is cancelled if its link was revoked or a newer version was finalized", async () => {
    const guard = { checks: [{ kind: "reportDeliveryValid" as const, reportDeliveryId: "d1" }] };
    db.reportDelivery.findUnique.mockResolvedValue({ versionId: "v1", revokedAt: new Date(), report: { versions: [{ id: "v1" }] } });
    expect(await evaluateGuard(guard, prisma as never)).toEqual({ ok: false, reason: "The report link was revoked" });
    db.reportDelivery.findUnique.mockResolvedValue({ versionId: "v1", revokedAt: null, report: { versions: [{ id: "v2" }] } });
    expect(await evaluateGuard(guard, prisma as never)).toEqual({ ok: false, reason: "A newer version of this report was finalized" });
    db.reportDelivery.findUnique.mockResolvedValue({ versionId: "v2", revokedAt: null, report: { versions: [{ id: "v2" }] } });
    expect(await evaluateGuard(guard, prisma as never)).toEqual({ ok: true });
  });
});
