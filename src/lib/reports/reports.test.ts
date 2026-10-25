import { describe, it, expect, vi, beforeEach } from "vitest";

vi.mock("@/lib/prisma", async () => {
  const { createMockPrisma } = await import("@/test-utils/mockPrisma");
  return { prisma: createMockPrisma() };
});
vi.mock("@/lib/auth", () => ({ auth: vi.fn() }));
vi.mock("next/cache", () => ({ revalidatePath: vi.fn() }));
vi.mock("next/navigation", () => ({
  notFound: vi.fn(() => {
    throw new Error("NEXT_NOT_FOUND");
  }),
  redirect: vi.fn(),
}));

import { prisma } from "@/lib/prisma";
import { auth } from "@/lib/auth";
import { canSeeSavedReport, requireReportAccess } from "./access";
import { csvCell, toCsv } from "./csv";
import { deleteSavedReport } from "@/app/(app)/reports/actions";

type Fn = ReturnType<typeof vi.fn>;
const db = prisma as unknown as Record<string, Record<string, Fn>>;
const as = (role: string, id = "u1") => vi.mocked(auth).mockResolvedValue({ user: { id, role } } as never);

beforeEach(() => vi.clearAllMocks());

describe("report access", () => {
  it("roles without report-builder:use get a 404 on every Reports page", async () => {
    as("INSPECTOR");
    await expect(requireReportAccess()).rejects.toThrow("NEXT_NOT_FOUND");
    as("REPORTING_ANALYST");
    await expect(requireReportAccess()).resolves.toEqual({ userId: "u1", role: "REPORTING_ANALYST" });
  });

  it("a private saved report is visible only to its owner", () => {
    expect(canSeeSavedReport({ ownerId: "u1", shared: false }, "u1")).toBe(true);
    expect(canSeeSavedReport({ ownerId: "u1", shared: false }, "u2")).toBe(false);
    expect(canSeeSavedReport({ ownerId: "u1", shared: true }, "u2")).toBe(true);
  });

  it("only the owner can delete a saved report", async () => {
    as("OFFICE_STAFF", "u2");
    db.reportDefinition.deleteMany.mockResolvedValue({ count: 0 });
    await expect(deleteSavedReport("r1")).rejects.toThrow("Report not found.");
    expect(db.reportDefinition.deleteMany).toHaveBeenCalledWith({ where: { id: "r1", ownerId: "u2" } });
    expect(db.reportDefinition.delete).not.toHaveBeenCalled();
  });
});

describe("CSV export", () => {
  it("neutralises spreadsheet formulas and quotes cells", () => {
    for (const evil of ["=HYPERLINK(\"http://x\")", "+1+1", "-2+3", "@SUM(A1)", "\tx", "\rx"]) expect(csvCell(evil).startsWith(`"'`), evil).toBe(true);
    expect(csvCell('He said "hi"')).toBe('"He said ""hi"""');
    expect(csvCell(null)).toBe("");
  });

  it("is RFC 4180 (CRLF) with a UTF-8 BOM for Excel", () => {
    const csv = toCsv([{ name: "José", city: "Hickory" }]);
    expect(csv.startsWith("﻿")).toBe(true);
    expect(csv.slice(1)).toBe('"name","city"\r\n"José","Hickory"');
  });
});
