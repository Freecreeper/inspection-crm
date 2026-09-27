import type { EmailSendMode, Prisma, PrismaClient, RealtorParticipantRole } from "@prisma/client";
import { prisma } from "@/lib/prisma";
import { formatDateLong, formatTime } from "../context";
import { cancelPendingEmails, enqueueEmail } from "../queue";
import type { GuardCheck } from "../guards";
import { getAutomation, logAutomationEvent, type AutomationKey } from "./registry";

type Db = PrismaClient | Prisma.TransactionClient;

interface RecipientConfig {
  customers: "all" | "primary";
  includeRealtors: boolean;
  realtorRoles: RealtorParticipantRole[];
}

async function loadInspection(inspectionId: string, db: Db) {
  return db.inspection.findUnique({
    where: { id: inspectionId },
    include: {
      transaction: {
        include: {
          customers: { include: { customer: true }, orderBy: { createdAt: "asc" } },
          realtors: { include: { realtor: true }, orderBy: { createdAt: "asc" } },
        },
      },
    },
  });
}

type LoadedInspection = NonNullable<Awaited<ReturnType<typeof loadInspection>>>;

// Who an inspection email goes to, per the automation's settings. Realtors
// are included only when that's explicitly switched on.
export function inspectionRecipients(inspection: LoadedInspection, cfg: RecipientConfig) {
  const tcs = inspection.transaction.customers;
  const primary = tcs.find((tc) => tc.primaryContact) ?? tcs[0];
  const customers = (cfg.customers === "primary" ? (primary ? [primary] : []) : tcs).map((tc) => tc.customer);
  const seen = new Set<string>();
  const realtors = cfg.includeRealtors
    ? inspection.transaction.realtors
        .filter((tr) => cfg.realtorRoles.includes(tr.role) && !tr.realtor.archivedAt)
        .map((tr) => tr.realtor)
        .filter((r) => (seen.has(r.id) ? false : (seen.add(r.id), true)))
    : [];
  return { customers, realtors };
}

interface SendPlan {
  automationKey: AutomationKey;
  automationId: string;
  sendMode: EmailSendMode;
  keyPrefix: string;
  customerTemplateKey: string;
  realtorTemplateKey: string;
  guard: GuardCheck;
  scheduledFor?: Date;
  extraVars?: Record<string, string>;
  actorId?: string | null;
  recipients: ReturnType<typeof inspectionRecipients>;
  inspection: LoadedInspection;
  // The catch-up sweep re-runs constantly; it shouldn't re-log the same skip.
  quiet?: boolean;
}

async function sendToRecipients(plan: SendPlan, db: Db) {
  const { inspection } = plan;
  const refsBase = { inspectionId: inspection.id, transactionId: inspection.transactionId };
  const draft = plan.sendMode === "REVIEW";
  const results = [];

  if (plan.recipients.customers.length === 0 && !plan.quiet) {
    await logAutomationEvent(
      plan.automationId,
      { entityType: "Inspection", entityId: inspection.id, result: "SKIPPED", detail: { reason: "No customer on the transaction" }, triggeredById: plan.actorId },
      db
    );
  }

  for (const customer of plan.recipients.customers) {
    results.push(
      await enqueueEmail(
        {
          mode: draft ? "REVIEW" : "AUTOMATIC",
          draft,
          templateKey: plan.customerTemplateKey,
          recipient: { type: "CUSTOMER", name: `${customer.firstName} ${customer.lastName}`, email: customer.email },
          refs: { ...refsBase, customerId: customer.id },
          automationId: plan.automationId,
          idempotencyKey: `${plan.keyPrefix}:customer:${customer.id}`,
          guard: { checks: [plan.guard], extraVars: plan.extraVars },
          scheduledFor: plan.scheduledFor,
          createdById: plan.actorId,
        },
        db
      )
    );
  }
  for (const realtor of plan.recipients.realtors) {
    results.push(
      await enqueueEmail(
        {
          mode: draft ? "REVIEW" : "AUTOMATIC",
          draft,
          templateKey: plan.realtorTemplateKey,
          recipient: { type: "REALTOR", name: `${realtor.firstName} ${realtor.lastName}`, email: realtor.email },
          refs: { ...refsBase, realtorId: realtor.id },
          automationId: plan.automationId,
          idempotencyKey: `${plan.keyPrefix}:realtor:${realtor.id}`,
          guard: { checks: [plan.guard], extraVars: plan.extraVars },
          scheduledFor: plan.scheduledFor,
          createdById: plan.actorId,
        },
        db
      )
    );
  }

  for (const { message, created } of results) {
    if (!created) continue;
    await logAutomationEvent(
      plan.automationId,
      {
        entityType: "Inspection",
        entityId: inspection.id,
        result: message.status,
        detail: { emailMessageId: message.id, recipient: message.recipientName, reason: message.statusReason },
        triggeredById: plan.actorId,
      },
      db
    );
  }
  return results;
}

