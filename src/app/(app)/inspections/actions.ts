"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { prisma } from "@/lib/prisma";
import { auth } from "@/lib/auth";
import { assertCan } from "@/lib/rbac";
import type { Prisma, Role } from "@prisma/client";

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

  revalidatePath(`/transactions/${transactionId}`);
  redirect(`/inspections/${inspection.id}`);
}

export async function updateInspectionStatus(inspectionId: string, formData: FormData) {
  const session = await auth();
  assertCan(session?.user?.role as Role | undefined, "inspection:conduct");

  const status = String(formData.get("status") ?? "").trim();
  if (!status) throw new Error("A status is required.");

  const data: Prisma.InspectionUpdateInput = { status: status as never };
  if (status === "IN_PROGRESS") data.startedAt = new Date();
  if (status === "COMPLETED") data.completedAt = new Date();

  const inspection = await prisma.inspection.update({ where: { id: inspectionId }, data });
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
