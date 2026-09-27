import type { Prisma, RealtorParticipantRole } from "@prisma/client";
import { prisma } from "@/lib/prisma";
import { logActivity } from "@/lib/activity";
import { runAutomationSafely } from "@/lib/email/automations/safe";
import { onInspectionCancelled, onInspectionRescheduled, onInspectionScheduled } from "@/lib/email/automations/inspection";
import { getCalendarConfig } from "@/lib/calendar/config";
import { isDayKey, isTimeOfDay, zonedDateTimeToUtc, type DayKey } from "@/lib/calendar/time";
import { findInspectorConflicts, lockInspectorSchedule, type ScheduleConflict } from "./conflicts";

// The one place an inspection's schedule changes — the Calendar and the
// inspection/transaction pages all come through here, so conflict checks,
// the audit trail, and the email automation hooks can't be skipped by one
// entry point and not another. Permission checks happen in the calling
// server action; this module trusts its caller but nothing else.

export const MIN_DURATION = 15;
export const MAX_DURATION = 12 * 60;

export interface SerializedConflict {
  kind: ScheduleConflict["kind"];
  id: string;
  title: string;
  start: string;
  end: string;
}

export type ScheduleResult<T> = { ok: true; data: T } | { ok: false; error: string } | { ok: false; conflicts: SerializedConflict[]; error: string };

const serialize = (c: ScheduleConflict): SerializedConflict => ({ kind: c.kind, id: c.id, title: c.title, start: c.start.toISOString(), end: c.end.toISOString() });

class ScheduleError extends Error {}
class ConflictError extends Error {
  constructor(readonly conflicts: ScheduleConflict[]) {
    super("That time overlaps something already on the inspector's calendar.");
  }
}

function sameMinute(a: Date | null, b: Date | null) {
  if (!a || !b) return a === b;
  return Math.floor(a.getTime() / 60_000) === Math.floor(b.getTime() / 60_000);
}

export function validDuration(minutes: number): boolean {
  return Number.isInteger(minutes) && minutes >= MIN_DURATION && minutes <= MAX_DURATION && minutes % 5 === 0;
}

// When: a business-time-zone day + time → UTC instant. Returns null for
// "not scheduled yet" (both blank).
export function resolveStart(day: string | null | undefined, time: string | null | undefined, timeZone = getCalendarConfig().timeZone): Date | null {
  if (!day && !time) return null;
  if (!day || !isDayKey(day)) throw new ScheduleError("Pick a valid date.");
  if (!time || !isTimeOfDay(time)) throw new ScheduleError("Pick a valid time.");
  return zonedDateTimeToUtc(day, time, timeZone);
}

// Longest default among the chosen services (General + Radon = General's
// 3h), else the business default.
export async function suggestedDuration(serviceIds: string[], db: Prisma.TransactionClient | typeof prisma = prisma): Promise<number> {
  const fallback = getCalendarConfig().defaultDurationMinutes;
  if (serviceIds.length === 0) return fallback;
  const services = await db.service.findMany({ where: { id: { in: serviceIds } }, select: { defaultDurationMinutes: true } });
  const defaults = services.map((s) => s.defaultDurationMinutes).filter((m): m is number => typeof m === "number");
  return defaults.length ? Math.max(...defaults) : fallback;
}

async function assertNoConflicts(tx: Prisma.TransactionClient, inspectorId: string | null, start: Date | null, durationMinutes: number, excludeInspectionId?: string) {
  if (!inspectorId || !start) return;
  await lockInspectorSchedule(tx, inspectorId);
  const conflicts = await findInspectorConflicts(tx, { inspectorId, start, end: new Date(start.getTime() + durationMinutes * 60_000), excludeInspectionId });
  if (conflicts.length) throw new ConflictError(conflicts);
}

async function assertInspector(tx: Prisma.TransactionClient, inspectorId: string | null) {
  if (!inspectorId) return;
  const user = await tx.user.findUnique({ where: { id: inspectorId }, select: { active: true } });
  if (!user?.active) throw new ScheduleError("That inspector isn't available.");
}

