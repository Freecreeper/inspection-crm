import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { Prisma } from "@prisma/client";

vi.mock("@/lib/prisma", async () => {
  const { createMockPrisma } = await import("@/test-utils/mockPrisma");
  return { prisma: createMockPrisma() };
});
vi.mock("@/lib/auth", () => ({ auth: vi.fn() }));
vi.mock("next/cache", () => ({ revalidatePath: vi.fn() }));

import { prisma } from "@/lib/prisma";
import { auth } from "@/lib/auth";
import { addInvoiceItem, createInvoice, deleteDraftInvoice, issueInvoice, setInvoiceDueDate, voidInvoice } from "./actions";

type Fn = ReturnType<typeof vi.fn>;
const db = prisma as unknown as Record<string, Record<string, Fn>> & { $queryRaw: Fn; $executeRaw: Fn; $transaction: Fn };
const d = (v: string) => new Prisma.Decimal(v);
const invoice = (over: Record<string, unknown> = {}) => ({
  id: "inv-1",
  transactionId: "t1",
  invoiceNumber: "INV-1001",
  status: "DRAFT",
  dueAt: null,
  items: [{ id: "li-1", description: "General Home Inspection", amount: d("450.00") }],
  payments: [],
  ...over,
});
const as = (role: string) => vi.mocked(auth).mockResolvedValue({ user: { id: "u1", role } } as never);

beforeEach(() => {
  vi.clearAllMocks();
  vi.useFakeTimers({ toFake: ["Date"], now: new Date("2026-10-30T15:00:00Z") });
  as("OFFICE_STAFF");
  db.$queryRaw.mockResolvedValue([{ id: "inv-1" }]);
  db.$executeRaw.mockResolvedValue(1);
  db.emailMessage.updateMany.mockResolvedValue({ count: 0 });
});
afterEach(() => vi.useRealTimers());

describe("createInvoice", () => {
  beforeEach(() => {
    db.transaction.findUnique.mockResolvedValue({ id: "t1", archivedAt: null });
    db.inspection.findFirst.mockResolvedValue({
      id: "i1",
      scheduledAt: new Date("2026-11-03T13:00:00Z"),
      inspectionServices: [
        { price: d("450.00"), service: { name: "General Home Inspection" } },
        { price: d("150.00"), service: { name: "Radon Test" } },
      ],
    });
    db.invoice.findFirst.mockResolvedValue(null);
    db.invoice.create.mockResolvedValue({ id: "inv-new" });
  });

  it("is for billing staff only", async () => {
    as("INSPECTOR");
    await expect(createInvoice({ transactionId: "t1", inspectionId: "i1" })).rejects.toThrow();
    expect(db.invoice.create).not.toHaveBeenCalled();
  });

  it("drafts the next number with the inspection's services at their snapshotted prices, due on the inspection day", async () => {
    // First $queryRaw is the numbering query (no row lock is taken on create).
    db.$queryRaw.mockResolvedValueOnce([{ highest: 1041 }]);
    expect(await createInvoice({ transactionId: "t1", inspectionId: "i1" })).toEqual({ ok: true, data: { id: "inv-new", existing: false } });
    expect(db.invoice.create).toHaveBeenCalledWith({
      data: {
        transactionId: "t1",
        inspectionId: "i1",
        invoiceNumber: "INV-1042",
        status: "DRAFT",
        dueAt: new Date("2026-11-04T04:59:00.000Z"),
        items: {
          create: [
            { description: "General Home Inspection", amount: d("450.00") },
            { description: "Radon Test", amount: d("150.00") },
          ],
        },
      },
      select: { id: true },
    });
    expect(db.activityLog.create).toHaveBeenCalledWith({ data: expect.objectContaining({ action: "invoice.created", entityId: "inv-new" }) });
  });

  it("starts the sequence at INV-1001", async () => {
    db.$queryRaw.mockResolvedValueOnce([{ highest: null }]);
    await createInvoice({ transactionId: "t1" });
    expect(db.invoice.create).toHaveBeenCalledWith(expect.objectContaining({ data: expect.objectContaining({ invoiceNumber: "INV-1001", inspectionId: null, items: { create: [] } }) }));
  });

  it("opens the inspection's existing invoice instead of creating a second one", async () => {
    db.invoice.findFirst.mockResolvedValue({ id: "inv-old" });
    expect(await createInvoice({ transactionId: "t1", inspectionId: "i1" })).toEqual({ ok: true, data: { id: "inv-old", existing: true } });
    expect(db.invoice.create).not.toHaveBeenCalled();
    expect(db.invoice.findFirst).toHaveBeenCalledWith({ where: { inspectionId: "i1", status: { not: "VOID" } }, select: { id: true } });
  });

  it("refuses an inspection from another transaction", async () => {
    db.inspection.findFirst.mockResolvedValue(null);
    expect(await createInvoice({ transactionId: "t1", inspectionId: "i-other" })).toMatchObject({ ok: false });
    expect(db.invoice.create).not.toHaveBeenCalled();
  });
});

