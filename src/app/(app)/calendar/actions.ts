"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import type { Role } from "@prisma/client";
import { auth } from "@/lib/auth";
import { assertCan, can, type Permission } from "@/lib/rbac";
import { prisma } from "@/lib/prisma";
import { logActivity } from "@/lib/activity";
import { digitsOnly, isValidPhoneInput } from "@/lib/phone";
import { loadCalendarEvents, MAX_RANGE_DAYS } from "@/lib/calendar/events";
import { parseLayers, normalizePreferences, type CalendarPreferences } from "@/lib/calendar/layers";
import { loadInspectionPreview, loadRealtorEventPreview, loadTaskPreview } from "@/lib/calendar/preview";
import { daysBetween, isDayKey, isTimeOfDay, zonedDateTimeToUtc } from "@/lib/calendar/time";
import { getCalendarConfig } from "@/lib/calendar/config";
import type { CalendarEvent } from "@/lib/calendar/types";
import {
  findCustomerDuplicates,
  findPropertyDuplicates,
  searchCustomers,
  searchProperties,
  searchRealtors,
  type CustomerDuplicate,
  type PropertyDuplicate,
  type SearchOption,
} from "@/lib/scheduling/records";
import {
  cancelInspection,
  checkConflicts,
  rescheduleInspection,
  scheduleInspection,
  suggestedDuration,
  type ScheduleResult,
  type SerializedConflict,
} from "@/lib/scheduling/service";

type Result<T = undefined> = { ok: true; data: T } | { ok: false; error: string };

async function requireSession(permission: Permission) {
  const session = await auth();
  const role = session?.user?.role as Role | undefined;
  assertCan(role, permission);
  return { role, userId: session?.user?.id ?? null };
}

function revalidateSchedule(transactionId?: string | null, inspectionId?: string | null) {
  revalidatePath("/calendar");
  if (transactionId) revalidatePath(`/transactions/${transactionId}`);
  if (inspectionId) revalidatePath(`/inspections/${inspectionId}`);
}

// ---------------------------------------------------------------------------
// Reading the calendar
// ---------------------------------------------------------------------------

const RangeSchema = z.object({
  start: z.string().refine(isDayKey),
  end: z.string().refine(isDayKey),
  layers: z.array(z.string()).max(20),
  inspectorId: z.string().max(64).nullable().optional(),
});

// Only the visible range, only the enabled layers.
export async function getCalendarEvents(input: z.input<typeof RangeSchema>): Promise<Result<CalendarEvent[]>> {
  const { role } = await requireSession("calendar:view");
  const parsed = RangeSchema.safeParse(input);
  if (!parsed.success) return { ok: false, error: "Invalid range." };
  const span = daysBetween(parsed.data.start, parsed.data.end);
  if (span < 1 || span > MAX_RANGE_DAYS) return { ok: false, error: "Invalid range." };
  const events = await loadCalendarEvents({ ...parsed.data, layers: parseLayers(parsed.data.layers), role });
  return { ok: true, data: events };
}

// A personal display preference — any signed-in user, only their own.
export async function saveCalendarPreferences(prefs: Partial<CalendarPreferences>): Promise<Result<CalendarPreferences>> {
  const { userId } = await requireSession("calendar:view");
  if (!userId) return { ok: false, error: "Not signed in." };
  const normalized = normalizePreferences(prefs);
  await prisma.user.update({ where: { id: userId }, data: { calendarPreferences: { ...normalized } } });
  return { ok: true, data: normalized };
}

export async function getInspectionPreview(id: string) {
  const { role } = await requireSession("calendar:view");
  return loadInspectionPreview(id, role);
}

export async function getTaskPreview(id: string) {
  const { role } = await requireSession("calendar:view");
  return loadTaskPreview(id, role);
}

export async function getRealtorEventPreview(id: string) {
  const { role } = await requireSession("calendar:view");
  return loadRealtorEventPreview(id, role);
}

