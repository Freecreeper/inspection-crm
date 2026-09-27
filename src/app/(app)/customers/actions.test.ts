import { describe, it, expect, vi, beforeEach } from "vitest";

vi.mock("@/lib/prisma", async () => {
  const { createMockPrisma } = await import("@/test-utils/mockPrisma");
  return { prisma: createMockPrisma() };
});
vi.mock("@/lib/auth", () => ({ auth: vi.fn() }));
vi.mock("next/cache", () => ({ revalidatePath: vi.fn() }));

import { prisma } from "@/lib/prisma";
import { auth } from "@/lib/auth";
import { updateCustomerContact } from "./actions";

type Fn = ReturnType<typeof vi.fn>;
const db = prisma as unknown as Record<string, Record<string, Fn>>;

beforeEach(() => {
  vi.clearAllMocks();
  vi.mocked(auth).mockResolvedValue({ user: { id: "u1", role: "OFFICE_STAFF" } } as never);
  db.customer.findUnique.mockResolvedValue({ id: "c1", email: null, phone: "8285550100" });
});

describe("updateCustomerContact", () => {
  it("adds a missing email and audits the change", async () => {
    expect(await updateCustomerContact("c1", "email", "  ava@example.test ")).toEqual({ ok: true });
    expect(db.customer.update).toHaveBeenCalledWith({ where: { id: "c1" }, data: { email: "ava@example.test" } });
    expect(db.activityLog.create).toHaveBeenCalledWith({
      data: expect.objectContaining({ action: "customer.contact_updated", before: { email: null }, after: { email: "ava@example.test" } }),
    });
  });

  it("rejects invalid values without saving", async () => {
    expect(await updateCustomerContact("c1", "email", "not-an-email")).toMatchObject({ ok: false });
    expect(await updateCustomerContact("c1", "phone", "555")).toMatchObject({ ok: false });
    expect(db.customer.update).not.toHaveBeenCalled();
  });

  it("stores phone digits only, and blank clears", async () => {
    await updateCustomerContact("c1", "phone", "(828) 555-0199");
    expect(db.customer.update).toHaveBeenLastCalledWith({ where: { id: "c1" }, data: { phone: "8285550199" } });
    await updateCustomerContact("c1", "email", "");
    expect(db.customer.update).toHaveBeenLastCalledWith({ where: { id: "c1" }, data: { email: null } });
  });

  it("requires write access", async () => {
    vi.mocked(auth).mockResolvedValue({ user: { id: "u2", role: "REPORTING_ANALYST" } } as never);
    await expect(updateCustomerContact("c1", "email", "ava@example.test")).rejects.toThrow();
    expect(db.customer.update).not.toHaveBeenCalled();
  });
});
