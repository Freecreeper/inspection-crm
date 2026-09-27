import { z } from "zod";
import type { Automation, EmailSendMode, Prisma, PrismaClient } from "@prisma/client";
import { prisma } from "@/lib/prisma";

type Db = PrismaClient | Prisma.TransactionClient;

// Every email automation the engine knows about. Rows in the existing
// `automations` table (matched by key) hold what staff can change without
// code: on/off, send mode, and the settings validated by `config` below.

const inspectionRecipients = z.object({
  // "all" = every customer on the transaction; "primary" = primary contact only.
  customers: z.enum(["all", "primary"]).default("all"),
  // Realtors only ever receive these when explicitly turned on, and only in
  // the listed transaction roles.
  includeRealtors: z.boolean().default(false),
  realtorRoles: z.array(z.enum(["BUYER_AGENT", "LISTING_AGENT", "TRANSACTION_COORDINATOR", "OTHER"])).default(["BUYER_AGENT"]),
});

export const AUTOMATIONS = {
  inspection_confirmation: {
    name: "Inspection confirmation",
    description: "Sent when an inspection is scheduled with a date and time.",
    trigger: "inspection.scheduled",
    category: "TRANSACTIONAL",
    defaultMode: "AUTOMATIC",
    defaultActive: true,
    config: inspectionRecipients.extend({
      templateKey: z.string().default("inspection_confirmation"),
      realtorTemplateKey: z.string().default("inspection_confirmation_realtor"),
    }),
  },
  inspection_reminder: {
    name: "Inspection reminder",
    description: "Sent before a scheduled inspection. Dropped automatically if the inspection moves or is cancelled.",
    trigger: "inspection.reminder_due",
    category: "TRANSACTIONAL",
    defaultMode: "AUTOMATIC",
    defaultActive: true,
    config: inspectionRecipients.extend({
      hoursBefore: z.number().int().min(1).max(168).default(24),
      templateKey: z.string().default("inspection_reminder"),
      realtorTemplateKey: z.string().default("inspection_reminder_realtor"),
    }),
  },
  appointment_change: {
    name: "Appointment changed / cancelled",
    description: "Sent when an inspection's date or time changes, or it is cancelled. Other edits never trigger it.",
    trigger: "inspection.rescheduled",
    category: "TRANSACTIONAL",
    defaultMode: "AUTOMATIC",
    defaultActive: true,
    config: inspectionRecipients.extend({
      updatedTemplateKey: z.string().default("appointment_updated"),
      cancelledTemplateKey: z.string().default("appointment_cancelled"),
      realtorUpdatedTemplateKey: z.string().default("appointment_updated_realtor"),
      realtorCancelledTemplateKey: z.string().default("appointment_cancelled_realtor"),
    }),
  },
  payment_reminder: {
    name: "Payment reminder",
    description: "Sent to the transaction's primary customer while an issued invoice has a balance due.",
    trigger: "invoice.balance_due",
    category: "TRANSACTIONAL",
    defaultMode: "AUTOMATIC",
    defaultActive: false,
    config: z.object({
      templateKey: z.string().default("payment_reminder"),
      daysBeforeDue: z.number().int().min(0).max(30).default(3),
      overdueRepeatDays: z.number().int().min(1).max(60).default(7),
      maxOverdueReminders: z.number().int().min(0).max(10).default(3),
    }),
  },
  report_ready: {
    name: "Report ready",
    description:
      "Emails the secure report link when staff deliver a finalized report version to an explicitly chosen recipient. Never sent to anyone automatically chosen.",
    trigger: "report.delivery_created",
    category: "TRANSACTIONAL",
    defaultMode: "AUTOMATIC",
    defaultActive: true,
    config: z.object({ templateKey: z.string().default("report_ready") }),
  },
  realtor_thank_you: {
    name: "Realtor thank-you",
    description: "Prepared for each realtor on a transaction when its inspection is completed.",
    trigger: "inspection.completed",
    category: "RELATIONSHIP",
    defaultMode: "REVIEW",
    defaultActive: true,
    config: z.object({
      templateKey: z.string().default("realtor_thank_you"),
      realtorRoles: z.array(z.enum(["BUYER_AGENT", "LISTING_AGENT", "TRANSACTION_COORDINATOR", "OTHER"])).default(["BUYER_AGENT", "LISTING_AGENT"]),
    }),
  },
  realtor_birthday: {
    name: "Realtor birthday",
    description: "Prepared ahead of a realtor's birthday, for realtors who have one on file.",
    trigger: "realtor.birthday",
    category: "RELATIONSHIP",
    defaultMode: "REVIEW",
    defaultActive: true,
    config: z.object({ templateKey: z.string().default("realtor_birthday"), daysBefore: z.number().int().min(0).max(14).default(1) }),
  },
  realtor_anniversary: {
    name: "Realtor anniversaries",
    description: "Prepared on a realtor's career anniversary and on the anniversary of working together, when those dates are on file.",
    trigger: "realtor.anniversary",
    category: "RELATIONSHIP",
    defaultMode: "REVIEW",
    defaultActive: true,
    config: z.object({
      careerTemplateKey: z.string().default("realtor_career_anniversary"),
      relationshipTemplateKey: z.string().default("realtor_relationship_anniversary"),
      daysBefore: z.number().int().min(0).max(14).default(0),
      career: z.boolean().default(true),
      relationship: z.boolean().default(true),
    }),
  },
} as const satisfies Record<
  string,
  {
    name: string;
    description: string;
    trigger: string;
    category: "TRANSACTIONAL" | "RELATIONSHIP" | "MARKETING";
    defaultMode: EmailSendMode;
    defaultActive: boolean;
    config: z.ZodType;
  }