// ---------------------------------------------------------------------------
// Scheduling form data
// ---------------------------------------------------------------------------

export interface SchedulingOptions {
  services: { id: string; name: string; defaultDurationMinutes: number | null }[];
  inspectors: { id: string; name: string }[];
}

export async function getSchedulingOptions(): Promise<SchedulingOptions> {
  await requireSession("calendar:view");
  const [services, inspectors] = await Promise.all([
    prisma.service.findMany({ where: { active: true }, orderBy: { name: "asc" }, select: { id: true, name: true, defaultDurationMinutes: true } }),
    prisma.user.findMany({ where: { active: true, role: { in: ["INSPECTOR", "OWNER_ADMIN"] } }, orderBy: { name: "asc" }, select: { id: true, name: true } }),
  ]);
  return { services, inspectors };
}

const searchQuery = (q: unknown) => (typeof q === "string" ? q.slice(0, 100) : "");

export async function searchCustomersAction(q: string): Promise<SearchOption[]> {
  await requireSession("inspection:schedule");
  return searchCustomers(searchQuery(q));
}

export async function searchPropertiesAction(q: string): Promise<SearchOption[]> {
  await requireSession("inspection:schedule");
  return searchProperties(searchQuery(q));
}

export async function searchRealtorsAction(q: string): Promise<SearchOption[]> {
  await requireSession("inspection:schedule");
  return searchRealtors(searchQuery(q));
}

export async function suggestDuration(serviceIds: string[]): Promise<number> {
  await requireSession("calendar:view");
  return suggestedDuration(Array.isArray(serviceIds) ? serviceIds.filter((s) => typeof s === "string").slice(0, 20) : []);
}

// A preview for the form. Saving re-checks under a lock regardless.
export async function previewConflicts(input: { inspectorId: string | null; day: string; time: string; durationMinutes: number; excludeInspectionId?: string | null }): Promise<SerializedConflict[]> {
  const session = await auth();
  const role = session?.user?.role as Role | undefined;
  if (!can(role, "inspection:schedule") && !can(role, "inspection:reschedule")) assertCan(role, "inspection:schedule");
  if (!isDayKey(input.day) || !isTimeOfDay(input.time) || !Number.isInteger(input.durationMinutes)) return [];
  return checkConflicts(input);
}

// ---------------------------------------------------------------------------
// Schedule / reschedule / cancel — authoritative, server-validated
// ---------------------------------------------------------------------------

const ScheduleSchema = z.object({
  propertyId: z.string().min(1, "Pick a property.").max(64),
  customerId: z.string().max(64).nullable().optional(),
  realtorId: z.string().max(64).nullable().optional(),
  realtorRole: z.enum(["BUYER_AGENT", "LISTING_AGENT", "TRANSACTION_COORDINATOR", "OTHER"]).nullable().optional(),
  serviceIds: z.array(z.string().max(64)).max(20).default([]),
  inspectorId: z.string().max(64).nullable().optional(),
  day: z.string().refine(isDayKey, "Pick a valid date."),
  time: z.string().refine(isTimeOfDay, "Pick a valid time."),
  durationMinutes: z.number().int().nullable().optional(),
  accessNotes: z.string().max(2000).nullable().optional(),
});

export async function scheduleInspectionAction(input: z.input<typeof ScheduleSchema>): Promise<ScheduleResult<{ inspectionId: string; transactionId: string }>> {
  const { userId } = await requireSession("inspection:schedule");
  const parsed = ScheduleSchema.safeParse(input);
  if (!parsed.success) return { ok: false, error: parsed.error.issues[0]?.message ?? "Check the form." };
  const result = await scheduleInspection(parsed.data, userId);
  if (result.ok) revalidateSchedule(result.data.transactionId, result.data.inspectionId);
  return result;
}