describe("editing lines", () => {
  it("adds a line to a draft, discounts included", async () => {
    db.invoice.findUnique.mockResolvedValue(invoice());
    expect(await addInvoiceItem("inv-1", { description: "Multi-service discount", amount: "-$50" })).toEqual({ ok: true, data: undefined });
    expect(db.invoiceItem.create).toHaveBeenCalledWith({ data: { invoiceId: "inv-1", description: "Multi-service discount", amount: d("-50") } });
  });

  it("never changes an issued invoice", async () => {
    db.invoice.findUnique.mockResolvedValue(invoice({ status: "SENT" }));
    expect(await addInvoiceItem("inv-1", { description: "Trip charge", amount: "35" })).toMatchObject({ ok: false, error: expect.stringContaining("Only a draft") });
    expect(db.invoiceItem.create).not.toHaveBeenCalled();
  });

  it("refuses an empty description or a zero amount", async () => {
    db.invoice.findUnique.mockResolvedValue(invoice());
    expect(await addInvoiceItem("inv-1", { description: "  ", amount: "35" })).toMatchObject({ ok: false });
    expect(await addInvoiceItem("inv-1", { description: "Trip charge", amount: "0" })).toMatchObject({ ok: false });
    expect(db.invoiceItem.create).not.toHaveBeenCalled();
  });

  it("works on the invoice only while holding its row lock", async () => {
    const order: string[] = [];
    db.$queryRaw.mockImplementation(async () => (order.push("lock"), [{ id: "inv-1" }]));
    db.invoice.findUnique.mockImplementation(async () => (order.push("read"), invoice()));
    db.invoiceItem.create.mockImplementation(async () => order.push("write"));
    await addInvoiceItem("inv-1", { description: "Trip charge", amount: "35" });
    expect(order).toEqual(["lock", "read", "write"]);
  });
});

describe("due date", () => {
  it("is stored at the end of the chosen day, and can be cleared", async () => {
    db.invoice.findUnique.mockResolvedValue(invoice({ status: "SENT" }));
    await setInvoiceDueDate("inv-1", "2026-11-10");
    expect(db.invoice.update).toHaveBeenLastCalledWith({ where: { id: "inv-1" }, data: { dueAt: new Date("2026-11-11T04:59:00.000Z") } });
    await setInvoiceDueDate("inv-1", "");
    expect(db.invoice.update).toHaveBeenLastCalledWith({ where: { id: "inv-1" }, data: { dueAt: null } });
  });

  it("is frozen once paid or void", async () => {
    db.invoice.findUnique.mockResolvedValue(invoice({ status: "PAID" }));
    expect(await setInvoiceDueDate("inv-1", "2026-11-10")).toMatchObject({ ok: false });
    expect(db.invoice.update).not.toHaveBeenCalled();
  });
});

describe("issueInvoice", () => {
  it("issues a draft with lines and a positive total", async () => {
    db.invoice.findUnique.mockResolvedValue(invoice());
    expect(await issueInvoice("inv-1")).toEqual({ ok: true, data: undefined });
    expect(db.invoice.update).toHaveBeenCalledWith({ where: { id: "inv-1" }, data: { status: "SENT", issuedAt: new Date("2026-10-30T15:00:00Z") } });
  });

  it("refuses an empty invoice, a $0 total, or one already issued", async () => {
    db.invoice.findUnique.mockResolvedValueOnce(invoice({ items: [] }));
    expect(await issueInvoice("inv-1")).toMatchObject({ ok: false });
    db.invoice.findUnique.mockResolvedValueOnce(invoice({ items: [{ id: "a", description: "Fee", amount: d("50") }, { id: "b", description: "Discount", amount: d("-50") }] }));
    expect(await issueInvoice("inv-1")).toMatchObject({ ok: false });
    db.invoice.findUnique.mockResolvedValueOnce(invoice({ status: "SENT" }));
    expect(await issueInvoice("inv-1")).toMatchObject({ ok: false });
    expect(db.invoice.update).not.toHaveBeenCalled();
  });
});

describe("voiding and deleting", () => {
  it("voids an unpaid issued invoice and withdraws its pending reminders", async () => {
    db.invoice.findUnique.mockResolvedValue(invoice({ status: "SENT" }));
    expect(await voidInvoice("inv-1")).toEqual({ ok: true, data: undefined });
    expect(db.invoice.update).toHaveBeenCalledWith({ where: { id: "inv-1" }, data: { status: "VOID", voidedAt: expect.any(Date) } });
    expect(db.emailMessage.updateMany).toHaveBeenCalledWith({
      where: { invoiceId: "inv-1", status: { in: ["SCHEDULED", "QUEUED"] } },
      data: expect.objectContaining({ status: "CANCELLED", statusReason: "Invoice voided" }),
    });
  });

  it("won't void an invoice with payments, or let an inspector void at all", async () => {
    db.invoice.findUnique.mockResolvedValue(invoice({ status: "PARTIALLY_PAID", payments: [{ amount: d("100") }] }));
    expect(await voidInvoice("inv-1")).toMatchObject({ ok: false, error: expect.stringContaining("payments") });
    as("INSPECTOR");
    await expect(voidInvoice("inv-1")).rejects.toThrow();
    expect(db.invoice.update).not.toHaveBeenCalled();
  });

  it("deletes a draft (lines first), but never an issued invoice", async () => {
    db.emailMessage.count.mockResolvedValue(0);
    db.invoice.findUnique.mockResolvedValueOnce(invoice({ status: "SENT" }));
    expect(await deleteDraftInvoice("inv-1")).toMatchObject({ ok: false });
    expect(db.invoice.delete).not.toHaveBeenCalled();
    db.invoice.findUnique.mockResolvedValueOnce(invoice());
    expect(await deleteDraftInvoice("inv-1")).toEqual({ ok: true, data: { transactionId: "t1" } });
    expect(db.invoiceItem.deleteMany).toHaveBeenCalledWith({ where: { invoiceId: "inv-1" } });
    expect(db.invoice.delete).toHaveBeenCalledWith({ where: { id: "inv-1" } });
  });
});
