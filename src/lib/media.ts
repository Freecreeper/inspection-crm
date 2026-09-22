import path from "node:path";
import { safeFileName, contentDispositionHeader } from "@/lib/documents";

// Photo/media hardening for the inspection report engine (Pillar 3) — mirrors
// src/lib/documents.ts's upload hardening (PR #1 review item 7), narrowed to
// the raster image formats a phone or camera actually produces. Unlike
// documents, media is served inline (a report preview embeds <img> tags), so
// the type allow-list matters even more: nothing here can ever be
// text/html/svg, which would execute as this origin if rendered inline.
export const MAX_MEDIA_BYTES = 15 * 1024 * 1024; // 15MB; matches next.config.ts serverActions.bodySizeLimit

export const ALLOWED_MEDIA: Record<string, string[]> = {
  "image/jpeg": [".jpg", ".jpeg"],
  "image/png": [".png"],
  "image/webp": [".webp"],
  "image/heic": [".heic"],
};

export interface UploadValidationResult {
  ok: boolean;
  error?: string;
}

export function validateMediaUpload(file: File): UploadValidationResult {
  if (file.size === 0) return { ok: false, error: "The file is empty." };
  if (file.size > MAX_MEDIA_BYTES) {
    return { ok: false, error: `File exceeds the ${MAX_MEDIA_BYTES / (1024 * 1024)}MB limit.` };
  }

  const extension = path.extname(file.name).toLowerCase();
  const allowedExtensions = ALLOWED_MEDIA[file.type];
  if (!allowedExtensions || !allowedExtensions.includes(extension)) {
    return { ok: false, error: `File type "${file.type || "unknown"}" (${extension || "no extension"}) is not a supported photo format.` };
  }

  return { ok: true };
}

export { safeFileName, contentDispositionHeader };