const RescheduleSchema = z.object({
  day: z.string().refine(isDayKey, "Pick a valid date.").optional(),
  time: z.string().refine(isTimeOfDay, "Pick a valid time.").optional(),
  durationMinutes: z.number().int().optional(),
  inspectorId: z.string().max(64).nullable().optional(),
  notify: z.boolean().optional(),
});

export async function rescheduleInspectionAction(inspectionId: string, input: z.input<typeof RescheduleSchema>): Promise<ScheduleResult<{ changed: boolean; transactionId: string }>> {
  const { userId } = await requireSession("inspection:reschedule");
  const parsed = RescheduleSchema.safeParse(input);
  if (!parsed.success) return { ok: false, error: parsed.error.issues[0]?.message ?? "Check the form." };
  const result = await rescheduleInspection(inspectionId, parsed.data, userId);
  if (result.ok) revalidateSchedule(result.data.transactionId, inspectionId);
  return result;
}

export async function cancelInspectionAction(inspectionId: string, input: { notify?: boolean; reason?: string | null }): Promise<ScheduleResult<{ changed: boolean; transactionId: string }>> {
  const { userId } = await requireSession("inspection:cancel");
  const result = await cancelInspection(inspectionId, { notify: input.notify !== false, reason: typeof input.reason === "string" ? input.reason.slice(0, 500) : null }, userId);
  if (result.ok) revalidateSchedule(result.data.transactionId, inspectionId);
  return result;
}

// No e-signature system yet: staff record that the agreement is signed.
export async function setAgreementSigned(inspectionId: string, signed: boolean): Promise<Result> {
  const { userId } = await requireSession("crm:write");
  const current = await prisma.inspection.findUnique({ where: { id: inspectionId }, select: { agreementSignedAt: true } });
  if (!current) return { ok: false, error: "That inspection no longer exists." };
  if (Boolean(current.agreementSignedAt) === signed) return { ok: true, data: undefined };
  await prisma.$transaction(async (tx) => {
    await tx.inspection.update({ where: { id: inspectionId }, data: { agreementSignedAt: signed ? new Date() : null } });
    await logActivity(tx, { actorId: userId, action: signed ? "inspection.agreement_signed" : "inspection.agreement_unsigned", entityType: "Inspection", entityId: inspectionId });
  });
  revalidateSchedule(null, inspectionId);
  return { ok: true, data: undefined };
}

// ---------------------------------------------------------------------------
// Create while scheduling — with duplicate protection
// ---------------------------------------------------------------------------

export type QuickCreateResult<D> = { ok: true; data: SearchOption } | { ok: false; error: string } | { ok: false; duplicates: D[] };

// Previously the only way to create a Customer was converting a Lead; the
// Calendar spec adds this path so scheduling isn't abandoned. It checks for
// likely existing customers first and never merges on its own.
export async function createCustomerQuick(input: { firstName: string; lastName: string; email?: string; phone?: string; confirmDuplicates?: boolean }): Promise<QuickCreateResult<CustomerDuplicate>> {
  const { userId } = await requireSession("crm:write");
  const firstName = input.firstName?.trim() ?? "";
  const lastName = input.lastName?.trim() ?? "";
  if (!firstName || !lastName) return { ok: false, error: "First and last name are required." };
  const email = input.email?.trim() || null;
  if (email && !z.email().safeParse(email).success) return { ok: false, error: "That email address doesn't look valid." };
  const rawPhone = input.phone?.trim() ?? "";
  if (!isValidPhoneInput(rawPhone)) return { ok: false, error: "Phone number must have 10 digits." };
  const phone = rawPhone ? digitsOnly(rawPhone) : null;

  if (!input.confirmDuplicates) {
    const duplicates = await findCustomerDuplicates({ firstName, lastName, email, phone });
    if (duplicates.length) return { ok: false, duplicates };
  }
  const customer = await prisma.$transaction(async (tx) => {
    const created = await tx.customer.create({ data: { firstName, lastName, email, phone } });
    await logActivity(tx, { actorId: userId, action: "customer.created", entityType: "Customer", entityId: created.id, after: { source: "calendar", firstName, lastName, email, phone } });
    return created;
  });
  revalidatePath("/customers");
  return { ok: true, data: { id: customer.id, label: `${firstName} ${lastName}`, sublabel: [phone, email].filter(Boolean).join(" · ") || "No contact info" } };
}

