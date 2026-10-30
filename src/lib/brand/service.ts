import { createHash } from "node:crypto";
import { cache } from "react";
import type { Prisma, PrismaClient } from "@prisma/client";
import { prisma } from "@/lib/prisma";
import { logActivity } from "@/lib/activity";
import { getEmailSettings } from "@/lib/email/settings";
import { getEmailConfig } from "@/lib/email/config";
import type { EmailBrand } from "@/lib/email/render";
import { NEUTRAL_TONES, SIDEBAR_STYLES, type CustomTheme } from "@/lib/theme";
import { assetVersion, checkBrandImage, DEFAULT_BRAND_COLOR, normalizeBrandColor, type BrandAssetKind } from "./shared";

type Db = PrismaClient | Prisma.TransactionClient;
export type Result<T = undefined> = { ok: true; data: T } | { ok: false; error: string };

export interface BrandAssetRef {
  url: string; // relative, versioned: /brand/logo?v=…
  width: number;
  height: number;
  type: string;
}

export interface Brand {
  companyName: string;
  phone: string | null;
  website: string | null;
  mailingAddress: string | null;
  brandColor: string; // always a color: the chosen one or the built-in accent
  // The company-wide default theme, when a brand color has been chosen.
  theme: CustomTheme | null;
  logo: BrandAssetRef | null;
  icon: BrandAssetRef | null;
}

// Name and contact details come from Email → Settings (one place to keep
// them), colors and images from the branding tables.
export async function loadBrand(db: Db = prisma): Promise<Brand> {
  const [settings, brand, assets] = await Promise.all([
    getEmailSettings(db),
    db.brandSettings.findUnique({ where: { id: "default" } }),
    db.brandAsset.findMany({ select: { kind: true, sha256: true, width: true, height: true, contentType: true } }),
  ]);
  const ref = (kind: BrandAssetKind): BrandAssetRef | null => {
    const a = assets.find((x) => x.kind === kind);
    return a ? { url: `/brand/${kind}?v=${assetVersion(a.sha256)}`, width: a.width, height: a.height, type: a.contentType } : null;
  };
  const color = normalizeBrandColor(brand?.brandColor);
  const neutral = (NEUTRAL_TONES as string[]).includes(brand?.neutral ?? "") ? (brand!.neutral as CustomTheme["neutral"]) : "cool";
  const sidebar = (SIDEBAR_STYLES as readonly string[]).includes(brand?.sidebar ?? "") ? (brand!.sidebar as CustomTheme["sidebar"]) : "light";
  return {
    companyName: settings.companyName?.trim() || "Our inspection company",
    phone: settings.companyPhone?.trim() || null,
    website: settings.companyWebsite?.trim() || null,
    mailingAddress: settings.mailingAddress?.trim() || null,
    brandColor: color ?? DEFAULT_BRAND_COLOR,
    theme: color ? { brand: color, neutral, sidebar } : null,
    logo: ref("logo"),
    icon: ref("icon"),
  };
}

// Once per request for pages and layouts.
export const getBrand = cache(() => loadBrand());

// A versioned asset URL that works from an email or another site.
export function absoluteAssetUrl(ref: BrandAssetRef): string {
  return `${getEmailConfig().baseUrl}${ref.url}`;
}

// What an email's HTML header and footer need.
export async function loadEmailBrand(db: Db = prisma): Promise<EmailBrand> {
  const brand = await loadBrand(db);
  return {
    companyName: brand.companyName,
    brandColor: brand.brandColor,
    logoUrl: brand.logo ? absoluteAssetUrl(brand.logo) : null,
    logoWidth: brand.logo?.width,
    logoHeight: brand.logo?.height,
    phone: brand.phone,
    website: brand.website,
    mailingAddress: brand.mailingAddress,
  };
}

// The image itself, for the PDF (as a data URI) and the asset route.
export async function brandAssetBytes(kind: BrandAssetKind, db: Db = prisma) {
  return db.brandAsset.findUnique({ where: { kind } });
}

export async function brandAssetDataUri(kind: BrandAssetKind, db: Db = prisma): Promise<string | null> {
  const a = await brandAssetBytes(kind, db);
  return a ? `data:${a.contentType};base64,${Buffer.from(a.data).toString("base64")}` : null;
}

// --------------------------------------------------------------- editing

const clip = (v: unknown, max: number) => {
  const s = String(v ?? "").trim();
  return s ? s.slice(0, max) : null;
};

export async function saveBrandDetails(
  actorId: string | null,
  input: { companyName: unknown; phone: unknown; website: unknown; mailingAddress: unknown; brandColor: unknown; neutral: unknown; sidebar: unknown }
): Promise<Result> {
  const companyName = clip(input.companyName, 100);
  if (!companyName) return { ok: false, error: "Enter the company name." };
  const website = clip(input.website, 200);
  if (website && !/^https?:\/\/[^\s]+\.[^\s]+$/i.test(website)) return { ok: false, error: "Enter the website as a full address, like https://example.com." };
  const rawColor = String(input.brandColor ?? "").trim();
  const brandColor = rawColor ? normalizeBrandColor(rawColor) : null;
  if (rawColor && !brandColor) return { ok: false, error: "Pick a brand color, like #1f5a3d." };
  const neutral = (NEUTRAL_TONES as string[]).includes(String(input.neutral)) ? String(input.neutral) : "cool";
  const sidebar = (SIDEBAR_STYLES as readonly string[]).includes(String(input.sidebar)) ? String(input.sidebar) : "light";
  const details = { companyName, companyPhone: clip(input.phone, 40), companyWebsite: website, mailingAddress: clip(input.mailingAddress, 300) };

  await prisma.$transaction(async (tx) => {
    await getEmailSettings(tx);
    await tx.emailSettings.update({ where: { id: "default" }, data: { ...details, updatedById: actorId } });
    const colors = { brandColor, neutral: brandColor ? neutral : null, sidebar: brandColor ? sidebar : null, updatedById: actorId };
    await tx.brandSettings.upsert({ where: { id: "default" }, update: colors, create: { id: "default", ...colors } });
    await logActivity(tx, { actorId, action: "brand.updated", entityType: "BrandSettings", entityId: "default", after: { ...details, ...colors } });
  });
  return { ok: true, data: undefined };
}

export async function saveBrandAsset(actorId: string | null, kind: BrandAssetKind, bytes: Uint8Array): Promise<Result> {
  const checked = checkBrandImage(kind, bytes);
  if (!checked.ok) return checked;
  const sha256 = createHash("sha256").update(bytes).digest("hex");
  const data = { contentType: checked.info.type, data: Buffer.from(bytes), width: checked.info.width, height: checked.info.height, sha256, updatedById: actorId };
  await prisma.$transaction(async (tx) => {
    await tx.brandAsset.upsert({ where: { kind }, update: data, create: { kind, ...data } });
    await logActivity(tx, { actorId, action: `brand.${kind}_uploaded`, entityType: "BrandAsset", entityId: kind, after: { type: checked.info.type, width: checked.info.width, height: checked.info.height, bytes: bytes.length, sha256 } });
  });
  return { ok: true, data: undefined };
}

export async function removeBrandAsset(actorId: string | null, kind: BrandAssetKind): Promise<Result> {
  const { count } = await prisma.brandAsset.deleteMany({ where: { kind } });
  if (count) await logActivity(prisma, { actorId, action: `brand.${kind}_removed`, entityType: "BrandAsset", entityId: kind });
  return { ok: true, data: undefined };
}
