"use server";

import { redirect } from "next/navigation";
import { revalidatePath } from "next/cache";
import { prisma } from "@/lib/prisma";
import { auth } from "@/lib/auth";
import { assertCan } from "@/lib/rbac";
import { searchParamsToConfig } from "@/lib/reporting";
import type { Role } from "@prisma/client";

export async function saveReport(formData: FormData) {
  const session = await auth();
  assertCan(session?.user?.role as Role | undefined, "report-builder:use");
  if (!session?.user?.id) throw new Error("Not signed in.");

  const name = String(formData.get("name") ?? "").trim();
  if (!name) throw new Error("A name is required.");

  const configJson = String(formData.get("configJson") ?? "");
  const config = JSON.parse(configJson);
  if (!searchParamsToConfig({ entity: config.entity })) throw new Error("Invalid report configuration.");

  const shared = formData.get("shared") === "true";

  const saved = await prisma.reportDefinition.create({
    data: { name, ownerId: session.user.id, entity: config.entity, config, shared },
  });

  revalidatePath("/reports/saved");
  redirect(`/reports/saved/${saved.id}`);
}

export async function deleteSavedReport(id: string) {
  const session = await auth();
  assertCan(session?.user?.role as Role | undefined, "report-builder:use");
  await prisma.reportDefinition.delete({ where: { id } });
  revalidatePath("/reports/saved");
}