function toResult<T>(err: unknown): ScheduleResult<T> {
  if (err instanceof ConflictError) return { ok: false, error: err.message, conflicts: err.conflicts.map(serialize) };
  if (err instanceof ScheduleError) return { ok: false, error: err.message };
  throw err;
}

// Read-only preview for the scheduling UI. The authoritative check runs
// again, under a lock, when the change is actually saved.
export async function checkConflicts(args: { inspectorId: string | null; day: string; time: string; durationMinutes: number; excludeInspectionId?: string | null }) {
  if (!args.inspectorId) return [];
  const start = resolveStart(args.day, args.time);
  if (!start) return [];
  const conflicts = await findInspectorConflicts(prisma, {
    inspectorId: args.inspectorId,
    start,
    end: new Date(start.getTime() + args.durationMinutes * 60_000),
    excludeInspectionId: args.excludeInspectionId,
  });
  return conflicts.map(serialize);
}

// ---------------------------------------------------------------------------
// Schedule
// ---------------------------------------------------------------------------

export interface ScheduleInspectionInput {
  propertyId: string;
  // Attach to this transaction; otherwise the property's open transaction
  // for this customer is reused, or a new one is started.
  transactionId?: string | null;
  customerId?: string | null;
  realtorId?: string | null;
  realtorRole?: RealtorParticipantRole | null;
  serviceIds?: string[];
  inspectorId?: string | null;
  // Business-time-zone date + time. Both blank = not scheduled yet.
  day?: DayKey | null;
  time?: string | null;
  durationMinutes?: number | null;
  accessNotes?: string | null;
}

const OPEN_TRANSACTION_STATUSES = ["LEAD_IN_PROGRESS", "SCHEDULED", "IN_PROGRESS"] as const;

async function resolveTransaction(tx: Prisma.TransactionClient, input: ScheduleInspectionInput, actorId: string | null) {
  if (input.transactionId) {
    const t = await tx.transaction.findUnique({ where: { id: input.transactionId }, include: { customers: true } });
    if (!t || t.archivedAt) throw new ScheduleError("That transaction no longer exists.");
    if (t.propertyId && t.propertyId !== input.propertyId) throw new ScheduleError("That property isn't on this transaction.");
    if (!t.propertyId) await tx.transaction.update({ where: { id: t.id }, data: { propertyId: input.propertyId } });
    return t;
  }
  // Reuse the property's open deal for this customer (or one with no
  // customer yet) rather than scattering one buyer across transactions.
  const open = await tx.transaction.findFirst({
    where: {
      propertyId: input.propertyId,
      archivedAt: null,
      status: { in: [...OPEN_TRANSACTION_STATUSES] },
      ...(input.customerId ? { OR: [{ customers: { some: { customerId: input.customerId } } }, { customers: { none: {} } }] } : {}),
    },
    orderBy: { createdAt: "desc" },
    include: { customers: true },
  });
  if (open) return open;
  const created = await tx.transaction.create({ data: { propertyId: input.propertyId, status: "SCHEDULED" }, include: { customers: true } });
  await logActivity(tx, { actorId, action: "transaction.created", entityType: "Transaction", entityId: created.id, after: { source: "calendar" } });
  return created;
}

