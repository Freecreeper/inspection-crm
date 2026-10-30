import { describe, it, expect } from "vitest";
import { defaultInvoiceDueDay, invoiceDueAt, invoiceNumberAfter, isInvoiceEditable, parseLineAmount } from "./invoices";
import { toDayKey } from "./calendar/time";

describe("invoice lines", () => {
  it("accepts dollars, cents and a minus sign for discounts", () => {
    expect(parseLineAmount("$1,250.5")?.toFixed(2)).toBe("1250.50");
    expect(parseLineAmount("-50")?.toFixed(2)).toBe("-50.00");
  });

  it("refuses zero, junk and too many decimals", () => {
    for (const raw of ["0", "0.00", "", "abc", "1.234", "NaN", "Infinity", "--5"]) expect(parseLineAmount(raw)).toBeNull();
  });
});

describe("invoice numbers", () => {
  it("start at INV-1001 and count up from the highest", () => {
    expect(invoiceNumberAfter(null)).toBe("INV-1001");
    expect(invoiceNumberAfter(12)).toBe("INV-1001");
    expect(invoiceNumberAfter(1041)).toBe("INV-1042");
  });
});

describe("due dates", () => {
  it("defaults to the inspection day while it's ahead, else a week out", () => {
    expect(defaultInvoiceDueDay("2026-10-30", "2026-11-03")).toBe("2026-11-03");
    expect(defaultInvoiceDueDay("2026-10-30", "2026-10-30")).toBe("2026-10-30");
    expect(defaultInvoiceDueDay("2026-10-30", "2026-10-27")).toBe("2026-11-06");
    expect(defaultInvoiceDueDay("2026-10-30", null)).toBe("2026-11-06");
  });

  it("is stored at the end of that business day, so it reads back as the same day", () => {
    const at = invoiceDueAt("2026-11-03", "America/New_York");
    expect(toDayKey(at, "America/New_York")).toBe("2026-11-03");
    expect(at.toISOString()).toBe("2026-11-04T04:59:00.000Z");
  });
});

it("only drafts are editable", () => {
  expect(isInvoiceEditable("DRAFT")).toBe(true);
  for (const s of ["SENT", "PAID", "PARTIALLY_PAID", "OVERDUE", "VOID"] as const) expect(isInvoiceEditable(s)).toBe(false);
});