// Schedules the pre-inspection reminder for the inspection's *current*
// appointment version. Called on scheduling and on every reschedule.
type HookOpts = { actorId?: string | null; now?: Date; db?: Db; quiet?: boolean };

export async function scheduleInspectionReminders(inspectionId: string, opts: HookOpts = {}) {
  const db = opts.db ?? prisma;
  const now = opts.now ?? new Date();
  const auto = await getAutomation("inspection_reminder", db);
  if (!auto.active) return [];
  const inspection = await loadInspection(inspectionId, db);
  if (!inspection || inspection.status !== "SCHEDULED" || !inspection.scheduledAt) return [];

  const sendAt = new Date(inspection.scheduledAt.getTime() - auto.config.hoursBefore * 3600_000);
  // Booked inside the reminder window: the confirmation already covers it.
  if (sendAt <= now) return [];

  return sendToRecipients(
    {
      automationKey: "inspection_reminder",
      automationId: auto.row.id,
      sendMode: auto.sendMode,
      keyPrefix: `inspection:${inspection.id}:reminder:v${inspection.scheduleVersion}`,
      customerTemplateKey: auto.config.templateKey,
      realtorTemplateKey: auto.config.realtorTemplateKey,
      guard: { kind: "inspectionScheduled", inspectionId: inspection.id, scheduleVersion: inspection.scheduleVersion },
      scheduledFor: sendAt,
      actorId: opts.actorId,
      quiet: opts.quiet,
      recipients: inspectionRecipients(inspection, auto.config),
      inspection,
    },
    db
  );
}

// "Inspection successfully scheduled" — has a time and is SCHEDULED.
// Confirmation is keyed per inspection+recipient, so it goes out at most once
// no matter how many times this runs.
export async function onInspectionScheduled(inspectionId: string, opts: HookOpts = {}) {
  const db = opts.db ?? prisma;
  const inspection = await loadInspection(inspectionId, db);
  if (!inspection || inspection.status !== "SCHEDULED" || !inspection.scheduledAt) return [];

  const auto = await getAutomation("inspection_confirmation", db);
  const results = auto.active
    ? await sendToRecipients(
        {
          automationKey: "inspection_confirmation",
          automationId: auto.row.id,
          sendMode: auto.sendMode,
          keyPrefix: `inspection:${inspection.id}:confirmation`,
          customerTemplateKey: auto.config.templateKey,
          realtorTemplateKey: auto.config.realtorTemplateKey,
          guard: { kind: "inspectionScheduled", inspectionId: inspection.id, scheduleVersion: inspection.scheduleVersion },
          actorId: opts.actorId,
          quiet: opts.quiet,
          recipients: inspectionRecipients(inspection, auto.config),
          inspection,
        },
        db
      )
    : [];
  await scheduleInspectionReminders(inspectionId, opts);
  return results;
}

const INSPECTION_AUTOMATIONS: AutomationKey[] = ["inspection_confirmation", "inspection_reminder", "appointment_change"];

async function withdrawStaleInspectionEmails(inspectionId: string, reason: string, db: Db) {
  const autos = await db.automation.findMany({ where: { key: { in: INSPECTION_AUTOMATIONS } }, select: { id: true } });
  return cancelPendingEmails({ inspectionId, automationId: { in: autos.map((a) => a.id) } }, reason, db);
}

// A meaningful date/time change. The caller has already bumped
// scheduleVersion, so anything written for the old time is withdrawn here
// and would be refused by its guard even if it weren't.
export async function onInspectionRescheduled(
  inspectionId: string,
  previousScheduledAt: Date | null,
  opts: { actorId?: string | null; now?: Date; db?: Db } = {}
) {
  const db = opts.db ?? prisma;
  await withdrawStaleInspectionEmails(inspectionId, "Inspection rescheduled", db);
  if (!previousScheduledAt) return onInspectionScheduled(inspectionId, opts);

  const inspection = await loadInspection(inspectionId, db);
  if (!inspection || inspection.status !== "SCHEDULED" || !inspection.scheduledAt) return [];

  const auto = await getAutomation("appointment_change", db);
  const results = auto.active
    ? await sendToRecipients(
        {
          automationKey: "appointment_change",
          automationId: auto.row.id,
          sendMode: auto.sendMode,
          keyPrefix: `inspection:${inspection.id}:updated:v${inspection.scheduleVersion}`,
          customerTemplateKey: auto.config.updatedTemplateKey,
          realtorTemplateKey: auto.config.realtorUpdatedTemplateKey,
          guard: { kind: "inspectionScheduled", inspectionId: inspection.id, scheduleVersion: inspection.scheduleVersion },
          extraVars: { "inspection.previousDate": formatDateLong(previousScheduledAt), "inspection.previousTime": formatTime(previousScheduledAt) },
          actorId: opts.actorId,
          recipients: inspectionRecipients(inspection, auto.config),
          inspection,
        },
        db
      )
    : [];
  await scheduleInspectionReminders(inspectionId, opts);
  return results;
}

