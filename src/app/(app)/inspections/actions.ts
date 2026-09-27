"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { prisma } from "@/lib/prisma";
import { auth } from "@/lib/auth";
import { assertCan } from "@/lib/rbac";
import type { Prisma, Role } from "@prisma/client";
import { logActivity } from "@/lib/activity";
import { runAutomationSafely } from "@/lib/email/automations/safe";
import { onInspectionCompleted, onInspectionScheduled } from "@/lib/email/automations/inspection";
import { cancelInspection as cancelService, rescheduleInspection as rescheduleService, scheduleInspection } from "@/lib/scheduling/service";

// "2026-10-03T09:00" from a datetime-local input, read as business-time-zone
// wall time (never the server's own zone).
function splitDateTimeLocal(raw: string): { day: string | null; time: string | null } {
  const trimmed = raw.trim();
  if (!trimmed) return { day: null, time: null };
  const [day, time] = trimmed.split("T");
  return { day: day ?? null, time: time?.slice(0, 5) ?? null };
}

// Scheduling an Inspection from a transaction. Only a property is required
// (§7); everything else can follow. Goes through the shared scheduling
// service so the inspector conflict check and time-zone handling match the
// Calendar exactly.
export async function createInspection(transactionId: string, formData: FormData) {
  const session = await auth();
  assertCan(session?.user?.role as Role | undefined, "inspection:schedule");

  const propertyId = String(formData.get("propertyId") ?? "").trim();
  const inspectorId = String(formData.get("inspectorId") ?? "").trim() || null;
  if (!propertyId) throw new Error("A property is required to schedule an inspection.");

  const result = await scheduleInspection(
    { transactionId, propertyId, inspectorId, ...splitDateTimeLocal(String(formData.get("scheduledAt") ?? "")) },
    session?.user?.id ?? null
  );
  if (!result.ok) throw new Error(result.error);

  revalidatePath(`/transactions/${transactionId}`);
  revalidatePath("/calendar");
  redirect(`/inspections/${result.data.inspectionId}`);
}

// Changing the date/time bumps the schedule version (so a reminder written
// for the old time can never send) and lets the appointment-change
// automation notify people — see lib/scheduling/service.ts.
export async function rescheduleInspection(inspectionId: string, formData: FormData) {
  const session = await auth();
  assertCan(session?.user?.role as Role | undefined, "inspection:reschedule");

  const { day, time } = splitDateTimeLocal(String(formData.get("scheduledAt") ?? ""));
  if (!day || !time) throw new Error("Pick a date and time.");
  const durationRaw = String(formData.get("durationMinutes") ?? "").trim();

  const result = await rescheduleService(
    inspectionId,
    { day, time, ...(durationRaw ? { durationMinutes: Number(durationRaw) } : {}) },
    session?.user?.id ?? null
  );
  if (!result.ok) throw new Error(result.error);

  revalidatePath(`/inspections/${inspectionId}`);
  revalidatePath(`/transactions/${result.data.transactionId}`);
  revalidatePath("/calendar");
}

export async function updateInspectionStatus(inspectionId: string, formData: FormData) {
  const session = await auth();
  assertCan(session?.user?.role as Role | undefined, "inspection:conduct");

  const status = String(formData.get("status") ?? "").trim();
  if (!status) throw new Error("A status is required.");

  // Cancelling is a scheduling change: its own permission, and the shared
  // path that withdraws reminders and records the cancellation.
  if (status === "CANCELLED") {
    assertCan(session?.user?.role as Role | undefined, "inspection:cancel");
    const result = await cancelService(inspectionId, {}, session?.user?.id ?? null);
    if (!result.ok) throw new Error(result.error);
    revalidatePath(`/inspections/${inspectionId}`);
    revalidatePath(`/transactions/${result.data.transactionId}`);
    revalidatePath("/calendar");
    return;
  }

  const previous = await prisma.inspection.findUniqueOrThrow({ where: { id: inspectionId }, select: { status: true } });
  if (previous.status === status) return;

  const data: Prisma.InspectionUpdateInput = { status: status as never };
  if (status === "IN_PROGRESS") data.startedAt = new Date();
  if (status === "COMPLETED") data.completedAt = new Date();
  // Un-cancelling changes the appointment itself.
  if (previous.status === "CANCELLED") data.scheduleVersion = { increment: 1 };

  const inspection = await prisma.inspection.update({ where: { id: inspectionId }, data });

  const actorId = session?.user?.id;
  if (status === "SCHEDULED" && previous.status === "CANCELLED") {
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
  revalidatePath("/calendar");
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

// Reassigning a scheduled inspection is checked for conflicts like any
// other schedule change; an unscheduled or finished one just records it.
export async function assignInspector(inspectionId: string, formData: FormData) {
  const session = await auth();
  assertCan(session?.user?.role as Role | undefined, "inspection:reschedule");

  const inspectorId = String(formData.get("inspectorId") ?? "").trim() || null;
  const current = await prisma.inspection.findUniqueOrThrow({ where: { id: inspectionId }, select: { status: true, scheduledAt: true, inspectorId: true } });
  if (current.inspectorId === inspectorId) return;
  if (current.status === "SCHEDULED" && current.scheduledAt) {
    const result = await rescheduleService(inspectionId, { inspectorId }, session?.user?.id ?? null);
    if (!result.ok) throw new Error(result.error);
  } else {
    await prisma.$transaction(async (tx) => {
      await tx.inspection.update({ where: { id: inspectionId }, data: { inspectorId } });
      await logActivity(tx, {
        actorId: session?.user?.id,
        action: "inspection.inspector_reassigned",
        entityType: "Inspection",
        entityId: inspectionId,
        before: { inspectorId: current.inspectorId },
        after: { inspectorId },
      });
    });
  }
  revalidatePath(`/inspections/${inspectionId}`);
  revalidatePath("/calendar");
}
