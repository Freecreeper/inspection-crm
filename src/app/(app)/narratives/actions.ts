"use server";

import { revalidatePath } from "next/cache";
import { prisma } from "@/lib/prisma";
import { auth } from "@/lib/auth";
import { assertCan } from "@/lib/rbac";
import type { Role } from "@prisma/client";

export async function createNarrative(formData: FormData) {
  const session = await auth();
  assertCan(session?.user?.role as Role | undefined, "inspection:conduct");

  const title = String(formData.get("title") ?? "").trim();
  const narrativeText = String(formData.get("narrativeText") ?? "").trim();
  if (!title || !narrativeText) throw new Error("A title and narrative text are required.");

  await prisma.narrative.create({
    data: {
      title,
      narrativeText,
      sectionHint: String(formData.get("sectionHint") ?? "").trim() || null,
      componentHint: String(formData.get("componentHint") ?? "").trim() || null,
      recommendationText: String(formData.get("recommendationText") ?? "").trim() || null,
      createdById: session?.user?.id ?? null,
    },
  });
  revalidatePath("/narratives");
}

export async function toggleNarrativeActive(id: string, formData: FormData) {
  const session = await auth();
  assertCan(session?.user?.role as Role | undefined, "inspection:conduct");

  const nextActive = String(formData.get("nextActive")) === "true";
  await prisma.narrative.update({ where: { id }, data: { active: nextActive } });
  revalidatePath("/narratives");
}
