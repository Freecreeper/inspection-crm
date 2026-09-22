import { NextResponse } from "next/server";
import { readFile } from "node:fs/promises";
import path from "node:path";
import { auth } from "@/lib/auth";
import { prisma } from "@/lib/prisma";

const UPLOAD_ROOT = path.join(process.cwd(), "storage", "uploads");

// Staff-only download path — documents are internal transaction records, not
// customer-facing deliverables, so a plain session check is enough (unlike
// report delivery, which uses its own signed-token path for external
// recipients; see ReportDelivery).
export async function GET(_req: Request, { params }: { params: Promise<{ id: string }> }) {
  const session = await auth();
  if (!session?.user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

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
      "Content-Disposition": `attachment; filename="${document.title.replace(/"/g, "")}"`,
    },
  });
}
