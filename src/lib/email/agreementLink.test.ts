import { describe, it, expect, vi, beforeEach } from "vitest";
import { Prisma } from "@prisma/client";

vi.mock("@/lib/prisma", async () => {
  const { createMockPrisma } = await import("@/test-utils/mockPrisma");
  return { prisma: createMockPrisma() };
});

import { prisma } from "@/lib/prisma";
import { loadEmailVariables } from "./context";

type Fn = ReturnType<typeof vi.fn>;
const db = prisma as unknown as Record<string, Record<string, Fn>>;

beforeEach(() => {
  vi.clearAllMocks();
  process.env.AUTH_SECRET = "test-secret-that-is-long-enough-for-hmac-signing";
  db.emailSettings.findUnique.mockResolvedValue({ id: "default", companyName: "Test Inspections", signature: "" });
  db.emailSettings.upsert.mockResolvedValue({ id: "default", companyName: "Test Inspections", signature: "" });
  db.customer.findUnique.mockResolvedValue({ id: "c1", firstName: "Gale", lastName: "Fixturely", email: "gale@example.com" });
  db.realtor.findUnique.mockResolvedValue({ id: "r1", firstName: "Avery", lastName: "Testwell", preferredName: null, brokerage: null });
  db.inspection.findUnique.mockResolvedValue({
    id: "i1",
    transactionId: "t1",
    scheduledAt: null,
    property: { addressLine1: "505 Test Rd", city: "Morganton", state: "NC", zip: "28655" },
    inspector: null,
    inspectionServices: [
      { price: new Prisma.Decimal("450.00"), service: { name: "General Home Inspection" } },
      { price: new Prisma.Decimal("150.00"), service: { name: "Radon Test" } },
    ],
  });
  db.inspectionAgreement.findFirst.mockResolvedValue({ id: "cmagr1234567890" });
});

describe("inspection email variables", () => {
  it("add up the inspection fee and give the customer their own signing link", async () => {
    const vars = await loadEmailVariables({ customerId: "c1", inspectionId: "i1" });
    expect(vars["inspection.fee"]).toBe("$600.00");
    expect(vars["agreement.link"]).toMatch(/\/a\/[\w-]+\.[\w-]+$/);
    expect(db.inspectionAgreement.findFirst).toHaveBeenCalledWith(expect.objectContaining({ where: expect.objectContaining({ inspectionId: "i1", customerId: "c1", status: "PENDING" }) }));
  });

  it("never put a customer's signing link in an email to a Realtor", async () => {
    const vars = await loadEmailVariables({ realtorId: "r1", inspectionId: "i1" });
    expect(vars["agreement.link"]).toBeUndefined();
    expect(db.inspectionAgreement.findFirst).not.toHaveBeenCalled();
  });
});
