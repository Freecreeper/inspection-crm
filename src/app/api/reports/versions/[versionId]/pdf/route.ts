import { NextResponse } from "next/server";
import { readFile } from "node:fs/promises";
import path from "node:path";
import { auth } from "@/lib/auth";
import { assertCan, ForbiddenError } from "@/lib/rbac";
import { contentDispositionHeader } from "@/lib/documents";
import { prisma } from "@/lib/prisma";
import type { Role } from "@prisma/client";

const UPLOAD_ROOT = path.join(process.cwd(), "storage", "uploads");

// Staff-side download — the customer-facing equivalent is the signed-token
// route at /r/[token]/pdf, which doesn't go through staff auth at all.
export async function GET(_req: Request, { params }: { params: Promise<{ versionId: string }> }) {
  const session = await auth();
  if (!session?.user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  try {
    assertCan(session.user.role as Role | undefined, "document:read");
  } catch (err) {
    if (err instanceof ForbiddenError) return NextResponse.json({ error: "Forbidden" }, { status: 403 });
    throw err;
  }

  const { versionId } = await params;
  const version = await prisma.reportVersion.findUnique({ where: { id: versionId }, include: { report: true } });
  if (!version || !version.pdfStorageKey) return NextResponse.json({ error: "Not found" }, { status: 404 });

  const resolved = path.resolve(UPLOAD_ROOT, version.pdfStorageKey);
  if (!resolved.startsWith(UPLOAD_ROOT + path.sep)) {
    return NextResponse.json({ error: "Not found" }, { status: 404 });
  }

  const bytes = await readFile(resolved).catch(() => null);
  if (!bytes) return NextResponse.json({ error: "File missing from storage" }, { status: 404 });

  return new NextResponse(new Uint8Array(bytes), {
    headers: {
      "Content-Type": "application/pdf",
      "Content-Disposition": contentDispositionHeader(`${version.report.reportNumber}-v${version.versionNumber}.pdf`),
      "X-Content-Type-Options": "nosniff",
    },
  });
}
