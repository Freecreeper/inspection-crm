import { NextResponse } from "next/server";
import { readFile } from "node:fs/promises";
import path from "node:path";
import { auth } from "@/lib/auth";
import { assertCan, ForbiddenError } from "@/lib/rbac";
import { contentDispositionHeader } from "@/lib/documents";
import { prisma } from "@/lib/prisma";
import type { Role } from "@prisma/client";

const UPLOAD_ROOT = path.join(process.cwd(), "storage", "uploads");

// Documents are internal transaction records, not customer-facing
// deliverables (report delivery uses its own signed-token path for external
// recipients — see ReportDelivery). Authorization goes through the
// document:read permission in rbac.ts rather than a bare session check (PR #1
// review item 7), so a future per-transaction/assignment restriction is a
// change to that one table, not a hunt through this route.
export async function GET(_req: Request, { params }: { params: Promise<{ id: string }> }) {
  const session = await auth();
  if (!session?.user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  try {
    assertCan(session.user.role as Role | undefined, "document:read");
  } catch (err) {
    if (err instanceof ForbiddenError) return NextResponse.json({ error: "Forbidden" }, { status: 403 });
    throw err;
  }

  const { id } = await params;
  const document = await prisma.document.findUnique({ where: { id } });
  if (!document) return NextResponse.json({ error: "Not found" }, { status: 404 });

  const resolved = path.resolve(UPLOAD_ROOT, document.storageKey);
  if (!resolved.startsWith(UPLOAD_ROOT + path.sep)) {
    return NextResponse.json({ error: "Not found" }, { status: 404 });
  }

  const bytes = await readFile(resolved).catch(() => null);
  if (!bytes) return NextResponse.json({ error: "File missing from storage" }, { status: 404 });

  return new NextResponse(new Uint8Array(bytes), {
    headers: {
      "Content-Type": document.fileType || "application/octet-stream",
      "Content-Disposition": contentDispositionHeader(document.title),
      // Always download, never let the browser render the payload inline —
      // an uploaded .html/.svg document could otherwise execute as this
      // origin. Paired with nosniff so the browser can't override the type.
      "X-Content-Type-Options": "nosniff",
    },
  });
}
