import { describe, it, expect, vi, beforeEach } from "vitest";

vi.mock("@/lib/prisma", async () => {
  const { createMockPrisma } = await import("@/test-utils/mockPrisma");
  return { prisma: createMockPrisma() };
});
vi.mock("@/lib/auth", () => ({ auth: vi.fn() }));
vi.mock("next/cache", () => ({ revalidatePath: vi.fn() }));

import { prisma } from "@/lib/prisma";
import { auth } from "@/lib/auth";
import { createBrokerage } from "./actions";

type Fn = ReturnType<typeof vi.fn>;
const db = prisma as unknown as Record<string, Record<string, Fn>>;
const form = (entries: Record<string, string>) => {
  const f = new FormData();
  for (const [k, v] of Object.entries(entries)) f.set(k, v);
  return f;
};

beforeEach(() => {
  vi.clearAllMocks();
  vi.mocked(auth).mockResolvedValue({ user: { id: "u1", role: "OFFICE_STAFF" } } as never);
});

describe("createBrokerage", () => {
  it("stores phone as digits and saves the address", async () => {
    await createBrokerage(
      form({ name: "Blue Ridge Realty", phone: "(828) 555-0142", email: "", addressLine1: "12 Main St", city: "Hickory", state: "nc", zip: "28601" })
    );
    expect(db.brokerage.create).toHaveBeenCalledWith({
      data: { name: "Blue Ridge Realty", phone: "8285550142", email: null, addressLine1: "12 Main St", city: "Hickory", state: "NC", zip: "28601" },
    });
  });

  it("rejects a phone number that isn't 10 digits", async () => {
    await expect(createBrokerage(form({ name: "Blue Ridge Realty", phone: "555-0142" }))).rejects.toThrow("10 digits");
    expect(db.brokerage.create).not.toHaveBeenCalled();
  });
});
