import { describe, it, expect, vi, beforeEach } from "vitest";

vi.mock("@/lib/prisma", async () => {
  const { createMockPrisma } = await import("@/test-utils/mockPrisma");
  return { prisma: createMockPrisma() };
});
vi.mock("@/lib/auth", () => ({ auth: vi.fn() }));
vi.mock("node:fs/promises", () => ({ readFile: vi.fn() }));

import { prisma } from "@/lib/prisma";
import { auth } from "@/lib/auth";
import { readFile } from "node:fs/promises";
import { GET } from "./route";

const mockAuth = vi.mocked(auth);
const mockPrisma = prisma as unknown as { document: { findUnique: ReturnType<typeof vi.fn> } };
const mockReadFile = vi.mocked(readFile);

function params(id: string) {
  return { params: Promise.resolve({ id }) };
}

beforeEach(() => {
  vi.clearAllMocks();
});

describe("GET /api/documents/[id]", () => {
  it("401s with no session (authentication)", async () => {
    // See the identical cast in tasks/actions.test.ts — auth()'s overloaded
    // type confuses vi.mocked()'s inference for a bare `null`.
    mockAuth.mockResolvedValue(null as never);
    const res = await GET(new Request("http://localhost/api/documents/doc-1"), params("doc-1"));
    expect(res.status).toBe(401);
    expect(mockPrisma.document.findUnique).not.toHaveBeenCalled();
  });

  it("403s when the session's role isn't permitted (RBAC)", async () => {
    // A session missing a role entirely — assertCan/can treat this as denied,
    // the same path a role absent from the document:read list would take.
    mockAuth.mockResolvedValue({ user: {} } as never);
    const res = await GET(new Request("http://localhost/api/documents/doc-1"), params("doc-1"));
    expect(res.status).toBe(403);
  });

  it("404s when the document row doesn't exist", async () => {
    mockAuth.mockResolvedValue({ user: { role: "OFFICE_STAFF" } } as never);
    mockPrisma.document.findUnique.mockResolvedValue(null);
    const res = await GET(new Request("http://localhost/api/documents/doc-1"), params("doc-1"));
    expect(res.status).toBe(404);
  });

  it("404s instead of serving a path that escapes the upload root (traversal guard)", async () => {
    mockAuth.mockResolvedValue({ user: { role: "OFFICE_STAFF" } } as never);
    mockPrisma.document.findUnique.mockResolvedValue({
      id: "doc-1",
      title: "evil.txt",
      fileType: "text/plain",
      storageKey: "../../../../etc/passwd",
    });
    const res = await GET(new Request("http://localhost/api/documents/doc-1"), params("doc-1"));
    expect(res.status).toBe(404);
    expect(mockReadFile).not.toHaveBeenCalled();
  });

  it("streams the file back with a hardened Content-Disposition for an authorized request", async () => {
    mockAuth.mockResolvedValue({ user: { role: "OFFICE_STAFF" } } as never);
    mockPrisma.document.findUnique.mockResolvedValue({
      id: "doc-1",
      title: "Inspection Report.pdf",
      fileType: "application/pdf",
      storageKey: "txn-1/abc-inspection-report.pdf",
    });
    mockReadFile.mockResolvedValue(Buffer.from("pdf-bytes"));

    const res = await GET(new Request("http://localhost/api/documents/doc-1"), params("doc-1"));

    expect(res.status).toBe(200);
    expect(res.headers.get("Content-Type")).toBe("application/pdf");
    expect(res.headers.get("Content-Disposition")).toContain("attachment");
    expect(res.headers.get("Content-Disposition")).toContain("filename*=UTF-8''");
    expect(res.headers.get("X-Content-Type-Options")).toBe("nosniff");
  });
});
