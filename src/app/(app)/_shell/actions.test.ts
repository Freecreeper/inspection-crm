import { describe, it, expect, vi, beforeEach } from "vitest";

vi.mock("@/lib/prisma", async () => {
  const { createMockPrisma } = await import("@/test-utils/mockPrisma");
  return { prisma: createMockPrisma() };
});
vi.mock("@/lib/auth", () => ({ auth: vi.fn() }));

import { prisma } from "@/lib/prisma";
import { auth } from "@/lib/auth";
import { searchEverything } from "./actions";

type Fn = ReturnType<typeof vi.fn>;
const db = prisma as unknown as Record<string, Record<string, Fn>>;
const as = (role: string | null, id: string | null = "u-a") => vi.mocked(auth).mockResolvedValue((role ? { user: { id, role } } : null) as never);

beforeEach(() => {
  vi.clearAllMocks();
  as("OWNER_ADMIN", "u-a");
});

describe("global search", () => {
  beforeEach(() => {
    for (const model of ["customer", "realtor", "brokerage", "property", "transaction", "inspection"]) db[model].findMany.mockResolvedValue([]);
  });

  it("requires a signed-in role with search access", async () => {
    as(null);
    await expect(searchEverything("main")).rejects.toThrow();
    as("SOMETHING_ELSE");
    await expect(searchEverything("main")).rejects.toThrow();
    expect(db.customer.findMany).not.toHaveBeenCalled();
  });

  it("is server-side, limited, and needs at least two characters", async () => {
    expect(await searchEverything("m")).toEqual([]);
    expect(db.customer.findMany).not.toHaveBeenCalled();

    db.inspection.findMany.mockResolvedValue([{ id: "i1", status: "SCHEDULED", scheduledAt: new Date("2026-09-29T13:00:00Z"), property: { addressLine1: "123 Main St", city: "Hickory" } }]);
    db.brokerage.findMany.mockResolvedValue([{ id: "b1", name: "Main Street Realty", city: "Hickory" }]);
    const results = await searchEverything("main");
    expect(results).toEqual([
      { kind: "brokerage", id: "b1", label: "Main Street Realty", sublabel: "Hickory", href: "/brokerages/b1" },
      { kind: "inspection", id: "i1", label: "123 Main St, Hickory", sublabel: "scheduled · Tue, Sep 29, 9:00 AM", href: "/inspections/i1" },
    ]);
    for (const model of ["brokerage", "property", "transaction", "inspection"]) {
      expect(db[model].findMany).toHaveBeenCalledWith(expect.objectContaining({ take: 5 }));
    }
  });
});