export async function createPropertyQuick(input: { addressLine1: string; addressLine2?: string; city: string; state: string; zip: string; confirmDuplicates?: boolean }): Promise<QuickCreateResult<PropertyDuplicate>> {
  const { userId } = await requireSession("crm:write");
  const addressLine1 = input.addressLine1?.trim() ?? "";
  const addressLine2 = input.addressLine2?.trim() || null;
  const city = input.city?.trim() ?? "";
  const state = input.state?.trim().toUpperCase() ?? "";
  const zip = input.zip?.trim() ?? "";
  if (!addressLine1 || !city || !state || !zip) return { ok: false, error: "Street, city, state, and ZIP are required." };
  if (!/^[A-Z]{2}$/.test(state)) return { ok: false, error: "State should be a 2-letter code, like NC." };
  if (!/^\d{5}(-\d{4})?$/.test(zip)) return { ok: false, error: "ZIP should look like 28601." };

  if (!input.confirmDuplicates) {
    const duplicates = await findPropertyDuplicates({ addressLine1, addressLine2, city, zip });
    if (duplicates.length) return { ok: false, duplicates };
  }
  const property = await prisma.$transaction(async (tx) => {
    const created = await tx.property.create({ data: { addressLine1, addressLine2, city, state, zip } });
    await logActivity(tx, { actorId: userId, action: "property.created", entityType: "Property", entityId: created.id, after: { source: "calendar" } });
    return created;
  });
  revalidatePath("/properties");
  return { ok: true, data: { id: property.id, label: [addressLine1, addressLine2].filter(Boolean).join(" "), sublabel: `${city}, ${state} ${zip}` } };
}

// ---------------------------------------------------------------------------
// Blocked time & calendar tasks
// ---------------------------------------------------------------------------

const BlockSchema = z.object({
  userId: z.string().min(1, "Pick whose time this is.").max(64),
  title: z.string().trim().min(1, "Give it a short label.").max(120),
  day: z.string().refine(isDayKey, "Pick a valid date."),
  startTime: z.string().refine(isTimeOfDay, "Pick a start time."),
  endTime: z.string().refine(isTimeOfDay, "Pick an end time."),
});

// Inspectors may block only their own time; office staff and owners may
// block anyone's.
export async function createBlockedTime(input: z.input<typeof BlockSchema>): Promise<Result<{ id: string }>> {
  const { role, userId } = await requireSession("calendar:block_time");
  const parsed = BlockSchema.safeParse(input);
  if (!parsed.success) return { ok: false, error: parsed.error.issues[0]?.message ?? "Check the form." };
  const b = parsed.data;
  if (role === "INSPECTOR" && b.userId !== userId) return { ok: false, error: "You can only block your own time." };
  const tz = getCalendarConfig().timeZone;
  const startAt = zonedDateTimeToUtc(b.day, b.startTime, tz);
  const endAt = zonedDateTimeToUtc(b.day, b.endTime, tz);
  if (endAt <= startAt) return { ok: false, error: "End time must be after the start time." };
  const user = await prisma.user.findUnique({ where: { id: b.userId }, select: { active: true } });
  if (!user?.active) return { ok: false, error: "That person isn't available." };

  const block = await prisma.$transaction(async (tx) => {
    const created = await tx.appointment.create({ data: { kind: "BLOCK", userId: b.userId, title: b.title, startAt, endAt } });
    await logActivity(tx, { actorId: userId, action: "calendar.block_created", entityType: "Appointment", entityId: created.id, after: { userId: b.userId, title: b.title, startAt: startAt.toISOString(), endAt: endAt.toISOString() } });
    return created;
  });
  revalidatePath("/calendar");
  return { ok: true, data: { id: block.id } };
}

