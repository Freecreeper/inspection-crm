"use server";

import type { Role } from "@prisma/client";
import { revalidatePath } from "next/cache";
import { auth } from "@/lib/auth";
import { assertCan } from "@/lib/rbac";
import { removeBrandAsset, saveBrandAsset, saveBrandDetails } from "@/lib/brand/service";
import { BRAND_ASSET_KINDS, type BrandAssetKind } from "@/lib/brand/shared";

async function requireOwner() {
  const session = await auth();
  assertCan(session?.user?.role as Role | undefined, "branding:manage");
  return session?.user?.id ?? null;
}

// Branding shows on every page, so every page is refreshed.
const done = <T extends { ok: boolean }>(r: T) => {
  if (r.ok) revalidatePath("/", "layout");
  return r;
};

const isKind = (k: string): k is BrandAssetKind => (BRAND_ASSET_KINDS as readonly string[]).includes(k);

export async function saveBrandDetailsAction(input: { companyName: string; phone: string; website: string; mailingAddress: string; brandColor: string; neutral: string; sidebar: string }) {
  return done(await saveBrandDetails(await requireOwner(), input));
}

export async function uploadBrandAssetAction(kind: string, formData: FormData) {
  const actorId = await requireOwner();
  if (!isKind(kind)) return { ok: false as const, error: "Unknown image." };
  const file = formData.get("file");
  if (!(file instanceof File)) return { ok: false as const, error: "Choose an image to upload." };
  return done(await saveBrandAsset(actorId, kind, new Uint8Array(await file.arrayBuffer())));
}

export async function removeBrandAssetAction(kind: string) {
  const actorId = await requireOwner();
  if (!isKind(kind)) return { ok: false as const, error: "Unknown image." };
  return done(await removeBrandAsset(actorId, kind));
}
