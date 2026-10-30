// Pure (client-safe): company branding rules shared by the settings screen,
// the asset routes, the PDF and the emails.

import { contrast, parseHex } from "@/lib/theme/color";

export const BRAND_ASSET_KINDS = ["logo", "icon"] as const;
export type BrandAssetKind = (typeof BRAND_ASSET_KINDS)[number];

export const MAX_BRAND_ASSET_BYTES = 1024 * 1024; // 1 MB
// The built-in palette's accent, used until a brand color is chosen.
export const DEFAULT_BRAND_COLOR = "#1f7a5a";

export interface ImageInfo {
  type: "image/png" | "image/jpeg";
  width: number;
  height: number;
}

// The image's real type and size, read from its bytes (never from the
// file name or the browser's claimed type). PNG and baseline/progressive
// JPEG only; anything else — including SVG — is null.
export function sniffImage(bytes: Uint8Array): ImageInfo | null {
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  const PNG = [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a];
  if (bytes.length >= 24 && PNG.every((b, i) => bytes[i] === b) && String.fromCharCode(...bytes.slice(12, 16)) === "IHDR") {
    const width = view.getUint32(16);
    const height = view.getUint32(20);
    return width && height ? { type: "image/png", width, height } : null;
  }
  if (bytes.length >= 4 && bytes[0] === 0xff && bytes[1] === 0xd8) {
    let i = 2;
    while (i + 9 < bytes.length) {
      if (bytes[i] !== 0xff) return null;
      const marker = bytes[i + 1];
      if (marker === 0xd9 || marker === 0xda) return null; // end of image / start of scan before any frame header
      const length = view.getUint16(i + 2);
      // Start-of-frame markers (C0–CF except DHT C4, JPG C8, DAC CC) carry the size.
      if (marker >= 0xc0 && marker <= 0xcf && marker !== 0xc4 && marker !== 0xc8 && marker !== 0xcc) {
        const height = view.getUint16(i + 5);
        const width = view.getUint16(i + 7);
        return width && height ? { type: "image/jpeg", width, height } : null;
      }
      if (length < 2) return null;
      i += 2 + length;
    }
  }
  return null;
}

// What each upload has to be, with a reason a person can act on.
export function checkBrandImage(kind: BrandAssetKind, bytes: Uint8Array): { ok: true; info: ImageInfo } | { ok: false; error: string } {
  if (bytes.length === 0) return { ok: false, error: "The file is empty." };
  if (bytes.length > MAX_BRAND_ASSET_BYTES) return { ok: false, error: "Keep the image under 1 MB." };
  const info = sniffImage(bytes);
  if (!info) return { ok: false, error: "Upload a PNG or JPG image. (SVG and other formats can't be used in the report PDF.)" };
  if (info.width > 8000 || info.height > 8000) return { ok: false, error: "That image is too large in pixels; keep it under 8000 × 8000." };
  if (kind === "logo" && (info.width < 120 || info.height < 30)) return { ok: false, error: "The logo is too small to look sharp. Use one at least 600 pixels wide." };
  if (kind === "icon") {
    if (info.width < 64 || info.height < 64) return { ok: false, error: "The icon needs to be at least 64 × 64 pixels (256 × 256 or more is best)." };
    const ratio = info.width / info.height;
    if (ratio < 0.9 || ratio > 1.1) return { ok: false, error: "The icon needs to be square, like 512 × 512." };
  }
  return { ok: true, info };
}

export function normalizeBrandColor(value: unknown): string | null {
  if (typeof value !== "string") return null;
  const hex = value.trim().toLowerCase();
  return /^#[0-9a-f]{6}$/.test(hex) && parseHex(hex) ? hex : null;
}

// White or near-black, whichever reads better on the brand color.
export function textOnBrand(brandColor: string): "#ffffff" | "#111827" {
  const bg = parseHex(brandColor);
  const white = parseHex("#ffffff")!;
  const ink = parseHex("#111827")!;
  if (!bg) return "#ffffff";
  return contrast(bg, white) >= contrast(bg, ink) ? "#ffffff" : "#111827";
}

// The placeholder mark: a house on a rounded square in the brand color
// (the same house icon the app has always shown). Drawn natively wherever
// it appears — inline SVG on pages and as the favicon, vector shapes in
// the PDF — so there's no image file to replace later.
export const HOUSE_PATHS = [
  "M15 21v-8a1 1 0 0 0-1-1h-4a1 1 0 0 0-1 1v8",
  "M3 10a2 2 0 0 1 .709-1.528l7-5.999a2 2 0 0 1 2.582 0l7 5.999A2 2 0 0 1 21 10v9a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z",
];

export function placeholderMarkSvg(brandColor: string, size = 64): string {
  const color = normalizeBrandColor(brandColor) ?? DEFAULT_BRAND_COLOR;
  const ink = textOnBrand(color);
  const paths = HOUSE_PATHS.map((d) => `<path d="${d}"/>`).join("");
  return `<svg xmlns="http://www.w3.org/2000/svg" width="${size}" height="${size}" viewBox="0 0 32 32"><rect width="32" height="32" rx="7" fill="${color}"/><g transform="translate(5.6 5.6) scale(0.867)" fill="none" stroke="${ink}" stroke-width="2.25" stroke-linecap="round" stroke-linejoin="round">${paths}</g></svg>`;
}

// Short version for cache-busting asset URLs.
export const assetVersion = (sha256: string) => sha256.slice(0, 12);
