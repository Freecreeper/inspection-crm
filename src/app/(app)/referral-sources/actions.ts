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

// Called directly from client code (not a <form action>) by a referral
// source Combobox's "+ Add new referral source" popup — see
// createBrokerageInline for the same pattern.
export async function createReferralSourceInline(data: { name: string; type: string }) {
  const session = await auth();
  assertCan(session?.user?.role as Role | undefined, "crm:write");

  const name = data.name.trim();
  const type = data.type.trim();
  if (!name || !type) throw new Error("Name and type are required.");

  const referralSource = await prisma.referralSource.create({ data: { name, type } });
  revalidatePath("/referral-sources");
  return { id: referralSource.id, label: referralSource.name };
}

export async function toggleReferralSourceActive(id: string, formData: FormData) {
  const session = await auth();
  assertCan(session?.user?.role as Role | undefined, "crm:write");

  const nextActive = String(formData.get("nextActive")) === "true";
  await prisma.referralSource.update({ where: { id }, data: { active: nextActive } });
  revalidatePath("/referral-sources");
}
