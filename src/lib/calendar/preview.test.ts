import { describe, it, expect, vi, beforeEach } from "vitest";
import { Prisma } from "@prisma/client";

vi.mock("@/lib/prisma", async () => {
  const { createMockPrisma } = await import("@/test-utils/mockPrisma");
  return { prisma: createMockPrisma() };
});

import { prisma } from "@/lib/prisma";
import { loadInspectionPreview } from "./preview";

type Fn = ReturnType<typeof vi.fn>;
const db = prisma as unknown as Record<string, Record<string, Fn>> & { $queryRaw: Fn };

const row = (over: Record<string, unknown> = {}) => ({
  id: "i1",
  status: "SCHEDULED",
  scheduledAt: new Date("2026-09-29T13:00:00Z"),
  durationMinutes: 180,
  inspectorId: "u1",
  agreementSignedAt: null,
  accessNotes: "Lockbox 1234",
  property: { addressLine1: "123 Main Street", addressLine2: null, city: "Hickory", state: "NC", zip: "28601" },
  inspector: { id: "u1", name: "Ed" },
  inspectionServices: [{ service: { name: "General Home Inspection" } }],
  reports: [],
  emailMessages: [{ status: "SENT" }],
  transaction: {
    id: "t1",
    customers: [
      { primaryContact: false, customer: { id: "c2", firstName: "Mary", lastName: "Smith", phone: null, email: "mary@x.test" } },
      { primaryContact: true, customer: { id: "c1", firstName: "John", lastName: "Smith", phone: "8285550101", email: null } },
    ],
    realtors: [
      { role: "BUYER_AGENT", brokerageName: "Keller Williams", realtor: { id: "r1", firstName: "Sarah", lastName: "Jones", preferredName: "Sally", phone: null, email: "s@kw.test", brokerage: { name: "RE/MAX" } } },
    ],
    invoices: [{ status: "SENT", items: [{ amount: new Prisma.Decimal("450") }], payments: [{ amount: new Prisma.Decimal("450") }] }],
  },
  ...over,
});

beforeEach(() => {
  vi.clearAllMocks();
  vi.stubEnv("APP_TIMEZONE", "America/New_York");
  db.$queryRaw.mockResolvedValue([]);
  db.appointment.findMany.mockResolvedValue([]);
});

describe("inspection preview", () => {
  it("shows the primary customer, the realtor with the brokerage from that deal, and the inspector", async () => {
    db.inspection.findUnique.mockResolvedValue(row());
    const p = (await loadInspectionPreview("i1", "OFFICE_STAFF"))!;
    expect(p.customer).toEqual({ id: "c1", name: "John Smith", phone: "8285550101", email: null });
    expect(p.otherCustomers).toBe(1);
    // The snapshot on the transaction wins over the realtor's current brokerage.
    expect(p.realtors).toEqual([{ id: "r1", name: "Sally Jones", brokerage: "Keller Williams", role: "Buyer agent", phone: null, email: "s@kw.test" }]);
    expect(p.inspector).toEqual({ id: "u1", name: "Ed" });
    expect(p).toMatchObject({ day: "2026-09-29", time: "09:00", end: "2026-09-29T16:00:00.000Z", accessNotes: "Lockbox 1234" });
  });

  it("readiness comes from the records: unsigned agreement warns, paid invoice and sent confirmation are done", async () => {
    db.inspection.findUnique.mockResolvedValue(row());
    const p = (await loadInspectionPreview("i1", "OFFICE_STAFF"))!;
    expect(p.warnings.map((w) => w.code)).toEqual(["agreementUnsigned"]);
    expect(Object.fromEntries(p.checklist.map((i) => [i.key, i.state]))).toMatchObject({ agreement: "warn", payment: "done", confirmation: "done", report: "pending" });
  });

  it("missing optional data stays missing — no realtor, no customer, nothing invented", async () => {
    db.inspection.findUnique.mockResolvedValue(row({ transaction: { id: "t1", customers: [], realtors: [], invoices: [] }, emailMessages: [] }));
    const p = (await loadInspectionPreview("i1", "OFFICE_STAFF"))!;
    expect(p.customer).toBeNull();
    expect(p.realtors).toEqual([]);
    expect(p.checklist.find((i) => i.key === "confirmation")).toMatchObject({ state: "na" });
    expect(p.warnings.map((w) => w.code)).toContain("noCustomerContact");
  });

  it("surfaces a real overlap as a conflict warning", async () => {
    db.inspection.findUnique.mockResolvedValue(row());
    db.$queryRaw.mockResolvedValue([{ id: "i9", scheduledAt: new Date("2026-09-29T14:00:00Z"), durationMinutes: 60, addressLine1: "455 Oak Avenue", city: "Hickory" }]);
    const p = (await loadInspectionPreview("i1", "OFFICE_STAFF"))!;
    expect(p.warnings[0].code).toBe("conflict");
    expect(p.conflicts).toEqual([{ kind: "inspection", title: "455 Oak Avenue, Hickory", start: "2026-09-29T14:00:00.000Z", end: "2026-09-29T15:00:00.000Z" }]);
  });

  it("permissions follow the role and the inspection's state", async () => {
    db.inspection.findUnique.mockResolvedValue(row());
    expect((await loadInspectionPreview("i1", "INSPECTOR"))!.permissions).toEqual({ canReschedule: false, canCancel: true, canEmail: false, canEditAgreement: false });
    db.inspection.findUnique.mockResolvedValue(row({ status: "COMPLETED" }));
    expect((await loadInspectionPreview("i1", "OWNER_ADMIN"))!.permissions).toMatchObject({ canReschedule: false, canCancel: false });
  });
});