export async function removeBlockedTime(id: string): Promise<Result> {
  const { role, userId } = await requireSession("calendar:block_time");
  const block = await prisma.appointment.findUnique({ where: { id } });
  if (!block || block.cancelledAt) return { ok: false, error: "That time is no longer blocked." };
  if (role === "INSPECTOR" && block.userId !== userId) return { ok: false, error: "You can only change your own blocked time." };
  await prisma.$transaction(async (tx) => {
    await tx.appointment.update({ where: { id }, data: { cancelledAt: new Date() } });
    await logActivity(tx, { actorId: userId, action: "calendar.block_removed", entityType: "Appointment", entityId: id });
  });
  revalidatePath("/calendar");
  return { ok: true, data: undefined };
}

export async function createCalendarTask(input: { title: string; day: string; assigneeId?: string | null }): Promise<Result<{ id: string }>> {
  const { userId } = await requireSession("task:update");
  const title = input.title?.trim() ?? "";
  if (!title) return { ok: false, error: "A task title is required." };
  if (!isDayKey(input.day)) return { ok: false, error: "Pick a valid date." };
  // Task due dates are calendar days anchored at noon in the business zone.
  const dueAt = zonedDateTimeToUtc(input.day, "12:00", getCalendarConfig().timeZone);
  const task = await prisma.$transaction(async (tx) => {
    const created = await tx.task.create({ data: { title: title.slice(0, 200), dueAt, assigneeId: input.assigneeId || null } });
    await logActivity(tx, { actorId: userId, action: "task.created", entityType: "Task", entityId: created.id, after: { source: "calendar" } });
    return created;
  });
  revalidatePath("/calendar");
  revalidatePath("/tasks");
  return { ok: true, data: { id: task.id } };
}

// ---------------------------------------------------------------------------
// Transaction-page appointments (site visits, walkthroughs). Form actions;
// datetime-local values are read as business-time-zone wall time.
// ---------------------------------------------------------------------------

function wallTime(raw: string): Date | null {
  const [day, time] = raw.trim().split("T");
  if (!day || !time || !isDayKey(day) || !isTimeOfDay(time.slice(0, 5))) return null;
  return zonedDateTimeToUtc(day, time.slice(0, 5), getCalendarConfig().timeZone);
}

export async function createAppointment(formData: FormData) {
  const { userId } = await requireSession("crm:write");
  const title = String(formData.get("title") ?? "").trim();
  const startAt = wallTime(String(formData.get("startAt") ?? ""));
  const endAt = wallTime(String(formData.get("endAt") ?? ""));
  const location = String(formData.get("location") ?? "").trim() || null;
  const transactionId = String(formData.get("transactionId") ?? "").trim() || null;
  if (!title || !startAt || !endAt) throw new Error("Title, start time, and end time are required.");
  if (endAt <= startAt) throw new Error("End time must be after the start time.");

  await prisma.$transaction(async (tx) => {
    const created = await tx.appointment.create({ data: { title, startAt, endAt, location, transactionId } });
    await logActivity(tx, { actorId: userId, action: "appointment.created", entityType: "Appointment", entityId: created.id });
  });
  revalidateSchedule(transactionId);
}

export async function cancelAppointment(id: string) {
  const { userId } = await requireSession("crm:write");
  const appointment = await prisma.$transaction(async (tx) => {
    const updated = await tx.appointment.update({ where: { id }, data: { cancelledAt: new Date() } });
    await logActivity(tx, { actorId: userId, action: "appointment.cancelled", entityType: "Appointment", entityId: id });
    return updated;
  });
  revalidateSchedule(appointment.transactionId);
}
