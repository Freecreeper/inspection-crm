import { describe, it, expect } from "vitest";
import { readinessChecklist, readinessWarnings, type ReadinessInput } from "./readiness";

const ready: ReadinessInput = {
  status: "SCHEDULED",
  inspectorId: "u1",
  agreementSignedAt: new Date("2026-09-20"),
  serviceCount: 2,
  customer: { phone: "8285550101", email: null },
  balanceDue: true,
  requirePaymentBeforeInspection: false,
};

describe("readiness warnings", () => {
  it("an inspection with the essentials has no warnings — an unpaid balance isn't one unless required", () => {
    expect(readinessWarnings(ready)).toEqual([]);
  });

  it("warns only about things that could derail the appointment, from actual data", () => {
    const warnings = readinessWarnings({ ...ready, inspectorId: null, agreementSignedAt: null, serviceCount: 0, customer: { phone: null, email: null } });
    expect(warnings.map((w) => w.code)).toEqual(["noInspector", "agreementUnsigned", "noCustomerContact", "noServices"]);
  });

  it("a customer reachable by email alone is fine; no customer at all is a warning", () => {
    expect(readinessWarnings({ ...ready, customer: { phone: null, email: "a@b.test" } })).toEqual([]);
    expect(readinessWarnings({ ...ready, customer: null }).map((w) => w.code)).toEqual(["noCustomerContact"]);
  });

  it("payment is a warning only when the business requires it before the inspection", () => {
    expect(readinessWarnings({ ...ready, requirePaymentBeforeInspection: true }).map((w) => w.code)).toEqual(["paymentDue"]);
    expect(readinessWarnings({ ...ready, requirePaymentBeforeInspection: true, balanceDue: false })).toEqual([]);
  });

  it("finished or cancelled inspections have nothing to warn about", () => {
    expect(readinessWarnings({ ...ready, status: "COMPLETED", inspectorId: null })).toEqual([]);
    expect(readinessWarnings({ ...ready, status: "CANCELLED", agreementSignedAt: null })).toEqual([]);
  });
});

describe("readiness checklist", () => {
  it("reports facts, never inventing a 'done'", () => {
    const list = readinessChecklist({
      status: "SCHEDULED",
      agreementSignedAt: null,
      payment: null,
      requirePaymentBeforeInspection: false,
      confirmation: "sent",
      report: null,
    });
    expect(list.map((i) => [i.key, i.state])).toEqual([
      ["agreement", "warn"],
      ["payment", "pending"],
      ["confirmation", "done"],
      ["inspection", "pending"],
      ["report", "pending"],
    ]);
  });

  it("shows payment received and a delivered report when that's what the records say", () => {
    const list = readinessChecklist({
      status: "COMPLETED",
      agreementSignedAt: new Date(),
      payment: { invoiced: true, balanceDue: false },
      requirePaymentBeforeInspection: true,
      confirmation: "skipped",
      report: { status: "DELIVERED", delivered: true },
    });
    expect(Object.fromEntries(list.map((i) => [i.key, i.label]))).toEqual({
      agreement: "Agreement signed",
      payment: "Payment received",
      confirmation: "Confirmation not sent",
      inspection: "Inspection completed",
      report: "Report delivered",
    });
  });
});
