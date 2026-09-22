"use server";

import { revalidatePath } from "next/cache";
import { auth } from "@/lib/auth";
import { assertCan } from "@/lib/rbac";
import { prisma } from "@/lib/prisma";
import type { Role } from "@prisma/client";

export async function createReferralSource(formData: FormData) {
  const session = await auth();
  assertCan(session?.user?.role as Role | undefined, "crm:write");

  const name = String(formData.get("name") ?? "").trim();
  const type = String(formData.get("type") ?? "").trim();
  if (!name || !type) throw new Error("Name and type are required.");

  await prisma.referralSource.create({ data: { name, type } });
  revalidatePath("/referral-sources");
}

export async function toggleReferralSourceActive(id: string, formData: FormData) {
  const session = await auth();
  assertCan(session?.user?.role as Role | undefined, "crm:write");

  const nextActive = String(formData.get("nextActive")) === "true";
  await prisma.referralSource.update({ where: { id }, data: { active: nextActive } });
  revalidatePath("/referral-sources");
}
