import path from "node:path";

// PR #1 review item 7 — document upload/download hardening.

export const MAX_UPLOAD_BYTES = 10 * 1024 * 1024; // 10MB; matches next.config.ts serverActions.bodySizeLimit

// Extension is checked alongside MIME type because a browser's reported
// Content-Type is client-supplied and easy to spoof; requiring both to agree
// narrows (without eliminating) that gap.
export const ALLOWED_UPLOADS: Record<string, string[]> = {
  "application/pdf": [".pdf"],
  "image/jpeg": [".jpg", ".jpeg"],
  "image/png": [".png"],
  "image/heic": [".heic"],
  "image/webp": [".webp"],
  "application/msword": [".doc"],
  "application/vnd.openxmlformats-officedocument.wordprocessingml.document": [".docx"],
  "application/vnd.ms-excel": [".xls"],
  "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet": [".xlsx"],
  "text/plain": [".txt"],
};

export interface UploadValidationResult {
  ok: boolean;
  error?: string;
}

export function validateUpload(file: File): UploadValidationResult {
  if (file.size === 0) return { ok: false, error: "The file is empty." };
  if (file.size > MAX_UPLOAD_BYTES) {
    return { ok: false, error: `File exceeds the ${MAX_UPLOAD_BYTES / (1024 * 1024)}MB limit.` };
  }

  const extension = path.extname(file.name).toLowerCase();
  const allowedExtensions = ALLOWED_UPLOADS[file.type];
  if (!allowedExtensions || !allowedExtensions.includes(extension)) {
    return { ok: false, error: `File type "${file.type || "unknown"}" (${extension || "no extension"}) is not allowed.` };
  }

  return { ok: true };
}

// Strips everything but a safe, portable character set so the stored file
// name can never be used to traverse or escape the per-transaction upload
// directory, regardless of what the browser sent.
export function safeFileName(originalName: string): string {
  const base = path.basename(originalName);
  return base.replace(/[^a-zA-Z0-9._-]/g, "_") || "upload";
}

// RFC 5987-encoded Content-Disposition — plain quoted filenames break (or
// worse, allow header injection) on names with quotes, control characters,
// or non-ASCII text. filename= stays as an ASCII fallback for older clients;
// filename*= carries the accurate, percent-encoded value.
export function contentDispositionHeader(title: string): string {
  const asciiFallback = title.replace(/[^\x20-\x7E]/g, "_").replace(/["\\]/g, "_");
  const encoded = encodeURIComponent(title);
  return `attachment; filename="${asciiFallback}"; filename*=UTF-8''${encoded}`;
}

// No scanner is wired up yet — this is the integration point for one
// (ClamAV, a cloud provider's file-scanning API, etc.) once the business
// picks one. Never presented as having actually screened anything.
export async function scanForMalware(_buffer: Buffer): Promise<{ clean: true }> {
  return { clean: true };
}
