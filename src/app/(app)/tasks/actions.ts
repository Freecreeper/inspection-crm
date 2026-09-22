"use server";

import { revalidatePath } from "next/cache";
import { auth } from "@/lib/auth";
import { assertCan } from "@/lib/rbac";
import { prisma } from "@/lib/prisma";
import type { Role } from "@prisma/client";

// Tasks are the CRM's follow-up mechanism (§ "Relationship Management" /
// "Follow-Up"). A task is never required to have a transaction — general
// office follow-ups (e.g. "call vendor back") are just as valid (§7).
export async function createTask(formData: FormData) {
  const session = await auth();
  assertCan(session?.user?.role as Role | undefined, "crm:write");

  const title = String(formData.get("title") ?? "").trim();
  const description = String(formData.get("description") ?? "").trim() || null;
  const dueAtRaw = String(formData.get("dueAt") ?? "").trim();
  const assigneeId = String(formData.get("assigneeId") ?? "").trim() || null;
  const transactionId = String(formData.get("transactionId") ?? "").trim() || null;

  if (!title) throw new Error("A task title is required.");

  await prisma.task.create({
    data: {
      title,
      description,
      dueAt: dueAtRaw ? new Date(dueAtRaw) : null,
      assigneeId,
      transactionId,
    },
  });

  revalidatePath("/tasks");
  if (transactionId) revalidatePath(`/transactions/${transactionId}`);
}

export async function completeTask(id: string) {
  const session = await auth();
  assertCan(session?.user?.role as Role | undefined, "crm:write");

  const task = await prisma.task.update({ where: { id }, data: { completedAt: new Date() } });

  revalidatePath("/tasks");
  if (task.transactionId) revalidatePath(`/transactions/${task.transactionId}`);
}
