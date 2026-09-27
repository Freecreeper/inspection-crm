import { describe, it, expect, vi, beforeEach } from "vitest";

vi.mock("@/lib/prisma", async () => {
  const { createMockPrisma } = await import("@/test-utils/mockPrisma");
  return { prisma: createMockPrisma() };
});
vi.mock("@/lib/auth", () => ({ auth: vi.fn() }));
vi.mock("next/cache", () => ({ revalidatePath: vi.fn() }));

import { prisma } from "@/lib/prisma";
import { auth } from "@/lib/auth";
import { createBrokerageQuick } from "./actions";

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
