import { describe, it, expect, vi, beforeEach } from "vitest";

vi.mock("@/lib/prisma", async () => {
  const { createMockPrisma } = await import("@/test-utils/mockPrisma");
  return { prisma: createMockPrisma() };
});
vi.mock("@/lib/auth", () => ({ auth: vi.fn(async () => ({ user: { id: "u-insp", role: "OWNER_ADMIN" } })) }));
vi.mock("next/cache", () => ({ revalidatePath: vi.fn() }));
vi.mock("next/navigation", () => ({
  redirect: vi.fn((to: string) => {
    throw new Error(`REDIRECT ${to}`);
  }),
}));
vi.mock("next/headers", () => ({ cookies: vi.fn(async () => ({ set: vi.fn() })) }));
vi.mock("@/lib/pdf/renderReportPdf", () => ({ renderReportPdf: vi.fn() }));
vi.mock("node:fs/promises", () => ({ mkdir: vi.fn(async () => {}), writeFile: vi.fn(async () => {}), unlink: vi.fn(async () => {}) }));
vi.mock("@/lib/email/automations/registry", () => ({ getAutomation: vi.fn(async () => ({ active: true })) }));
vi.mock("@/lib/email/automations/report", () => ({ onReportDeliveryCreated: vi.fn(async () => {}) }));

import { revalidatePath } from "next/cache";
import { prisma } from "@/lib/prisma";
import { createDelivery, createFinding, createReportFromTemplate, deleteFinding, updateFinding } from "./report-actions";
import { onReportDeliveryCreated } from "@/lib/email/automations/report";

type Fn = ReturnType<typeof vi.fn>;
const db = prisma as unknown as Record<string, Record<string, Fn>> & { $queryRaw: Fn; $executeRaw: Fn };

const lockedReport = (status: string) => db.$queryRaw.mockResolvedValue([{ status, inspectionId: "insp-1" }]);
const form = (fields: Record<string, string>) => {
  const f = new FormData();
  for (const [k, v] of Object.entries(fields)) f.set(k, v);
  return f;
};

beforeEach(() => {
  vi.clearAllMocks();
  db.$executeRaw.mockResolvedValue(1);
  db.finding.findUnique.mockResolvedValue({ component: { section: { reportId: "rep-1" } } });
  db.reportComponent.findUnique.mockResolvedValue({ section: { reportId: "rep-1" } });
});

describe("finalized reports can't be edited, even by a direct request", () => {
  it("content actions refuse a FINALIZED or DELIVERED report (the UI-only lock is now on the server)", async () => {
    for (const status of ["FINALIZED", "DELIVERED"]) {
      lockedReport(status);
      await expect(updateFinding("f1", form({ title: "t", description: "d" }))).rejects.toThrow("This report is not open for editing.");
      await expect(createFinding("c1", form({ title: "t", description: "d" }))).rejects.toThrow("not open for editing");
      await expect(deleteFinding("f1")).rejects.toThrow("not open for editing");
    }
    expect(db.finding.update).not.toHaveBeenCalled();
    expect(db.finding.create).not.toHaveBeenCalled();
    expect(db.finding.deleteMany).not.toHaveBeenCalled();
  });

  it("an editable report saves and refreshes the editor (saves show without a reload)", async () => {
    lockedReport("IN_PROGRESS");
    db.finding.update.mockResolvedValue({});
    await updateFinding("f1", form({ title: "Loose handrail", description: "Wobbles" }));
    expect(db.finding.update).toHaveBeenCalled();
    expect(revalidatePath).toHaveBeenCalledWith("/inspections/insp-1/report", "layout");
  });
});

describe("double submits", () => {
  it("a second identical 'Add finding' moments later is ignored", async () => {
    lockedReport("IN_PROGRESS");
    db.finding.findFirst.mockResolvedValueOnce(null).mockResolvedValueOnce({ id: "f-first" });
    await createFinding("c1", form({ title: "Loose handrail", description: "Wobbles" }));
    await createFinding("c1", form({ title: "Loose handrail", description: "Wobbles" }));
    expect(db.finding.create).toHaveBeenCalledTimes(1);
  });

  it("deleting a finding removes its summary entry and photos, and a second tap is a no-op", async () => {
    lockedReport("AMENDED");
    db.media.findMany.mockResolvedValue([{ storageKey: "insp-1/a.jpg" }]);
    await deleteFinding("f1");
    expect(db.reportSummaryItem.deleteMany).toHaveBeenCalledWith({ where: { findingId: "f1" } });
    expect(db.media.deleteMany).toHaveBeenCalledWith({ where: { findingId: "f1" } });
    expect(db.finding.deleteMany).toHaveBeenCalledWith({ where: { id: "f1" } });

    db.finding.findUnique.mockResolvedValue(null); // already gone
    await expect(deleteFinding("f1")).resolves.toBeUndefined();
  });

  it("'Start report' twice opens the existing report instead of creating a second one", async () => {
    db.reportTemplate.findUniqueOrThrow.mockResolvedValue({ sections: [] });
    db.inspectionReport.findFirst.mockResolvedValue({ id: "rep-1" });
    await expect(createReportFromTemplate("insp-1", form({ templateId: "t1" }))).rejects.toThrow("REDIRECT /inspections/insp-1/report");
    expect(db.inspectionReport.create).not.toHaveBeenCalled();
    expect(db.$executeRaw).toHaveBeenCalled(); // took the per-inspection lock
  });

  it("a repeated Deliver reuses the delivery from moments ago: one delivery, one email", async () => {
    db.inspectionReport.findUnique.mockResolvedValue({ status: "FINALIZED", inspectionId: "insp-1" });
    db.reportVersion.findFirst.mockResolvedValue({ id: "v1" });
    db.reportDelivery.findFirst.mockResolvedValueOnce(null).mockResolvedValueOnce({ id: "del-1" });
    db.reportDelivery.create.mockResolvedValue({ id: "del-1" });
    const deliver = () => createDelivery("rep-1", form({ recipientType: "CUSTOMER", recipientName: "Ava", recipientEmail: "Ava@Example.com", sendEmail: "1" }));
    await expect(deliver()).rejects.toThrow("REDIRECT");
    await expect(deliver()).rejects.toThrow("REDIRECT");
    expect(db.reportDelivery.create).toHaveBeenCalledTimes(1);
    expect(onReportDeliveryCreated).toHaveBeenCalledTimes(1);
    // The repeat check and the insert run under one per-report lock.
    expect(db.reportDelivery.findFirst.mock.calls[0][0].where).toMatchObject({ recipientEmail: { equals: "Ava@Example.com", mode: "insensitive" }, deliveryMethod: "email", status: { not: "FAILED" } });
  });

  it("delivering is blocked while an amendment is open", async () => {
    db.inspectionReport.findUnique.mockResolvedValue({ status: "AMENDED", inspectionId: "insp-1" });
    await expect(createDelivery("rep-1", form({ recipientType: "CUSTOMER", recipientName: "Ava", recipientEmail: "a@b.co" }))).rejects.toThrow("being amended");
    expect(db.reportDelivery.create).not.toHaveBeenCalled();
  });
});
