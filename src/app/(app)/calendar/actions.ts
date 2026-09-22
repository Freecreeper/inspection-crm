"use server";

import { revalidatePath } from "next/cache";
import { auth } from "@/lib/auth";
import { assertCan } from "@/lib/rbac";
import { prisma } from "@/lib/prisma";
import type { Role } from "@prisma/client";

// Scheduling sits on Appointment, not Inspection — an appointment can exist
// (site visit, walkthrough, customer meeting) before an Inspection record
// does. Inspection-linked scheduling is wired up once the Inspection module
// (Pillar 3) exists; transactionId alone is enough for Pillar 1 scheduling.
export async function createAppointment(formData: FormData) {
  const session = await auth();
  assertCan(session?.user?.role as Role | undefined, "crm:write");

  const title = String(formData.get("title") ?? "").trim();
  const startAtRaw = String(formData.get("startAt") ?? "").trim();
  const endAtRaw = String(formData.get("endAt") ?? "").trim();
  const location = String(formData.get("location") ?? "").trim() || null;
  const transactionId = String(formData.get("transactionId") ?? "").trim() || null;

  if (!title || !startAtRaw || !endAtRaw) {
    throw new Error("Title, start time, and end time are required.");
  }

  const startAt = new Date(startAtRaw);
  const endAt = new Date(endAtRaw);
  if (endAt < startAt) throw new Error("End time cannot be before start time.");

  await prisma.appointment.create({ data: { title, startAt, endAt, location, transactionId } });

  revalidatePath("/calendar");
  if (transactionId) revalidatePath(`/transactions/${transactionId}`);
}

export async function cancelAppointment(id: string) {
  const session = await auth();
  assertCan(session?.user?.role as Role | undefined, "crm:write");

  const appointment = await prisma.appointment.update({
    where: { id },
    data: { cancelledAt: new Date() },
  });

  revalidatePath("/calendar");
  if (appointment.transactionId) revalidatePath(`/transactions/${appointment.transactionId}`);
}
