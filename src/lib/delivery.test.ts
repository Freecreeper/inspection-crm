import { describe, it, expect, vi, beforeEach } from "vitest";

vi.mock("@/lib/prisma", async () => {
  const { createMockPrisma } = await import("@/test-utils/mockPrisma");
  return { prisma: createMockPrisma() };
});

import { prisma } from "@/lib/prisma";
import { resolveDeliveryByToken, markDeliveryViewed } from "./delivery";

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
