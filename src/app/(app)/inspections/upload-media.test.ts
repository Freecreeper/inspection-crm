import { describe, it, expect, vi, beforeEach } from "vitest";

vi.mock("@/lib/prisma", async () => {
  const { createMockPrisma } = await import("@/test-utils/mockPrisma");
  return { prisma: createMockPrisma() };
});
vi.mock("@/lib/auth", () => ({ auth: vi.fn(async () => ({ user: { id: "u-insp", role: "INSPECTOR" } })) }));
vi.mock("next/cache", () => ({ revalidatePath: vi.fn() }));
vi.mock("next/navigation", () => ({ redirect: vi.fn() }));
vi.mock("next/headers", () => ({ cookies: vi.fn() }));
vi.mock("@/lib/pdf/renderReportPdf", () => ({ renderReportPdf: vi.fn() }));
vi.mock("node:fs/promises", () => ({ mkdir: vi.fn(async () => {}), writeFile: vi.fn(async () => {}), unlink: vi.fn(async () => {}) }));

import path from "node:path";
import { mkdir, writeFile, unlink } from "node:fs/promises";
import { prisma } from "@/lib/prisma";
import { uploadMedia } from "./report-actions";

type Fn = ReturnType<typeof vi.fn>;
const db = prisma as unknown as Record<string, Record<string, Fn>>;
const MEDIA_ROOT = path.join(process.cwd(), "storage", "media");

function photo() {
  const f = new FormData();
  f.set("file", new File([new Uint8Array([0xff, 0xd8, 0xff, 0xe0])], "deck.jpg", { type: "image/jpeg" }));
  return f;
}
const finding = (inspectionId: string, status = "IN_PROGRESS") => ({ component: { section: { report: { inspectionId, status } } } });

beforeEach(() => vi.clearAllMocks());

describe("uploadMedia (path traversal)", () => {
  it("refuses an inspection id that isn't the finding's own — before touching the disk", async () => {
    db.finding.findUnique.mockResolvedValue(finding("insp-1"));
    for (const forged of ["../../../tmp/x", "insp-2", "/etc"]) {
      await expect(uploadMedia(forged, "f1", photo())).rejects.toThrow("That finding isn't part of this inspection.");
    }
    db.finding.findUnique.mockResolvedValue(null);
    await expect(uploadMedia("insp-1", "nope", photo())).rejects.toThrow();
    expect(mkdir).not.toHaveBeenCalled();
    expect(writeFile).not.toHaveBeenCalled();
  });

  it("refuses uploads to a finalized report", async () => {
    db.finding.findUnique.mockResolvedValue(finding("insp-1", "FINALIZED"));
    await expect(uploadMedia("insp-1", "f1", photo())).rejects.toThrow("not open for editing");
    expect(writeFile).not.toHaveBeenCalled();
  });

  it("writes under storage/media/<inspection>/ and removes the file if the record can't be saved", async () => {
    db.finding.findUnique.mockResolvedValue(finding("insp-1"));
    db.media.create.mockRejectedValue(new Error("db down"));
    await expect(uploadMedia("insp-1", "f1", photo())).rejects.toThrow("db down");
    const written = String(vi.mocked(writeFile).mock.calls[0][0]);
    expect(written.startsWith(path.join(MEDIA_ROOT, "insp-1") + path.sep)).toBe(true);
    expect(unlink).toHaveBeenCalledWith(written);
  });
});
