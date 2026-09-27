import { describe, it, expect, vi, beforeEach } from "vitest";

vi.mock("@/lib/prisma", async () => {
  const { createMockPrisma } = await import("@/test-utils/mockPrisma");
  return { prisma: createMockPrisma() };
});

import { prisma } from "@/lib/prisma";
import { findCustomerDuplicates, findPropertyDuplicates, normalizeStreet, searchCustomers, searchProperties, SEARCH_LIMIT } from "./records";

type Fn = ReturnType<typeof vi.fn>;
const db = prisma as unknown as Record<string, Record<string, Fn>>;

beforeEach(() => vi.clearAllMocks());

describe("typeahead search", () => {
  it("customers: every word must match a field, digits also match the phone, and only a few rows come back", async () => {
    db.customer.findMany.mockResolvedValue([{ id: "c1", firstName: "John", lastName: "Smith", email: null, phone: "8285550101" }]);
    const results = await searchCustomers("john 828");
    expect(results).toEqual([{ id: "c1", label: "John Smith", sublabel: "(828)555-0101" }]);
    const args = db.customer.findMany.mock.calls[0][0];
    expect(args.take).toBe(SEARCH_LIMIT);
    expect(args.where.archivedAt).toBeNull();
    expect(args.where.AND).toHaveLength(2);
    expect(args.where.AND[0].OR).toContainEqual({ firstName: { contains: "john", mode: "insensitive" } });
    expect(args.where.AND[1].OR).toContainEqual({ phone: { contains: "828" } });
  });

  it("an empty query never loads the table", async () => {
    expect(await searchCustomers("   ")).toEqual([]);
    expect(await searchProperties("")).toEqual([]);
    expect(db.customer.findMany).not.toHaveBeenCalled();
    expect(db.property.findMany).not.toHaveBeenCalled();
  });

  it("properties match street, city, or ZIP prefix", async () => {
    db.property.findMany.mockResolvedValue([{ id: "p1", addressLine1: "123 Main Street", addressLine2: null, city: "Hickory", state: "NC", zip: "28601" }]);
    expect(await searchProperties("123 main")).toEqual([{ id: "p1", label: "123 Main Street", sublabel: "Hickory, NC 28601" }]);
    const or = db.property.findMany.mock.calls[0][0].where.AND[0].OR;
    expect(or).toEqual([{ addressLine1: { contains: "123", mode: "insensitive" } }, { city: { contains: "123", mode: "insensitive" } }, { zip: { startsWith: "123" } }]);
  });
});

describe("duplicate protection", () => {
  it("normalizes street addresses so trivial differences still match", () => {
    expect(normalizeStreet("123 N. Main Street, Apt #4")).toBe(normalizeStreet("123 north main st apt 4"));
    expect(normalizeStreet("123 Main St")).not.toBe(normalizeStreet("124 Main St"));
  });

  it("a property at the same normalized address is offered instead of creating a duplicate", async () => {
    db.property.findMany.mockResolvedValue([
      { id: "p1", addressLine1: "123 Main Street", addressLine2: null, city: "Hickory", state: "NC", zip: "28601" },
      { id: "p2", addressLine1: "125 Main Street", addressLine2: null, city: "Hickory", state: "NC", zip: "28601" },
    ]);
    expect(await findPropertyDuplicates({ addressLine1: "123 main st.", city: "Hickory", zip: "28601-1234" })).toEqual([{ id: "p1", label: "123 Main Street", sublabel: "Hickory, NC 28601" }]);
  });

  it("customers match by exact email, exact phone (even if stored formatted), or same name — flagged, never merged", async () => {
    db.customer.findMany.mockResolvedValue([
      { id: "c1", firstName: "John", lastName: "Smith", email: null, phone: "(828) 555-0101" },
      { id: "c2", firstName: "Jon", lastName: "Smyth", email: "JOHN@x.test", phone: null },
      { id: "c3", firstName: "Jane", lastName: "Doe", email: null, phone: "9995550101" },
    ]);
    const dupes = await findCustomerDuplicates({ firstName: "john", lastName: "smith", email: "john@x.test", phone: "828-555-0101" });
    expect(dupes.map((d) => [d.id, d.reasons, d.exact])).toEqual([
      ["c1", ["phone", "name"], true],
      ["c2", ["email"], true],
    ]);
  });
});