export async function scheduleInspection(input: ScheduleInspectionInput, actorId: string | null): Promise<ScheduleResult<{ inspectionId: string; transactionId: string }>> {
  try {
    const start = resolveStart(input.day, input.time);
    const serviceIds = [...new Set(input.serviceIds ?? [])];
    const inspectorId = input.inspectorId || null;

    const result = await prisma.$transaction(async (tx) => {
      const property = await tx.property.findUnique({ where: { id: input.propertyId }, select: { id: true } });
      if (!property) throw new ScheduleError("Pick a property.");
      if (input.customerId) {
        const customer = await tx.customer.findUnique({ where: { id: input.customerId }, select: { archivedAt: true } });
        if (!customer || customer.archivedAt) throw new ScheduleError("That customer no longer exists.");
      }
      const services = serviceIds.length ? await tx.service.findMany({ where: { id: { in: serviceIds }, active: true } }) : [];
      if (services.length !== serviceIds.length) throw new ScheduleError("One of the selected services is no longer offered.");
      await assertInspector(tx, inspectorId);

      const durationMinutes = input.durationMinutes ?? (await suggestedDuration(serviceIds, tx));
      if (!validDuration(durationMinutes)) throw new ScheduleError("Duration must be between 15 minutes and 12 hours.");
      await assertNoConflicts(tx, inspectorId, start, durationMinutes);

      const transaction = await resolveTransaction(tx, input, actorId);
      if (input.customerId && !transaction.customers.some((c) => c.customerId === input.customerId)) {
        await tx.transactionCustomer.create({
          data: {
            transactionId: transaction.id,
            customerId: input.customerId,
            role: "PRIMARY_BUYER",
            primaryContact: !transaction.customers.some((c) => c.primaryContact),
          },
        });
      }
      if (input.realtorId) {
        const already = await tx.transactionRealtor.findFirst({ where: { transactionId: transaction.id, realtorId: input.realtorId } });
        if (!already) {
          const realtor = await tx.realtor.findUnique({ where: { id: input.realtorId }, include: { brokerage: true } });
          if (!realtor || realtor.archivedAt) throw new ScheduleError("That realtor no longer exists.");
          await tx.transactionRealtor.create({
            data: {
              transactionId: transaction.id,
              realtorId: realtor.id,
              role: input.realtorRole ?? "BUYER_AGENT",
              brokerageId: realtor.brokerageId,
              brokerageName: realtor.brokerage?.name ?? null,
            },
          });
        }
      }

      const inspection = await tx.inspection.create({
        data: {
          transactionId: transaction.id,
          propertyId: input.propertyId,
          inspectorId,
          scheduledAt: start,
          durationMinutes,
          accessNotes: input.accessNotes?.trim() || null,
          status: "SCHEDULED",
          // Price is snapshotted, so a later price-list change can't rewrite it.
          inspectionServices: { create: services.map((s) => ({ serviceId: s.id, price: s.basePrice })) },
        },
      });
      await logActivity(tx, {
        actorId,
        action: "inspection.scheduled",
        entityType: "Inspection",
        entityId: inspection.id,
        after: { scheduledAt: start?.toISOString() ?? null, durationMinutes, inspectorId, serviceIds, transactionId: transaction.id },
      });
      return { inspectionId: inspection.id, transactionId: transaction.id, scheduled: Boolean(start) };
    });

    // After commit: email problems are logged, never a scheduling failure.
    if (result.scheduled) {
      await runAutomationSafely({ key: "inspection_confirmation", entityType: "Inspection", entityId: result.inspectionId, actorId }, () =>
        onInspectionScheduled(result.inspectionId, { actorId })
      );
    }
    return { ok: true, data: { inspectionId: result.inspectionId, transactionId: result.transactionId } };
  } catch (err) {
    return toResult(err);
  }
}

// ---------------------------------------------------------------------------
// Reschedule / reassign / change duration
// ---------------------------------------------------------------------------

export interface RescheduleInput {
  // Omit to leave unchanged.
  day?: DayKey;
  time?: string;
  durationMinutes?: number;
  inspectorId?: string | null;
  // Tick "notify" in the confirmation: let the appointment-change
  // automation tell people. Reminders are re-created for the new time either way.
  notify?: boolean;
}