export async function onInspectionCancelled(inspectionId: string, opts: { actorId?: string | null; now?: Date; db?: Db } = {}) {
  const db = opts.db ?? prisma;
  await withdrawStaleInspectionEmails(inspectionId, "Inspection cancelled", db);
  const inspection = await loadInspection(inspectionId, db);
  // Nothing was ever scheduled, so there's nothing to tell anyone.
  if (!inspection || inspection.status !== "CANCELLED" || !inspection.scheduledAt) return [];

  const auto = await getAutomation("appointment_change", db);
  if (!auto.active) return [];
  return sendToRecipients(
    {
      automationKey: "appointment_change",
      automationId: auto.row.id,
      sendMode: auto.sendMode,
      keyPrefix: `inspection:${inspection.id}:cancelled:v${inspection.scheduleVersion}`,
      customerTemplateKey: auto.config.cancelledTemplateKey,
      realtorTemplateKey: auto.config.realtorCancelledTemplateKey,
      guard: { kind: "inspectionCancelled", inspectionId: inspection.id, scheduleVersion: inspection.scheduleVersion },
      actorId: opts.actorId,
      recipients: inspectionRecipients(inspection, auto.config),
      inspection,
    },
    db
  );
}

// Realtor thank-you: one per realtor per completed inspection, prepared for
// review by default.
export async function onInspectionCompleted(inspectionId: string, opts: { actorId?: string | null; db?: Db } = {}) {
  const db = opts.db ?? prisma;
  const auto = await getAutomation("realtor_thank_you", db);
  if (!auto.active) return [];
  const inspection = await loadInspection(inspectionId, db);
  if (!inspection || inspection.status !== "COMPLETED") return [];

  const seen = new Set<string>();
  const realtors = inspection.transaction.realtors
    .filter((tr) => auto.config.realtorRoles.includes(tr.role))
    .map((tr) => tr.realtor)
    .filter((r) => (seen.has(r.id) ? false : (seen.add(r.id), true)));

  const draft = auto.sendMode === "REVIEW";
  const results = [];
  for (const realtor of realtors) {
    const result = await enqueueEmail(
      {
        mode: draft ? "REVIEW" : "AUTOMATIC",
        draft,
        templateKey: auto.config.templateKey,
        recipient: { type: "REALTOR", name: `${realtor.firstName} ${realtor.lastName}`, email: realtor.email },
        refs: { realtorId: realtor.id, inspectionId: inspection.id, transactionId: inspection.transactionId },
        automationId: auto.row.id,
        idempotencyKey: `thank-you:inspection:${inspection.id}:realtor:${realtor.id}`,
        createdById: opts.actorId,
      },
      db
    );
    if (result.created) {
      await logAutomationEvent(
        auto.row.id,
        {
          entityType: "Realtor",
          entityId: realtor.id,
          result: result.message.status === "DRAFT" ? "PREPARED" : result.message.status,
          detail: { emailMessageId: result.message.id, recipient: result.message.recipientName, reason: result.message.statusReason },
          triggeredById: opts.actorId,
        },
        db
      );
    }
    results.push(result);
  }
  return results;
}

// Safety net run by the worker: if an event hook was ever missed (crash
// between saving the inspection and queuing its email), this catches up.
// Limited to inspections created after the automation existed, so turning
// the system on never back-fills email to every existing customer.
export async function sweepInspectionEmails(now: Date, db: Db = prisma) {
  const confirmation = await getAutomation("inspection_confirmation", db);
  const since = confirmation.row.createdAt;
  const inspections = await db.inspection.findMany({
    where: { status: "SCHEDULED", scheduledAt: { gt: now }, createdAt: { gte: since } },
    select: { id: true },
    take: 500,
  });
  for (const { id } of inspections) {
    await onInspectionScheduled(id, { now, db, quiet: true });
  }
}
