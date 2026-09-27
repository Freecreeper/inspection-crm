import { describe, it, expect, vi, beforeEach } from "vitest";

vi.mock("@/lib/prisma", async () => {
  const { createMockPrisma } = await import("@/test-utils/mockPrisma");
  return { prisma: createMockPrisma() };
});
vi.mock("@/lib/auth", () => ({ auth: vi.fn() }));
vi.mock("next/cache", () => ({ revalidatePath: vi.fn() }));

import { prisma } from "@/lib/prisma";
import { auth } from "@/lib/auth";
import { createBrokerageQuick, getBrokeragePreview, updateBrokerageField } from "./actions";

type Fn = ReturnType<typeof vi.fn>;
const db = prisma as unknown as Record<string, Record<string, Fn>>;
const input = (over: Record<string, unknown> = {}) => ({
  name: "Blue Ridge Realty",
  phone: "(828) 555-0142",
  email: "",
  addressLine1: "12 Main St",
  city: "Hickory",
  state: "nc",
  zip: "28601",
  ...over,
});

beforeEach(() => {
  vi.clearAllMocks();
  vi.mocked(auth).mockResolvedValue({ user: { id: "u1", role: "OFFICE_STAFF" } } as never);
  db.brokerage.findMany.mockResolvedValue([]);
  db.brokerage.create.mockResolvedValue({ id: "b1" });
});

describe("createBrokerageQuick", () => {
  it("stores phone as digits, saves the address, and audits it", async () => {
    expect(await createBrokerageQuick(input())).toEqual({ ok: true, data: { id: "b1" } });
    expect(db.brokerage.create).toHaveBeenCalledWith({
      data: { name: "Blue Ridge Realty", phone: "8285550142", email: null, addressLine1: "12 Main St", city: "Hickory", state: "NC", zip: "28601" },
    });
    expect(db.activityLog.create).toHaveBeenCalledWith({ data: expect.objectContaining({ action: "brokerage.created", entityId: "b1" }) });
  });

  it("shows likely duplicates instead of creating, until confirmed", async () => {
    db.brokerage.findMany.mockResolvedValue([{ id: "b0", name: "blue ridge realty", phone: null, city: "Hickory", state: "NC" }]);
    expect(await createBrokerageQuick(input())).toEqual({
      ok: false,
      duplicates: [{ id: "b0", name: "blue ridge realty", phone: null, city: "Hickory", state: "NC", reason: "name" }],
    });
    expect(db.brokerage.create).not.toHaveBeenCalled();

    expect(await createBrokerageQuick(input({ confirmDuplicates: true }))).toMatchObject({ ok: true });
    expect(db.brokerage.create).toHaveBeenCalledTimes(1);
  });

  it("rejects bad input without saving", async () => {
    expect(await createBrokerageQuick(input({ name: "  " }))).toMatchObject({ ok: false, error: "Brokerage name is required." });
    expect(await createBrokerageQuick(input({ phone: "555-0142" }))).toMatchObject({ ok: false, error: expect.stringContaining("10 digits") });
    expect(await createBrokerageQuick(input({ email: "nope" }))).toMatchObject({ ok: false });
    expect(await createBrokerageQuick(input({ state: "North Carolina" }))).toMatchObject({ ok: false });
    expect(db.brokerage.create).not.toHaveBeenCalled();
  });

  it("requires write access", async () => {
    vi.mocked(auth).mockResolvedValue({ user: { id: "u2", role: "REPORTING_ANALYST" } } as never);
    await expect(createBrokerageQuick(input())).rejects.toThrow();
    expect(db.brokerage.create).not.toHaveBeenCalled();
  });
});

describe("updateBrokerageField", () => {
  const existing = { id: "b1", name: "KW", phone: null, email: null, addressLine1: null, city: "Hickory", state: "NC", zip: null, archivedAt: null };
  beforeEach(() => {
    db.brokerage.findUnique.mockResolvedValue(existing);
    db.brokerage.update.mockResolvedValue({});
  });

  it("saves one normalized field and audits before/after", async () => {
    expect(await updateBrokerageField("b1", "phone", "(828) 555-0100")).toEqual({ ok: true });
    expect(db.brokerage.update).toHaveBeenCalledWith({ where: { id: "b1" }, data: { phone: "8285550100" } });
    expect(db.activityLog.create).toHaveBeenCalledWith({
      data: expect.objectContaining({ action: "brokerage.updated", before: { phone: null }, after: { phone: "8285550100" } }),
    });
  });

  it("validates like creating does, and won't blank the name", async () => {
    expect(await updateBrokerageField("b1", "email", "nope")).toMatchObject({ ok: false });
    expect(await updateBrokerageField("b1", "state", "Carolina")).toMatchObject({ ok: false });
    expect(await updateBrokerageField("b1", "name", " ")).toMatchObject({ ok: false });
    expect(await updateBrokerageField("b1", "archivedAt" as never, "x")).toMatchObject({ ok: false });
    expect(db.brokerage.update).not.toHaveBeenCalled();
  });

  it("an unchanged value is a no-op, and viewers can't edit", async () => {
    expect(await updateBrokerageField("b1", "city", " Hickory ")).toEqual({ ok: true });
    expect(db.brokerage.update).not.toHaveBeenCalled();
    vi.mocked(auth).mockResolvedValue({ user: { id: "u2", role: "REPORTING_ANALYST" } } as never);
    await expect(updateBrokerageField("b1", "city", "Boone")).rejects.toThrow();
  });
});

describe("getBrokeragePreview", () => {
  it("counts current realtors and deals worked while at this brokerage", async () => {
    db.brokerage.findFirst.mockResolvedValue({ id: "b1", name: "KW", phone: null, email: null, addressLine1: "1 Main", city: "Hickory", state: "NC", zip: null });
    db.realtor.count.mockResolvedValue(7);
    db.realtor.findMany.mockResolvedValue([{ id: "r1", firstName: "Sarah", lastName: "Jones", preferredName: "Sally", phone: null, email: null }]);
    db.transaction.count.mockResolvedValue(3);
    db.transaction.findFirst.mockResolvedValue({ createdAt: new Date("2026-09-23T12:00:00Z") });

    const preview = await getBrokeragePreview("b1");
    expect(preview).toMatchObject({
      address: "1 Main, Hickory, NC",
      stats: { currentRealtors: 7, transactions: 3, lastTransactionAt: "2026-09-23T12:00:00.000Z" },
      realtors: [{ id: "r1", name: "Sally Jones" }],
      permissions: { canWrite: true },
    });
    expect(db.transaction.count).toHaveBeenCalledWith({ where: { archivedAt: null, realtors: { some: { brokerageId: "b1" } } } });
  });

  it("returns null for a missing or archived brokerage", async () => {
    db.brokerage.findFirst.mockResolvedValue(null);
    expect(await getBrokeragePreview("gone")).toBeNull();
  });
});
