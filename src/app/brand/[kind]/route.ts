import { NextResponse } from "next/server";
import { brandAssetBytes, loadBrand } from "@/lib/brand/service";
import { assetVersion, BRAND_ASSET_KINDS, placeholderMarkSvg, type BrandAssetKind } from "@/lib/brand/shared";

// Public: the company logo and browser icon, for emails, public pages and
// the tab icon (no staff session — see src/proxy.ts). Only images that
// passed the upload checks (PNG/JPEG by content) are ever served. With no
// icon uploaded, /brand/icon is the placeholder mark in the brand color
// (an SVG this app writes itself, never an uploaded one).
const SAFE = { "X-Content-Type-Options": "nosniff", "Content-Security-Policy": "default-src 'none'; style-src 'unsafe-inline'", "Cross-Origin-Resource-Policy": "cross-origin" };

export async function GET(req: Request, { params }: { params: Promise<{ kind: string }> }) {
  const { kind } = await params;
  if (!(BRAND_ASSET_KINDS as readonly string[]).includes(kind)) return new NextResponse(null, { status: 404 });
  const asset = await brandAssetBytes(kind as BrandAssetKind);
  // A URL carrying the current version never changes, so it can be cached
  // for good; anything else is rechecked often so a new logo shows quickly.
  const versioned = new URL(req.url).searchParams.get("v");

  if (!asset) {
    if (kind !== "icon") return new NextResponse(null, { status: 404, headers: { "Cache-Control": "public, max-age=60" } });
    const brand = await loadBrand();
    return new NextResponse(placeholderMarkSvg(brand.brandColor), { headers: { ...SAFE, "Content-Type": "image/svg+xml", "Cache-Control": "public, max-age=300" } });
  }
  const current = versioned === assetVersion(asset.sha256);
  return new NextResponse(new Uint8Array(asset.data), {
    headers: { ...SAFE, "Content-Type": asset.contentType, "Cache-Control": current ? "public, max-age=31536000, immutable" : "public, max-age=300", ETag: `"${asset.sha256}"` },
  });
}
