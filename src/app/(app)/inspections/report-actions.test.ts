import { describe, it, expect, vi, beforeEach } from "vitest";

vi.mock("@/lib/prisma", async () => {
  const { createMockPrisma } = await import("@/test-utils/mockPrisma");
  return { prisma: createMockPrisma() };
});
vi.mock("@/lib/auth", () => ({
  auth: vi.fn(async () => ({ user: { id: "staff-1", role: "OWNER_ADMIN" } })),
}));
vi.mock("next/navigation", () => ({ redirect: vi.fn() }));
vi.mock("next/cache", () => ({ revalidatePath: vi.fn() }));
vi.mock("next/headers", () => ({ cookies: vi.fn(async () => ({ set: vi.fn(), get: vi.fn() })) }));
vi.mock("@/lib/pdf/renderReportPdf", () => ({ renderReportPdf: vi.fn(async () => Buffer.from("pdf")) }));
vi.mock("node:fs/promises", () => ({ mkdir: vi.fn(), writeFile: vi.fn(), unlink: vi.fn() }));

import { prisma } from "@/lib/prisma";
import { finalizeReport, amendReport } from "./report-actions";

const mockPrisma = prisma as unknown as {
  inspectionReport: { findUniqueOrThrow: ReturnType<typeof vi.fn>; update: ReturnType<typeof vi.fn> };
  media: { findMany: ReturnType<typeof vi.fn> };
  reportSummaryItem: { findMany: ReturnType<typeof vi.fn> };
  finding: { findMany: ReturnType<typeof vi.fn> };
  reportVersion: { create: ReturnType<typeof vi.fn>; update: ReturnType<typeof vi.fn>; deleteMany: ReturnType<typeof vi.fn> };
};

function makeReport(overrides: { versions?: unknown[]; property?: Record<string, unknown> } = {}) {
  return {
    id: "report-1",
    inspectionId: "inspection-1",
    reportNumber: "RPT-2026-AAAAAAAA",
    status: "DRAFT",
    title: null,
    introduction: null,
    scope: null,
    limitations: null,
    footer: null,
    customerFacingNotes: null,
    inspection: {
      property: overrides.property ?? {
        addressLine1: "123 Original St",
        addressLine2: null,
        city: "Springfield",
        state: "IL",
        zip: "62704",
        yearBuilt: null,
        squareFootage: 2200,
      },
      inspector: null,
      completedAt: null,
      scheduledAt: null,
      transaction: { customers: [], realtors: [] },
    },
    sections: [],
    versions: overrides.versions ?? [],
  };
}

describe("finalizeReport — version immutability", () => {
  beforeEach(() => vi.clearAllMocks());

  it("creates a new ReportVersion via `create`, never `update`, on first finalize", async () => {
    mockPrisma.inspectionReport.findUniqueOrThrow.mockResolvedValue(makeReport());
    mockPrisma.media.findMany.mockResolvedValue([]);
    mockPrisma.reportSummaryItem.findMany.mockResolvedValue([]);
    mockPrisma.finding.findMany.mockResolvedValue([]);

    await finalizeReport("report-1", new FormData());

    expect(mockPrisma.reportVersion.create).toHaveBeenCalledTimes(1);
    expect(mockPrisma.reportVersion.update).not.toHaveBeenCalled();
    const created = mockPrisma.reportVersion.create.mock.calls[0][0];
    expect(created.data.versionNumber).toBe(1);
    expect(created.data.snapshot.property.addressLine1).toBe("123 Original St");
  });

  it("finalizing again after a live Property edit creates version 2 without ever updating version 1's row", async () => {
    // Version 1, finalized while the property still had its original address.
    mockPrisma.inspectionReport.findUniqueOrThrow.mockResolvedValueOnce(makeReport());
    mockPrisma.media.findMany.mockResolvedValue([]);
    mockPrisma.reportSummaryItem.findMany.mockResolvedValue([]);
    mockPrisma.finding.findMany.mockResolvedValue([]);
    await finalizeReport("report-1", new FormData());
    const v1Snapshot = mockPrisma.reportVersion.create.mock.calls[0][0].data.snapshot;

    // The Property is edited live, the report is amended, then finalized again.
    mockPrisma.inspectionReport.findUniqueOrThrow.mockResolvedValueOnce(
      makeReport({
        versions: [{ id: "v1" }],
        property: {
          addressLine1: "456 New St",
          addressLine2: null,
          city: "Springfield",
          state: "IL",
          zip: "62704",
          yearBuilt: null,
          squareFootage: 2200,
        },
      })
    );
    await finalizeReport("report-1", new FormData());

    expect(mockPrisma.reportVersion.create).toHaveBeenCalledTimes(2);
    expect(mockPrisma.reportVersion.update).not.toHaveBeenCalled();

    const v2Call = mockPrisma.reportVersion.create.mock.calls[1][0];
    expect(v2Call.data.versionNumber).toBe(2);
    expect(v2Call.data.snapshot.property.addressLine1).toBe("456 New St");

    // Version 1's already-persisted snapshot object is untouched by anything
    // that happened while building version 2 — the exact "Version 1 can never
    // silently change after Version 2 is created" invariant.
    expect(v1Snapshot.property.addressLine1).toBe("123 Original St");
  });
});

describe("amendReport — never mutates a ReportVersion", () => {
  beforeEach(() => vi.clearAllMocks());

  it("only flips the report's status; no ReportVersion is created, updated, or deleted", async () => {
    mockPrisma.inspectionReport.findUniqueOrThrow.mockResolvedValue({
      id: "report-1",
      inspectionId: "inspection-1",
      status: "FINALIZED",
    });

    await amendReport("report-1");

    expect(mockPrisma.inspectionReport.update).toHaveBeenCalledWith({
      where: { id: "report-1" },
      data: { status: "AMENDED" },
    });
    expect(mockPrisma.reportVersion.create).not.toHaveBeenCalled();
    expect(mockPrisma.reportVersion.update).not.toHaveBeenCalled();
    expect(mockPrisma.reportVersion.deleteMany).not.toHaveBeenCalled();
  });

  it("refuses to reopen a report that was never finalized", async () => {
    mockPrisma.inspectionReport.findUniqueOrThrow.mockResolvedValue({
      id: "report-1",
      inspectionId: "inspection-1",
      status: "DRAFT",
    });

    await expect(amendReport("report-1")).rejects.toThrow(/finalized or delivered/i);
    expect(mockPrisma.inspectionReport.update).not.toHaveBeenCalled();
  });
});
