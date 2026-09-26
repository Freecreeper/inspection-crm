import { describe, it, expect, vi, beforeEach } from "vitest";

vi.mock("@/lib/prisma", async () => {
  const { createMockPrisma } = await import("@/test-utils/mockPrisma");
  return { prisma: createMockPrisma() };
});

import { prisma } from "@/lib/prisma";
import { classifyDuplicate, findRealtorDuplicates } from "./duplicates";

type Fn = ReturnType<typeof vi.fn>;
const db = prisma as unknown as Record<string, Record<string, Fn>>;

const row = { id: "r1", firstName: "Sarah", lastName: "Jones", email: "Sarah@KW.test", phone: "8285550101", brokerageId: "b1", brokerage: { name: "KW" } };

beforeEach(() => vi.clearAllMocks());

describe("classifyDuplicate", () => {
  it("flags exact email and phone matches regardless of formatting or case", () => {
    expect(classifyDuplicate({ firstName: "X", lastName: "Y", email: "sarah@kw.test" }, row)).toEqual(["email"]);
    expect(classifyDuplicate({ firstName: "X", lastName: "Y", phone: "(828) 555-0101" }, row)).toEqual(["phone"]);
  });

  it("flags name + brokerage as a probable match only when the brokerage matches too", () => {
    expect(classifyDuplicate({ firstName: "sarah", lastName: "JONES", brokerageId: "b1" }, row)).toEqual(["nameBrokerage"]);
    expect(classifyDuplicate({ firstName: "Sarah", lastName: "Jones", brokerageId: "b2" }, row)).toEqual([]);
  });
});

describe("findRealtorDuplicates", () => {
  it("returns nothing (and doesn't query) when there's nothing to compare", async () => {
    expect(await findRealtorDuplicates({ firstName: "", lastName: "" })).toEqual([]);
    expect(db.realtor.findMany).not.toHaveBeenCalled();
  });

  it("ranks exact matches ahead of probable ones", async () => {
    db.realtor.findMany.mockResolvedValue([
      { ...row, id: "probable", email: null, phone: null },
      { ...row, id: "exact", firstName: "Other" },
    ]);
    const result = await findRealtorDuplicates({ firstName: "Sarah", lastName: "Jones", email: "sarah@kw.test", brokerageId: "b1" });
    expect(result.map((c) => [c.id, c.exact])).toEqual([
      ["exact", true],
      ["probable", false],
    ]);
  });
});
