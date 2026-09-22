import { describe, it, expect } from "vitest";
import { generateReportNumber, isReportEditable, syncReportSummary } from "./reportEngine";
import { createMockPrisma } from "@/test-utils/mockPrisma";

describe("generateReportNumber", () => {
  it("matches RPT-<year>-<8 hex chars>", () => {
    const number = generateReportNumber();
    expect(number).toMatch(/^RPT-\d{4}-[0-9A-F]{8}$/);
  });

  it("is not the same on successive calls", () => {
    expect(generateReportNumber()).not.toBe(generateReportNumber());
  });
});

describe("isReportEditable", () => {
  it("is editable in draft-like and amended states", () => {
    for (const status of ["DRAFT", "IN_PROGRESS", "REVIEW_REQUIRED", "READY_FOR_REVIEW", "AMENDED"] as const) {
      expect(isReportEditable(status)).toBe(true);
    }
  });

  it("is locked once finalized, delivered, or archived", () => {
    for (const status of ["FINALIZED", "DELIVERED", "ARCHIVED"] as const) {
      expect(isReportEditable(status)).toBe(false);
    }
  });
});

describe("syncReportSummary", () => {
  it("creates a summary item per included finding, grouped by category label", async () => {
    const tx = createMockPrisma();
    tx.finding.findMany.mockResolvedValue([
      { id: "f1", category: { label: "Safety Concern" } },
      { id: "f2", category: { label: "Repair Recommended" } },
    ]);
    tx.reportSummaryItem.findMany.mockResolvedValue([]);

    await syncReportSummary(tx as never, "report-1");

    expect(tx.reportSummaryItem.create).toHaveBeenCalledWith({
      data: { reportId: "report-1", findingId: "f1", groupLabel: "Safety Concern", displayOrder: 0 },
    });
    expect(tx.reportSummaryItem.create).toHaveBeenCalledWith({
      data: { reportId: "report-1", findingId: "f2", groupLabel: "Repair Recommended", displayOrder: 1 },
    });
  });

  it("falls back to 'Other' when a finding has no category", async () => {
    const tx = createMockPrisma();
    tx.finding.findMany.mockResolvedValue([{ id: "f1", category: null }]);
    tx.reportSummaryItem.findMany.mockResolvedValue([]);

    await syncReportSummary(tx as never, "report-1");

    expect(tx.reportSummaryItem.create).toHaveBeenCalledWith({
      data: { reportId: "report-1", findingId: "f1", groupLabel: "Other", displayOrder: 0 },
    });
  });

  it("removes summary items for findings no longer included (idempotent reconciliation)", async () => {
    const tx = createMockPrisma();
    tx.finding.findMany.mockResolvedValue([]); // nothing currently marked includedInSummary
    tx.reportSummaryItem.findMany.mockResolvedValue([{ id: "item-1", findingId: "f-stale", groupLabel: "Other" }]);

    await syncReportSummary(tx as never, "report-1");

    expect(tx.reportSummaryItem.deleteMany).toHaveBeenCalledWith({ where: { id: { in: ["item-1"] } } });
    expect(tx.reportSummaryItem.create).not.toHaveBeenCalled();
  });

  it("updates the group label in place when a finding's category changes, without recreating the row", async () => {
    const tx = createMockPrisma();
    tx.finding.findMany.mockResolvedValue([{ id: "f1", category: { label: "Monitor" } }]);
    tx.reportSummaryItem.findMany.mockResolvedValue([
      { id: "item-1", findingId: "f1", groupLabel: "Repair Recommended", displayOrder: 0 },
    ]);

    await syncReportSummary(tx as never, "report-1");

    expect(tx.reportSummaryItem.update).toHaveBeenCalledWith({
      where: { id: "item-1" },
      data: { groupLabel: "Monitor", displayOrder: 0 },
    });
    expect(tx.reportSummaryItem.create).not.toHaveBeenCalled();
  });
});
