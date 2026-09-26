"use server";

import { revalidatePath } from "next/cache";
import { auth } from "@/lib/auth";
import { assertCan } from "@/lib/rbac";
import { prisma } from "@/lib/prisma";
import { parseDateInput } from "@/lib/dates";
import { logActivity } from "@/lib/activity";
import type { Role } from "@prisma/client";

function revalidateTaskPaths(task: { transactionId: string | null; realtorId: string | null }) {
  revalidatePath("/tasks");
  if (task.transactionId) revalidatePath(`/transactions/${task.transactionId}`);
  if (task.realtorId) {
    revalidatePath("/realtors");
    revalidatePath(`/realtors/${task.realtorId}`);
  }
}

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

  const task = await prisma.task.create({
    data: {
      title,
      description,
      dueAt: dueAtRaw ? parseDateInput(dueAtRaw) : null,
      assigneeId,
      transactionId,
    },
  });

  revalidateTaskPaths(task);
}

export async function completeTask(id: string) {
  const session = await auth();
  assertCan(session?.user?.role as Role | undefined, "crm:write");

  const task = await prisma.$transaction(async (tx) => {
    const updated = await tx.task.update({ where: { id }, data: { completedAt: new Date() } });
    await logActivity(tx, { actorId: session?.user?.id, action: "task.completed", entityType: "Task", entityId: id });
    return updated;
  });

  revalidateTaskPaths(task);
}

// Returns a result rather than throwing on bad input — called directly from
// client code, where Next would redact a thrown message in production.
export async function rescheduleTask(id: string, dueDate: string): Promise<{ ok: true } | { ok: false; error: string }> {
  const session = await auth();
  assertCan(session?.user?.role as Role | undefined, "crm:write");

  const dueAt = parseDateInput(dueDate);
  if (!dueAt) return { ok: false, error: "Pick a valid date." };

  const existing = await prisma.task.findUnique({ where: { id } });
  if (!existing) return { ok: false, error: "Task not found." };
  if (existing.completedAt) return { ok: false, error: "That task is already complete." };

  const task = await prisma.$transaction(async (tx) => {
    const updated = await tx.task.update({ where: { id }, data: { dueAt } });
    await logActivity(tx, {
      actorId: session?.user?.id,
      action: "task.rescheduled",
      entityType: "Task",
      entityId: id,
      before: { dueAt: existing.dueAt?.toISOString() ?? null },
      after: { dueAt: dueAt.toISOString() },
    });
    return updated;
  });

  revalidateTaskPaths(task);
  return { ok: true };
}
