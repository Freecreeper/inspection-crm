import { describe, it, expect, vi, beforeEach } from "vitest";
import { Prisma } from "@prisma/client";

vi.mock("@/lib/prisma", async () => {
  const { createMockPrisma } = await import("@/test-utils/mockPrisma");
  return { prisma: createMockPrisma() };
});
vi.mock("@/lib/auth", () => ({ auth: vi.fn() }));
vi.mock("next/cache", () => ({ revalidatePath: vi.fn() }));

import { prisma } from "@/lib/prisma";
import { auth } from "@/lib/auth";
import { recordPayment } from "./actions";

type Fn = ReturnType<typeof vi.fn>;
const db = prisma as unknown as Record<string, Record<string, Fn>> & { $queryRaw: Fn };
const invoice = (payments: string[] = []) => ({
  id: "inv-1",
  transactionId: "t1",
  status: "SENT",
  items: [{ amount: new Prisma.Decimal("450.00") }],
  payments: payments.map((p) => ({ amount: new Prisma.Decimal(p) })),
});

beforeEach(() => {
  vi.clearAllMocks();
  vi.mocked(auth).mockResolvedValue({ user: { id: "u1", role: "OFFICE_STAFF" } } as never);
  db.emailMessage.updateMany.mockResolvedValue({ count: 1 });
  // The invoice row lock (SELECT … FOR UPDATE) finds the invoice.
  db.$queryRaw.mockResolvedValue([{ id: "inv-1" }]);
});

describe("recordPayment", () => {
  it("requires billing permission", async () => {
    vi.mocked(auth).mockResolvedValue({ user: { role: "INSPECTOR" } } as never);
    await expect(recordPayment("inv-1", { amount: "450", method: "CARD" })).rejects.toThrow();
    expect(db.payment.create).not.toHaveBeenCalled();
  });

  it("paying in full marks it PAID and withdraws any pending reminder", async () => {
    db.invoice.findUnique.mockResolvedValue(invoice());
    expect(await recordPayment("inv-1", { amount: "$450.00", method: "CARD" })).toEqual({ ok: true });
    expect(db.invoice.update).toHaveBeenCalledWith({ where: { id: "inv-1" }, data: { status: "PAID" } });
    expect(db.emailMessage.updateMany).toHaveBeenCalledWith({
      where: { invoiceId: "inv-1", status: { in: ["SCHEDULED", "QUEUED"] } },
      data: expect.objectContaining({ status: "CANCELLED", statusReason: "Invoice paid" }),
    });
  });

  it("a partial payment keeps reminders and marks PARTIALLY_PAID", async () => {
    db.invoice.findUnique.mockResolvedValue(invoice());
    await recordPayment("inv-1", { amount: "100", method: "CHECK" });
    expect(db.invoice.update).toHaveBeenCalledWith({ where: { id: "inv-1" }, data: { status: "PARTIALLY_PAID" } });
    expect(db.emailMessage.updateMany).not.toHaveBeenCalled();
  });

  it("rejects overpayment and nonsense amounts", async () => {
    db.invoice.findUnique.mockResolvedValue(invoice(["400.00"]));
    expect(await recordPayment("inv-1", { amount: "60", method: "CARD" })).toMatchObject({ ok: false });
    expect(await recordPayment("inv-1", { amount: "-5", method: "CARD" })).toMatchObject({ ok: false });
    expect(await recordPayment("inv-1", { amount: "abc", method: "CARD" })).toMatchObject({ ok: false });
    expect(db.payment.create).not.toHaveBeenCalled();
  });

  it("refuses NaN, Infinity and other values Decimal would accept (a NaN payment silently cleared A/R)", async () => {
    db.invoice.findUnique.mockResolvedValue(invoice());
    for (const amount of ["NaN", "nan", "Infinity", "-Infinity", "1e3", "0", "0.001", "12.345", "", "   "]) {
      expect(await recordPayment("inv-1", { amount, method: "CARD" }), amount).toMatchObject({ ok: false });
    }
    expect(db.payment.create).not.toHaveBeenCalled();
    expect(await recordPayment("inv-1", { amount: "$1,234.5", method: "CARD" })).toMatchObject({ ok: false }); // over the balance
    expect(await recordPayment("inv-1", { amount: " $ 450 ", method: "CARD" })).toEqual({ ok: true });
  });

  it("checks the balance under a lock on the invoice row, inside the same transaction as the write", async () => {
    const order: string[] = [];
    db.$queryRaw.mockImplementation(async () => (order.push("lock"), [{ id: "inv-1" }]));
    db.invoice.findUnique.mockImplementation(async () => (order.push("read"), invoice()));
    db.payment.create.mockImplementation(async () => order.push("write"));
    await recordPayment("inv-1", { amount: "100", method: "CASH" });
    expect(order).toEqual(["lock", "read", "write"]);
    expect(prisma.$transaction).toHaveBeenCalledTimes(1);
  });
});
