import { describe, it, expect, vi, beforeEach } from "vitest";

vi.mock("@/lib/prisma", async () => {
  const { createMockPrisma } = await import("@/test-utils/mockPrisma");
  return { prisma: createMockPrisma() };
});
vi.mock("@/lib/auth", () => ({ auth: vi.fn(async () => ({ user: { id: "u1", role: "OFFICE_STAFF" } })) }));
vi.mock("next/cache", () => ({ revalidatePath: vi.fn() }));
vi.mock("next/navigation", () => ({
  redirect: vi.fn((to: string) => {
    throw new Error(`REDIRECT ${to}`);
  }),
}));

import { prisma } from "@/lib/prisma";
import { convertLead } from "./actions";

type Fn = ReturnType<typeof vi.fn>;
const db = prisma as unknown as Record<string, Record<string, Fn>>;

beforeEach(() => vi.clearAllMocks());

describe("convertLead", () => {
  it("converting twice creates one customer and one transaction; the repeat goes to the first", async () => {
    db.lead.findUniqueOrThrow.mockResolvedValue({ id: "l1", firstName: "Ava", lastName: "Chen", email: null, phone: null, referralSourceId: null, convertedCustomerId: null });
    db.lead.updateMany.mockResolvedValueOnce({ count: 1 }).mockResolvedValueOnce({ count: 0 });
    db.customer.create.mockResolvedValue({ id: "c1" });
    db.transaction.create.mockResolvedValue({ id: "t1" });
    db.lead.findUnique.mockResolvedValue({ convertedCustomerId: "c1" });
    db.transactionCustomer.findFirst.mockResolvedValue({ transactionId: "t1" });

    await expect(convertLead("l1")).rejects.toThrow("REDIRECT /transactions/t1");
    await expect(convertLead("l1")).rejects.toThrow("REDIRECT /transactions/t1");
    expect(db.customer.create).toHaveBeenCalledTimes(1);
    expect(db.transaction.create).toHaveBeenCalledTimes(1);
    expect(db.lead.updateMany).toHaveBeenCalledWith(expect.objectContaining({ where: { id: "l1", status: { not: "CONVERTED" } } }));
  });
});
