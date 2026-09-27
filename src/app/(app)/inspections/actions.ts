"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { prisma } from "@/lib/prisma";
import { auth } from "@/lib/auth";
import { assertCan } from "@/lib/rbac";
import type { Prisma, Role } from "@prisma/client";
import { logActivity } from "@/lib/activity";
import { runAutomationSafely } from "@/lib/email/automations/safe";
import {
  onInspectionCancelled,
  onInspectionCompleted,
  onInspectionRescheduled,
  onInspectionScheduled,
} from "@/lib/email/automations/inspection";

// Two times are "the same appointment" if they fall in the same minute —
// re-saving an unchanged form must never trigger a reschedule email.
function sameMinute(a: Date | null, b: Date | null) {
  if (!a || !b) return a === b;
  return Math.floor(a.getTime() / 60_000) === Math.floor(b.getTime() / 60_000);
}

// Scheduling an Inspection is a CRM/operations action (crm:write) — anyone
// who can schedule an appointment can put an inspection on the calendar.
// Only a property is required: the whole point of an inspection is to
// inspect a specific property, so unlike Transaction this can't be created
// with zero. Everything else (inspector, scheduled time, weather/occupancy
// captured on the day) can follow later without blocking the record from
// existing (§7).
export async function createInspection(transactionId: string, formData: FormData) {
  const session = await auth();
  assertCan(session?.user?.role as Role | undefined, "crm:write");

  const propertyId = String(formData.get("propertyId") ?? "").trim();
  const inspectorId = String(formData.get("inspectorId") ?? "").trim() || null;
  const scheduledAtRaw = String(formData.get("scheduledAt") ?? "").trim();
  if (!propertyId) throw new Error("A property is required to schedule an inspection.");

  const inspection = await prisma.inspection.create({
    data: {
      transactionId,
      propertyId,
      inspectorId,
      scheduledAt: scheduledAtRaw ? new Date(scheduledAtRaw) : null,
      status: "SCHEDULED",
    },
  });

  // After the inspection is saved: queue the confirmation (and reminder).
  // Email problems are logged, never surfaced as a scheduling failure.
  if (inspection.scheduledAt) {
    await runAutomationSafely({ key: "inspection_confirmation", entityType: "Inspection", entityId: inspection.id, actorId: session?.user?.id }, () =>
      onInspectionScheduled(inspection.id, { actorId: session?.user?.id })
    );
  }

  revalidatePath(`/transactions/${transactionId}`);
  redirect(`/inspections/${inspection.id}`);
}

// Changing the date/time is a meaningful appointment change: it bumps the
// schedule version (so any reminder written for the old time can never
// send), then lets the appointment-change automation notify people.
export async function rescheduleInspection(inspectionId: string, formData: FormData) {
  const session = await auth();
  assertCan(session?.user?.role as Role | undefined, "crm:write");

  const raw = String(formData.get("scheduledAt") ?? "").trim();
  const scheduledAt = raw ? new Date(raw) : null;
  if (!scheduledAt || Number.isNaN(scheduledAt.getTime())) throw new Error("Pick a date and time.");

  const current = await prisma.inspection.findUniqueOrThrow({ where: { id: inspectionId } });
  if (current.status !== "SCHEDULED") throw new Error("Only a scheduled inspection can be rescheduled.");
  if (sameMinute(current.scheduledAt, scheduledAt)) return;

  await prisma.$transaction(async (tx) => {
    await tx.inspection.update({ where: { id: inspectionId }, data: { scheduledAt, scheduleVersion: { increment: 1 } } });
    await logActivity(tx, {
      actorId: session?.user?.id,
      action: "inspection.rescheduled",
      entityType: "Inspection",
      entityId: inspectionId,
      before: { scheduledAt: current.scheduledAt?.toISOString() ?? null },
      after: { scheduledAt: scheduledAt.toISOString() },
    });
  });

  await runAutomationSafely({ key: "appointment_change", entityType: "Inspection", entityId: inspectionId, actorId: session?.user?.id }, () =>
    onInspectionRescheduled(inspectionId, current.scheduledAt, { actorId: session?.user?.id })
  );

  revalidatePath(`/inspections/${inspectionId}`);
  revalidatePath(`/transactions/${current.transactionId}`);
}

export async function updateInspectionStatus(inspectionId: string, formData: FormData) {
  const session = await auth();
  assertCan(session?.user?.role as Role | undefined, "inspection:conduct");

  const status = String(formData.get("status") ?? "").trim();
  if (!status) throw new Error("A status is required.");

  const previous = await prisma.inspection.findUniqueOrThrow({ where: { id: inspectionId }, select: { status: true } });
  if (previous.status === status) return;

  const data: Prisma.InspectionUpdateInput = { status: status as never };
  if (status === "IN_PROGRESS") data.startedAt = new Date();
  if (status === "COMPLETED") data.completedAt = new Date();
  // Cancelling (or un-cancelling) changes the appointment itself.
  if (status === "CANCELLED" || previous.status === "CANCELLED") data.scheduleVersion = { increment: 1 };

  const inspection = await prisma.inspection.update({ where: { id: inspectionId }, data });

  const actorId = session?.user?.id;
  if (status === "CANCELLED") {
    await runAutomationSafely({ key: "appointment_change", entityType: "Inspection", entityId: inspectionId, actorId }, () =>
      onInspectionCancelled(inspectionId, { actorId })
    );
  } else if (status === "SCHEDULED" && previous.status === "CANCELLED") {
    await runAutomationSafely({ key: "inspection_confirmation", entityType: "Inspection", entityId: inspectionId, actorId }, () =>
      onInspectionScheduled(inspectionId, { actorId, reinstated: true })
    );
  } else if (status === "COMPLETED") {
    await runAutomationSafely({ key: "realtor_thank_you", entityType: "Inspection", entityId: inspectionId, actorId }, () =>
      onInspectionCompleted(inspectionId, { actorId })
    );
  }

  revalidatePath(`/inspections/${inspectionId}`);
  revalidatePath(`/transactions/${inspection.transactionId}`);
}

// Property-condition fields captured on the day of the visit. Missing
// information here must never block the inspector from documenting the
// property (§ "Property Data Collection") — every field is optional.
export async function updateInspectionConditions(inspectionId: string, formData: FormData) {
  const session = await auth();
  assertCan(session?.user?.role as Role | undefined, "inspection:conduct");

  const weather = String(formData.get("weather") ?? "").trim() || null;
  const temperatureRaw = String(formData.get("temperatureF") ?? "").trim();
  const occupancyStatus = String(formData.get("occupancyStatus") ?? "").trim() || null;
  const utilitiesOnRaw = String(formData.get("utilitiesOn") ?? "");

  await prisma.inspection.update({
    where: { id: inspectionId },
    data: {
      weather,
      temperatureF: temperatureRaw ? Number(temperatureRaw) : null,
      occupancyStatus,
      utilitiesOn: utilitiesOnRaw === "" ? null : utilitiesOnRaw === "true",
    },
  });
  revalidatePath(`/inspections/${inspectionId}`);
}

export async function assignInspector(inspectionId: string, formData: FormData) {
  const session = await auth();
  assertCan(session?.user?.role as Role | undefined, "crm:write");

  const inspectorId = String(formData.get("inspectorId") ?? "").trim() || null;
  await prisma.inspection.update({ where: { id: inspectionId }, data: { inspectorId } });
  revalidatePath(`/inspections/${inspectionId}`);
}
