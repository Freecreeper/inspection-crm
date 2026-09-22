import { describe, it, expect } from "vitest";
import { validateMediaUpload, MAX_MEDIA_BYTES } from "./media";

function makeFile(name: string, type: string, sizeBytes = 10): File {
  return new File([new Uint8Array(sizeBytes)], name, { type });
}

describe("validateMediaUpload", () => {
  it("rejects an empty file", () => {
    expect(validateMediaUpload(makeFile("photo.jpg", "image/jpeg", 0)).ok).toBe(false);
  });

  it("rejects a file over the size limit", () => {
    const result = validateMediaUpload(makeFile("photo.jpg", "image/jpeg", MAX_MEDIA_BYTES + 1));
    expect(result.ok).toBe(false);
    expect(result.error).toMatch(/exceeds/i);
  });

  it("rejects non-image types even if otherwise well-formed (e.g. a PDF)", () => {
    expect(validateMediaUpload(makeFile("report.pdf", "application/pdf", 1024)).ok).toBe(false);
  });

  it("rejects svg specifically — inline rendering makes it an XSS vector, not just 'not a photo'", () => {
    expect(validateMediaUpload(makeFile("logo.svg", "image/svg+xml", 1024)).ok).toBe(false);
  });

  it("rejects a spoofed extension/type mismatch", () => {
    expect(validateMediaUpload(makeFile("photo.png", "image/jpeg", 1024)).ok).toBe(false);
  });

  it("accepts a real jpeg within the size limit", () => {
    expect(validateMediaUpload(makeFile("roof.jpg", "image/jpeg", 1024)).ok).toBe(true);
  });

  it("accepts png, webp, and heic", () => {
    expect(validateMediaUpload(makeFile("a.png", "image/png", 1024)).ok).toBe(true);
    expect(validateMediaUpload(makeFile("a.webp", "image/webp", 1024)).ok).toBe(true);
    expect(validateMediaUpload(makeFile("a.heic", "image/heic", 1024)).ok).toBe(true);
  });
});
