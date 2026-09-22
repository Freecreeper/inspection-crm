import { NextResponse } from "next/server";
import { readFile } from "node:fs/promises";
import path from "node:path";
import { auth } from "@/lib/auth";
import { assertCan, ForbiddenError } from "@/lib/rbac";
import { prisma } from "@/lib/prisma";
import type { Role } from "@prisma/client";

const MEDIA_ROOT = path.join(process.cwd(), "storage", "media");

// Staff-only, same pattern as /api/documents/[id] — inline display (not
// forced download) is safe here specifically because uploads are restricted
// to raster image MIME types only (src/lib/media.ts), never svg/html, so
// nothing served this way can execute as this origin.
export async function GET(_req: Request, { params }: { params: Promise<{ id: string }> }) {
  const session = await auth();
  if (!session?.user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  try {
    assertCan(session.user.role as Role | undefined, "media:read");
  } catch (err) {
    if (err instanceof ForbiddenError) return NextResponse.json({ error: "Forbidden" }, { status: 403 });
    throw err;
  }

  const { id } = await params;
  const media = await prisma.media.findUnique({ where: { id } });
  if (!media) return NextResponse.json({ error: "Not found" }, { status: 404 });

  const resolved = path.resolve(MEDIA_ROOT, media.storageKey);
  if (!resolved.startsWith(MEDIA_ROOT + path.sep)) {
    return NextResponse.json({ error: "Not found" }, { status: 404 });
  }

  const bytes = await readFile(resolved).catch(() => null);
  if (!bytes) return NextResponse.json({ error: "File missing from storage" }, { status: 404 });

  return new NextResponse(new Uint8Array(bytes), {
    headers: {
      "Content-Type": media.fileType || "application/octet-stream",
      "Content-Disposition": "inline",
      "X-Content-Type-Options": "nosniff",
      "Cache-Control": "private, max-age=3600",
    },
  });
}