export async function rescheduleInspection(
  inspectionId: string,
  input: RescheduleInput,
  actorId: string | null
): Promise<ScheduleResult<{ changed: boolean; transactionId: string }>> {
  try {
    const outcome = await prisma.$transaction(async (tx) => {
      const current = await tx.inspection.findUnique({ where: { id: inspectionId } });
      if (!current) throw new ScheduleError("That inspection no longer exists.");
      if (current.status !== "SCHEDULED") throw new ScheduleError("Only a scheduled inspection can be rescheduled.");

      const start = input.day !== undefined || input.time !== undefined ? resolveStart(input.day, input.time) : current.scheduledAt;
      if (!start) throw new ScheduleError("Pick a date and time.");
      const durationMinutes = input.durationMinutes ?? current.durationMinutes;
      if (!validDuration(durationMinutes)) throw new ScheduleError("Duration must be between 15 minutes and 12 hours.");
      const inspectorId = input.inspectorId === undefined ? current.inspectorId : input.inspectorId || null;

      const timeChanged = !sameMinute(current.scheduledAt, start);
      const durationChanged = durationMinutes !== current.durationMinutes;
      const inspectorChanged = inspectorId !== current.inspectorId;
      if (!timeChanged && !durationChanged && !inspectorChanged) return { changed: false, current, timeChanged };

      if (inspectorChanged) await assertInspector(tx, inspectorId);
      await assertNoConflicts(tx, inspectorId, start, durationMinutes, inspectionId);

      await tx.inspection.update({
        where: { id: inspectionId },
        // A new time is a new appointment version: anything queued for the
        // old time is refused by its guard at send time.
        data: { scheduledAt: start, durationMinutes, inspectorId, ...(timeChanged ? { scheduleVersion: { increment: 1 } } : {}) },
      });
      const log = (action: string, before: Prisma.InputJsonValue, after: Prisma.InputJsonValue) =>
        logActivity(tx, { actorId, action, entityType: "Inspection", entityId: inspectionId, before, after });
      if (timeChanged) await log("inspection.rescheduled", { scheduledAt: current.scheduledAt?.toISOString() ?? null }, { scheduledAt: start.toISOString() });
      if (durationChanged) await log("inspection.duration_changed", { durationMinutes: current.durationMinutes }, { durationMinutes });
      if (inspectorChanged) await log("inspection.inspector_reassigned", { inspectorId: current.inspectorId }, { inspectorId });
      return { changed: true, current, timeChanged };
    });

    if (outcome.changed && outcome.timeChanged) {
      await runAutomationSafely({ key: "appointment_change", entityType: "Inspection", entityId: inspectionId, actorId }, () =>
        onInspectionRescheduled(inspectionId, outcome.current.scheduledAt, { actorId, notify: input.notify !== false })
      );
    }
    return { ok: true, data: { changed: outcome.changed, transactionId: outcome.current.transactionId } };
  } catch (err) {
    return toResult(err);
  }
}

// ---------------------------------------------------------------------------
// Cancel — the record stays; it just leaves the active schedule.
// ---------------------------------------------------------------------------

export async function cancelInspection(
  inspectionId: string,
  input: { notify?: boolean; reason?: string | null },
  actorId: string | null
): Promise<ScheduleResult<{ changed: boolean; transactionId: string }>> {
  try {
    const current = await prisma.inspection.findUnique({ where: { id: inspectionId } });
    if (!current) return { ok: false, error: "That inspection no longer exists." };
    if (current.status === "CANCELLED") return { ok: true, data: { changed: false, transactionId: current.transactionId } };
    if (current.status === "COMPLETED") return { ok: false, error: "A completed inspection can't be cancelled." };

    await prisma.$transaction(async (tx) => {
      await tx.inspection.update({ where: { id: inspectionId }, data: { status: "CANCELLED", scheduleVersion: { increment: 1 } } });
      await logActivity(tx, {
        actorId,
        action: "inspection.cancelled",
        entityType: "Inspection",
        entityId: inspectionId,
        before: { status: current.status, scheduledAt: current.scheduledAt?.toISOString() ?? null },
        after: { status: "CANCELLED", reason: input.reason?.trim() || null },
      });
    });
    await runAutomationSafely({ key: "appointment_change", entityType: "Inspection", entityId: inspectionId, actorId }, () =>
      onInspectionCancelled(inspectionId, { actorId, notify: input.notify !== false })
    );
    return { ok: true, data: { changed: true, transactionId: current.transactionId } };
  } catch (err) {
    return toResult(err);
  }
}
