import { renderToBuffer, type DocumentProps } from "@react-pdf/renderer";
import { readFile } from "node:fs/promises";
import path from "node:path";
import { createElement, type ReactElement } from "react";
import type { Media } from "@prisma/client";
import type { ReportSnapshot } from "@/lib/reportEngine";
import { ReportDocument, type FindingPhoto } from "./ReportDocument";

const MEDIA_ROOT = path.join(process.cwd(), "storage", "media");

function extensionToMimeType(ext: string): string {
  switch (ext.toLowerCase()) {
    case ".png":
      return "image/png";
    case ".webp":
      return "image/webp";
    case ".heic":
      return "image/heic";
    default:
      return "image/jpeg";
  }
}

// Photos are embedded as data URIs rather than referenced by local path or
// HTTP URL — @react-pdf/renderer renders server-side with no guarantee the
// dev/prod server is reachable from wherever rendering happens, and a data
// URI keeps the finished PDF self-contained.
export async function renderReportPdf(snapshot: ReportSnapshot, media: Media[]): Promise<Buffer> {
  const keyByFindingId = new Map<string, string>();
  snapshot.sections.forEach((section, sIdx) => {
    section.components.forEach((component, cIdx) => {
      component.findings.forEach((finding, fIdx) => {
        keyByFindingId.set(finding.id, `${sIdx}-${cIdx}-${fIdx}`);
      });
    });
  });

  const photosByFinding = new Map<string, FindingPhoto[]>();
  for (const item of media) {
    if (!item.findingId || !item.includeInReport) continue;
    const key = keyByFindingId.get(item.findingId);
    if (!key) continue;

    // Skip (don't fail the whole PDF) if a photo went missing from disk —
    // finalization already happened by the time this runs; a report should
    // still generate with the photos that are actually present.
    const bytes = await readFile(path.join(MEDIA_ROOT, item.storageKey)).catch(() => null);
    if (!bytes) continue;

    const mimeType = /\.(png|webp|heic)$/i.test(item.storageKey) ? extensionToMimeType(path.extname(item.storageKey)) : "image/jpeg";
    const dataUri = `data:${mimeType};base64,${bytes.toString("base64")}`;
    const list = photosByFinding.get(key) ?? [];
    list.push({ findingKey: key, dataUri, caption: item.caption });
    photosByFinding.set(key, list);
  }

  // renderToBuffer's types want a ReactElement<DocumentProps> specifically
  // (i.e. a <Document> element), but the common @react-pdf/renderer pattern
  // of wrapping <Document> in your own component — ReportDocument here —
  // doesn't satisfy that at the type level even though it's exactly what
  // the library expects at runtime. The cast is narrow and only bridges
  // that known friction point, not a general escape hatch.
  const element = createElement(ReportDocument, { snapshot, photosByFinding }) as unknown as ReactElement<DocumentProps>;
  return renderToBuffer(element);
}