>;

export type AutomationKey = keyof typeof AUTOMATIONS;
export type AutomationConfig<K extends AutomationKey> = z.infer<(typeof AUTOMATIONS)[K]["config"]>;
export const AUTOMATION_KEYS = Object.keys(AUTOMATIONS) as AutomationKey[];

export interface ResolvedAutomation<K extends AutomationKey> {
  row: Automation;
  active: boolean;
  sendMode: EmailSendMode;
  config: AutomationConfig<K>;
}

export function parseAutomationConfig<K extends AutomationKey>(key: K, raw: unknown): AutomationConfig<K> {
  const parsed = AUTOMATIONS[key].config.safeParse(raw ?? {});
  // A malformed stored config falls back to the defaults rather than
  // sending something unexpected.
  return (parsed.success ? parsed.data : AUTOMATIONS[key].config.parse({})) as AutomationConfig<K>;
}

export async function ensureAutomationRow(key: AutomationKey, db: Db = prisma): Promise<Automation> {
  const def = AUTOMATIONS[key];
  return db.automation.upsert({
    where: { key },
    update: {},
    create: {
      key,
      name: def.name,
      description: def.description,
      triggerEvent: def.trigger,
      sendMode: def.defaultMode,
      active: def.defaultActive,
      actions: def.config.parse({}) as Prisma.InputJsonValue,
    },
  });
}

export async function getAutomation<K extends AutomationKey>(key: K, db: Db = prisma): Promise<ResolvedAutomation<K>> {
  const row = (await db.automation.findUnique({ where: { key } })) ?? (await ensureAutomationRow(key, db));
  return { row, active: row.active, sendMode: row.sendMode, config: parseAutomationConfig(key, row.actions) };
}

export async function logAutomationEvent(
  automationId: string,
  entry: { entityType: string; entityId: string; result: string; detail?: Record<string, unknown>; triggeredById?: string | null },
  db: Db = prisma
) {
  return db.automationEvent.create({
    data: {
      automationId,
      entityType: entry.entityType,
      entityId: entry.entityId,
      result: entry.result,
      detail: (entry.detail ?? undefined) as Prisma.InputJsonValue | undefined,
      triggeredById: entry.triggeredById ?? null,
    },
  });
}
