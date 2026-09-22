import { describe, expect, it } from "vitest";
import { validateUpload, safeFileName, contentDispositionHeader, MAX_UPLOAD_BYTES } from "./documents";

function makeFile(name: string, type: string, sizeBytes = 10): File {
  return new File([new Uint8Array(sizeBytes)], name, { type });
}

describe("validateUpload", () => {
  it("rejects an empty file", () => {
    const result = validateUpload(makeFile("empty.pdf", "application/pdf", 0));
    expect(result.ok).toBe(false);
  });

  it("rejects a file over the size limit", () => {
    const result = validateUpload(makeFile("big.pdf", "application/pdf", MAX_UPLOAD_BYTES + 1));
    expect(result.ok).toBe(false);
    expect(result.error).toMatch(/exceeds/i);
  });

  it("rejects a disallowed MIME type", () => {
    const result = validateUpload(makeFile("script.exe", "application/x-msdownload"));
    expect(result.ok).toBe(false);
  });

  it("rejects a MIME type that doesn't match the extension", () => {
    // Content-Type is client-supplied and spoofable; a .pdf claiming to be an
    // image should be rejected because the declared type's own extension list
    // doesn't include .pdf.
    const result = validateUpload(makeFile("disguised.pdf", "image/png"));
    expect(result.ok).toBe(false);
  });

  it("accepts an allowed type/extension pair within the size limit", () => {
    const result = validateUpload(makeFile("inspection-notes.pdf", "application/pdf", 1024));
    expect(result.ok).toBe(true);
  });
});

describe("safeFileName", () => {
  it("strips characters outside the safe set", () => {
    expect(safeFileName("my report (final)!.pdf")).toBe("my_report__final__.pdf");
  });

  it("strips directory components so a path can't escape the upload dir", () => {
    expect(safeFileName("../../etc/passwd")).toBe("passwd");
  });

  it("falls back to a default name when there is nothing left to sanitize", () => {
    expect(safeFileName("")).toBe("upload");
  });
});

describe("contentDispositionHeader", () => {
  it("includes both an ASCII fallback and a UTF-8 encoded filename", () => {
    const header = contentDispositionHeader("Inspection Report.pdf");
    expect(header).toContain('filename="Inspection Report.pdf"');
    expect(header).toContain("filename*=UTF-8''Inspection%20Report.pdf");
  });

  it("neutralizes quotes and control characters instead of passing them through", () => {
    const header = contentDispositionHeader('evil".pdf\r\nX-Injected: true');
    expect(header).not.toContain('evil".pdf');
    expect(header).not.toContain("\r\n");
  });
});
