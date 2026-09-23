import { NextResponse } from "next/server";
import { readFile } from "node:fs/promises";
import path from "node:path";
import { resolveDeliveryByToken, markDeliveryViewed } from "@/lib/delivery";
import { contentDispositionHeader } from "@/lib/documents";
import type { ReportSnapshot } from "@/lib/reportEngine";

const UPLOAD_ROOT = path.join(process.cwd(), "storage", "uploads");

export async function GET(_req: Request, { params }: { params: Promise<{ token: string }> }) {
  const { token } = await params;
  const delivery = await resolveDeliveryByToken(token);
  if (!delivery) return NextResponse.json({ error: "Not found or expired" }, { status: 404 });
  if (!delivery.version.pdfStorageKey) return NextResponse.json({ error: "Not found" }, { status: 404 });

  const resolved = path.resolve(UPLOAD_ROOT, delivery.version.pdfStorageKey);
  if (!resolved.startsWith(UPLOAD_ROOT + path.sep)) {
    return NextResponse.json({ error: "Not found" }, { status: 404 });
  }

  const bytes = await readFile(resolved).catch(() => null);
  if (!bytes) return NextResponse.json({ error: "File missing from storage" }, { status: 404 });

  await markDeliveryViewed(delivery.id);

  // File name from the version's own snapshot, not the live report record —
  // consistent with the rest of this public path (see resolveDeliveryByToken).
  const snapshot = delivery.version.snapshot as unknown as ReportSnapshot;

  return new NextResponse(new Uint8Array(bytes), {
    headers: {
      "Content-Type": "application/pdf",
      "Content-Disposition": contentDispositionHeader(`${snapshot.reportNumber}.pdf`),
      "X-Content-Type-Options": "nosniff",
    },
  });
}
