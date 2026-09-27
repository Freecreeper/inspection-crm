"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import type { EmailCategory, EmailRecipientType, EmailSendMode, Prisma, Role } from "@prisma/client";
import { prisma } from "@/lib/prisma";
import { auth } from "@/lib/auth";
import { assertCan, can, type Permission } from "@/lib/rbac";
import { logActivity } from "@/lib/activity";
import { loadEmailVariables } from "@/lib/email/context";
import { checkEligibility, normalizeEmail } from "@/lib/email/eligibility";
import { listComposeRecipients, parseComposeContext, type ComposeContext, type ComposeRecipient } from "@/lib/email/composer";
import { enqueueEmail } from "@/lib/email/queue";
import { redactSendTime, renderSubjectAndBody } from "@/lib/email/render";
import { getEmailSettings } from "@/lib/email/settings";
import { ensureEmailSystem, runEmailTick } from "@/lib/email/system";
import { AUTOMATIONS, parseAutomationConfig, type AutomationKey } from "@/lib/email/automations/registry";
import { AudienceSchema, previewAudience, type AudiencePreview } from "@/lib/email/campaigns";
import { TEMPLATE_VARIABLES } from "@/lib/email/variables";

export type Result<T = undefined> = { ok: true; data: T } | { ok: false; error: string };

async function requirePermission(permission: Permission) {
  const session = await auth();
  if (!session?.user) throw new Error("Not signed in.");
  const role = session.user.role as Role | undefined;
  assertCan(role, permission);
  return { userId: session.user.id ?? null, role };
}

const LABELS = new Map(TEMPLATE_VARIABLES.map((v) => [v.key, v.label]));

// ---------------------------------------------------------------------------
// Composer
// ---------------------------------------------------------------------------

export interface ComposerData {
  recipients: (Omit<ComposeRecipient, "refs"> & { eligibility: string | null })[];
  templates: { id: string; key: string; name: string; category: EmailCategory; recipientType: EmailRecipientType; subject: string; body: string }[];
  draft: { id: string; recipientKey: string; subject: string; body: string; templateId: string | null; category: EmailCategory; mode: EmailSendMode } | null;
  canSend: boolean;
}

// Everything the composer needs, decided server-side: who can be emailed
// from here (and whether each one currently can be), and which templates fit.
export async function getComposerData(rawContext: unknown, draftId?: string | null): Promise<ComposerData> {
  const { role } = await requirePermission("email:view");
  await ensureEmailSystem();
  const context = parseComposeContext(rawContext);
  if (!context) throw new Error("Invalid context.");

  const [recipients, templates, settings, draft] = await Promise.all([
    listComposeRecipients(context),
    prisma.emailTemplate.findMany({ where: { active: true }, orderBy: [{ category: "asc" }, { name: "asc" }] }),
    getEmailSettings(),
    draftId ? prisma.emailMessage.findUnique({ where: { id: draftId } }) : null,
  ]);

  const withEligibility = await Promise.all(
    recipients.map(async ({ refs, ...r }) => {
      const realtor = r.type === "REALTOR" && refs.realtorId ? await prisma.realtor.findUnique({ where: { id: refs.realtorId } }) : null;
      // Shown for the operational case; the chosen template's category is
      // re-checked on send.
      const e = await checkEligibility({
        category: "TRANSACTIONAL",
        recipientType: r.type,
        email: r.email,
        realtor,
        marketingRequiresOptIn: settings.marketingRequiresOptIn,
      });
      return { ...r, eligibility: e.ok ? null : e.reason };
    })
  );

  const draftRecipientKey = draft ? (draft.customerId ? `customer:${draft.customerId}` : draft.realtorId ? `realtor:${draft.realtorId}` : "") : "";
  return {
    recipients: withEligibility,
    templates: templates.map((t) => ({ id: t.id, key: t.key, name: t.name, category: t.category, recipientType: t.recipientType, subject: t.subject, body: t.body })),
    draft:
      draft && draft.status === "DRAFT"
        ? { id: draft.id, recipientKey: draftRecipientKey, subject: draft.subject, body: draft.bodyText, templateId: draft.templateId, category: draft.category, mode: draft.mode }
        : null,
    canSend: can(role, "email:send"),
  };
}

const ComposeSchema = z.object({
  context: z.unknown(),
  recipientKey: z.string().min(1),
  templateId: z.string().nullable(),
  subject: z.string().max(300),
  body: z.string().max(20000),
  draftId: z.string().nullable().optional(),
});

async function resolveComposeRecipient(context: ComposeContext, key: string) {
  const recipients = await listComposeRecipients(context);
  // Only a recipient the server itself offered for this record can be used.
  return recipients.find((r) => r.key === key) ?? null;
}

export interface PreviewResult {
  subject: string;
  body: string;
  missing: string[];
  unknown: string[];
  category: EmailCategory;
  recipient: { name: string; email: string | null; blockedReason: string | null };
}

export async function previewComposedEmail(input: z.input<typeof ComposeSchema>): Promise<Result<PreviewResult>> {
  await requirePermission("email:view");
  const parsed = ComposeSchema.safeParse(input);
  if (!parsed.success) return { ok: false, error: "Invalid email." };
  const context = parseComposeContext(parsed.data.context);
  if (!context) return { ok: false, error: "Invalid context." };
  const recipient = await resolveComposeRecipient(context, parsed.data.recipientKey);
  if (!recipient) return { ok: false, error: "Pick a recipient." };

  const template = parsed.data.templateId ? await prisma.emailTemplate.findUnique({ where: { id: parsed.data.templateId } }) : null;
  const category = template?.category ?? "TRANSACTIONAL";
  const [vars, settings] = await Promise.all([loadEmailVariables(recipient.refs), getEmailSettings()]);
  const rendered = renderSubjectAndBody(parsed.data.subject, parsed.data.body, vars);
  const realtor = recipient.type === "REALTOR" && recipient.refs.realtorId ? await prisma.realtor.findUnique({ where: { id: recipient.refs.realtorId } }) : null;
  const eligibility = await checkEligibility({ category, recipientType: recipient.type, email: recipient.email, realtor, marketingRequiresOptIn: settings.marketingRequiresOptIn });

  return {
    ok: true,
    data: {
      subject: redactSendTime(rendered.subject),
      body: redactSendTime(rendered.body),
      missing: rendered.missing.map((k) => LABELS.get(k) ?? k),
      unknown: rendered.unknown,
      category,
      recipient: { name: recipient.name, email: recipient.email, blockedReason: eligibility.ok ? null : eligibility.reason },
    },
  };
}

// Save Draft or Send. "Send" queues the email; the worker delivers it.
// Sending refuses unresolved placeholders — a person must fill them in.
export async function submitComposedEmail(input: z.input<typeof ComposeSchema> & { action: "draft" | "send" }): Promise<Result<{ id: string; status: string }>> {
  const { userId } = await requirePermission("email:send");
  const parsed = ComposeSchema.safeParse(input);
  if (!parsed.success) return { ok: false, error: "Invalid email." };
  const context = parseComposeContext(parsed.data.context);
  if (!context) return { ok: false, error: "Invalid context." };
  const recipient = await resolveComposeRecipient(context, parsed.data.recipientKey);
  if (!recipient) return { ok: false, error: "Pick a recipient." };
  if (!parsed.data.subject.trim()) return { ok: false, error: "Add a subject." };
  if (!parsed.data.body.trim()) return { ok: false, error: "Add a message." };

  const template = parsed.data.templateId ? await prisma.emailTemplate.findUnique({ where: { id: parsed.data.templateId } }) : null;
  const vars = await loadEmailVariables(recipient.refs);
  const rendered = renderSubjectAndBody(parsed.data.subject, parsed.data.body, vars);
  if (input.action === "send" && (rendered.missing.length || rendered.unknown.length)) {
    const fields = [...rendered.missing.map((k) => LABELS.get(k) ?? k), ...rendered.unknown.map((k) => `{{${k}}}`)];
    return { ok: false, error: `Fill in or remove before sending: ${fields.join(", ")}` };
  }

  // Reviewing a prepared draft keeps its origin (REVIEW, automation link,
  // idempotency key) so it still counts as that one business event.
  const existingDraft = parsed.data.draftId ? await prisma.emailMessage.findUnique({ where: { id: parsed.data.draftId } }) : null;
  if (existingDraft) {
    if (existingDraft.status !== "DRAFT") return { ok: false, error: "This email was already sent or discarded." };
    const now = new Date();
    const settings = await getEmailSettings();
    const realtor = recipient.type === "REALTOR" && recipient.refs.realtorId ? await prisma.realtor.findUnique({ where: { id: recipient.refs.realtorId } }) : null;
    const eligibility =
      input.action === "send"
        ? await checkEligibility({
            category: existingDraft.category,
            recipientType: recipient.type,
            email: recipient.email,
            realtor,
            marketingRequiresOptIn: settings.marketingRequiresOptIn,
          })
        : { ok: true as const };
    const updated = await prisma.emailMessage.update({
      where: { id: existingDraft.id },
      data: {
        subject: rendered.subject,
        bodyText: rendered.body,
        templateId: template?.id ?? existingDraft.templateId,
        recipientEmail: recipient.email,
        recipientName: recipient.name,
        ...(input.action === "send"
          ? eligibility.ok
            ? { status: "QUEUED", queuedAt: now, statusReason: null, createdById: userId }
            : { status: eligibility.status, statusReason: eligibility.reason }
          : {}),
      },
    });
    if (input.action === "send") {
      await logActivity(prisma, { actorId: userId, action: "email.reviewed_and_sent", entityType: "EmailMessage", entityId: updated.id, after: { status: updated.status } });
    }
    revalidateEmailPaths(recipient.refs);
    return eligibility.ok ? { ok: true, data: { id: updated.id, status: updated.status } } : { ok: false, error: eligibility.reason };
  }

  const { message } = await enqueueEmail({
    mode: "MANUAL",
    draft: input.action === "draft",
    category: template?.category ?? "TRANSACTIONAL",
    templateId: template?.id,
    subject: parsed.data.subject,
    body: parsed.data.body,
    recipient: { type: recipient.type, name: recipient.name, email: recipient.email },
    refs: recipient.refs,
    createdById: userId,
  });
  if (input.action === "send") {
    await logActivity(prisma, {
      actorId: userId,
      action: "email.manual_sent",
      entityType: "EmailMessage",
      entityId: message.id,
      after: { status: message.status, recipient: recipient.name, templateId: template?.id ?? null },
    });
  }
  revalidateEmailPaths(recipient.refs);
  if (message.status === "SKIPPED" || message.status === "SUPPRESSED") return { ok: false, error: message.statusReason ?? "This recipient can't be emailed." };
  return { ok: true, data: { id: message.id, status: message.status } };
}

function revalidateEmailPaths(refs: { realtorId?: string | null; customerId?: string | null; transactionId?: string | null; inspectionId?: string | null }) {
  revalidatePath("/email");
  if (refs.realtorId) revalidatePath(`/realtors/${refs.realtorId}`);
  if (refs.customerId) revalidatePath(`/customers/${refs.customerId}`);
  if (refs.transactionId) revalidatePath(`/transactions/${refs.transactionId}`);
  if (refs.inspectionId) revalidatePath(`/inspections/${refs.inspectionId}`);
}

// ---------------------------------------------------------------------------
// Message actions
// ---------------------------------------------------------------------------

export async function discardDraft(id: string): Promise<Result> {
  const { userId } = await requirePermission("email:send");
  const { count } = await prisma.emailMessage.updateMany({
    where: { id, status: "DRAFT" },
    data: { status: "CANCELLED", statusReason: "Discarded by staff", cancelledAt: new Date() },
  });
  if (count === 0) return { ok: false, error: "Only a draft can be discarded." };
  await logActivity(prisma, { actorId: userId, action: "email.draft_discarded", entityType: "EmailMessage", entityId: id });
  revalidatePath("/email");
  return { ok: true, data: undefined };
}

export async function cancelEmail(id: string): Promise<Result> {
  const { userId } = await requirePermission("email:send");
  const { count } = await prisma.emailMessage.updateMany({
    where: { id, status: { in: ["SCHEDULED", "QUEUED"] } },
    data: { status: "CANCELLED", statusReason: "Cancelled by staff", cancelledAt: new Date() },
  });
  if (count === 0) return { ok: false, error: "Only a scheduled or queued email can be cancelled." };
  await logActivity(prisma, { actorId: userId, action: "email.cancelled", entityType: "EmailMessage", entityId: id });
  revalidatePath("/email");
  return { ok: true, data: undefined };
}

// Tries a failed or skipped email again, re-reading the recipient's current
// address (e.g. after staff add a missing email) and every rule.
export async function retryEmail(id: string): Promise<Result<{ status: string }>> {
  const { userId } = await requirePermission("email:send");
  const message = await prisma.emailMessage.findUnique({ where: { id }, include: { customer: true, realtor: true } });
  if (!message || !["FAILED", "SKIPPED"].includes(message.status)) return { ok: false, error: "Only a failed or skipped email can be retried." };

  const email = message.customer?.email ?? message.realtor?.email ?? message.recipientEmail;
  const settings = await getEmailSettings();
  const eligibility = await checkEligibility({
    category: message.category,
    recipientType: message.recipientType,
    email,
    realtor: message.recipientType === "REALTOR" ? message.realtor : null,
    marketingRequiresOptIn: settings.marketingRequiresOptIn,
  });
  const now = new Date();
  // A reminder whose send time is still ahead goes back to waiting for it.
  const future = message.scheduledFor && message.scheduledFor > now;
  const data: Prisma.EmailMessageUpdateInput = eligibility.ok
    ? future
      ? { status: "SCHEDULED", nextAttemptAt: null, failedAt: null, statusReason: null, recipientEmail: email }
      : { status: "QUEUED", queuedAt: now, nextAttemptAt: null, failedAt: null, statusReason: null, recipientEmail: email }
    : { status: eligibility.status, statusReason: eligibility.reason, recipientEmail: email };
  const updated = await prisma.emailMessage.update({ where: { id }, data });
  await logActivity(prisma, { actorId: userId, action: "email.retried", entityType: "EmailMessage", entityId: id, after: { status: updated.status } });
  revalidatePath("/email");
  revalidatePath(`/email/messages/${id}`);
  return eligibility.ok ? { ok: true, data: { status: updated.status } } : { ok: false, error: eligibility.reason };
}

// Runs one worker pass from the UI — for development and for staff who
// don't want to wait for the next scheduled tick.
export async function processEmailQueueNow(): Promise<Result<{ sent: number; failed: number; other: number }>> {
  await requirePermission("email:automation_manage");
  const summary = await runEmailTick({ forceSweep: true });
  revalidatePath("/email");
  return { ok: true, data: { sent: summary.sent, failed: summary.failed, other: summary.other } };
}

// ---------------------------------------------------------------------------
// Templates
// ---------------------------------------------------------------------------

const TemplateSchema = z.object({
  name: z.string().trim().min(1, "Name is required.").max(120),
  description: z.string().trim().max(300).nullable(),
  category: z.enum(["TRANSACTIONAL", "RELATIONSHIP", "MARKETING"]),
  recipientType: z.enum(["CUSTOMER", "REALTOR", "OTHER"]),
  subject: z.string().trim().min(1, "Subject is required.").max(300),
  body: z.string().trim().min(1, "Body is required.").max(20000),
  active: z.boolean(),
});

function templateErrors(subject: string, body: string): string | null {
  const unknown = renderSubjectAndBody(subject, body, {}).unknown;
  return unknown.length ? `Unknown fields: ${unknown.map((k) => `{{${k}}}`).join(", ")}` : null;
}

export async function saveTemplate(id: string | null, input: z.input<typeof TemplateSchema>): Promise<Result<{ id: string }>> {
  const { userId } = await requirePermission("email:template_manage");
  const parsed = TemplateSchema.safeParse(input);
  if (!parsed.success) return { ok: false, error: parsed.error.issues[0]?.message ?? "Invalid template." };
  const error = templateErrors(parsed.data.subject, parsed.data.body);
  if (error) return { ok: false, error };

  if (id) {
    const before = await prisma.emailTemplate.findUnique({ where: { id } });
    if (!before) return { ok: false, error: "Template not found." };
    await prisma.emailTemplate.update({ where: { id }, data: { ...parsed.data, updatedById: userId } });
    await logActivity(prisma, {
      actorId: userId,
      action: "email.template_updated",
      entityType: "EmailTemplate",
      entityId: id,
      before: { subject: before.subject, active: before.active, category: before.category },
      after: { subject: parsed.data.subject, active: parsed.data.active, category: parsed.data.category },
    });
    revalidatePath("/email/templates");
    return { ok: true, data: { id } };
  }

  const slug = parsed.data.name.toLowerCase().replace(/[^a-z0-9]+/g, "_").replace(/^_|_$/g, "").slice(0, 40) || "template";
  const created = await prisma.emailTemplate.create({
    data: { ...parsed.data, key: `${slug}_${Date.now().toString(36)}`, automationEligible: false, createdById: userId, updatedById: userId },
  });
  await logActivity(prisma, { actorId: userId, action: "email.template_created", entityType: "EmailTemplate", entityId: created.id, after: { name: created.name } });
  revalidatePath("/email/templates");
  return { ok: true, data: { id: created.id } };
}

// Preview against clearly-labeled sample data, or against a real record.
export async function previewTemplate(input: { subject: string; body: string; context?: unknown }): Promise<Result<{ subject: string; body: string; missing: string[]; unknown: string[]; usingSample: boolean }>> {
  await requirePermission("email:template_manage");
  const context = input.context ? parseComposeContext(input.context) : null;
  let vars: Record<string, string | null | undefined>;
  let usingSample = true;
  if (context) {
    const [first] = await listComposeRecipients(context);
    if (!first) return { ok: false, error: "That record has no one to email." };
    vars = await loadEmailVariables(first.refs);
    usingSample = false;
  } else {
    vars = Object.fromEntries(TEMPLATE_VARIABLES.map((v) => [v.key, `[${v.sample}]`]));
  }
  const rendered = renderSubjectAndBody(input.subject, input.body, vars);
  return {
    ok: true,
    data: {
      subject: redactSendTime(rendered.subject),
      body: redactSendTime(rendered.body),
      missing: rendered.missing.map((k) => LABELS.get(k) ?? k),
      unknown: rendered.unknown,
      usingSample,
    },
  };
}

// ---------------------------------------------------------------------------
// Automations & settings
// ---------------------------------------------------------------------------

export async function updateAutomation(key: string, input: { active: boolean; sendMode: EmailSendMode; config: unknown }): Promise<Result> {
  const { userId } = await requirePermission("email:automation_manage");
  if (!(key in AUTOMATIONS)) return { ok: false, error: "Unknown automation." };
  const k = key as AutomationKey;
  if (!["AUTOMATIC", "REVIEW"].includes(input.sendMode)) return { ok: false, error: "Pick automatic or review-before-send." };
  // A report email goes to a recipient chosen at delivery time, straight
  // from that decision — there's no separate review step to put it in.
  if (k === "report_ready" && input.sendMode !== "AUTOMATIC") return { ok: false, error: "Report emails are sent when staff deliver the report." };
  const parsed = AUTOMATIONS[k].config.safeParse(input.config);
  if (!parsed.success) return { ok: false, error: parsed.error.issues[0]?.message ?? "Invalid settings." };

  await ensureEmailSystem();
  const before = await prisma.automation.findUniqueOrThrow({ where: { key } });
  await prisma.automation.update({
    where: { key },
    data: { active: input.active, sendMode: input.sendMode, actions: parsed.data as Prisma.InputJsonValue },
  });
  await logActivity(prisma, {
    actorId: userId,
    action: before.active !== input.active ? (input.active ? "email.automation_enabled" : "email.automation_disabled") : "email.automation_updated",
    entityType: "Automation",
    entityId: before.id,
    before: { active: before.active, sendMode: before.sendMode, config: parseAutomationConfig(k, before.actions) as Prisma.InputJsonValue },
    after: { active: input.active, sendMode: input.sendMode, config: parsed.data as Prisma.InputJsonValue },
  });
  revalidatePath("/email/automations");
  return { ok: true, data: undefined };
}

const SettingsSchema = z.object({
  companyName: z.string().trim().min(1).max(120),
  fromName: z.string().trim().min(1).max(120),
  fromEmail: z.union([z.email(), z.literal("")]).transform((v) => v || null),
  replyTo: z.union([z.email(), z.literal("")]).transform((v) => v || null),
  signature: z.string().max(2000),
  companyPhone: z.string().trim().max(40).transform((v) => v || null),
  companyWebsite: z.string().trim().max(200).transform((v) => v || null),
  mailingAddress: z.string().trim().max(300).transform((v) => v || null),
  inspectionPrepInstructions: z.string().trim().max(2000).transform((v) => v || null),
  marketingRequiresOptIn: z.boolean(),
  campaignSendsPerMinute: z.number().int().min(1).max(600),
});

export async function updateEmailSettings(input: z.input<typeof SettingsSchema>): Promise<Result> {
  const { userId } = await requirePermission("email:automation_manage");
  const parsed = SettingsSchema.safeParse(input);
  if (!parsed.success) return { ok: false, error: parsed.error.issues[0]?.message ?? "Invalid settings." };
  await getEmailSettings();
  await prisma.emailSettings.update({ where: { id: "default" }, data: { ...parsed.data, updatedById: userId } });
  await logActivity(prisma, { actorId: userId, action: "email.settings_updated", entityType: "EmailSettings", entityId: "default", after: { marketingRequiresOptIn: parsed.data.marketingRequiresOptIn } });
  revalidatePath("/email/settings");
  return { ok: true, data: undefined };
}

// ---------------------------------------------------------------------------
// Suppression
// ---------------------------------------------------------------------------

export async function addSuppression(input: { email: string; scope: "ALL" | "NON_TRANSACTIONAL" | "MARKETING"; reason: string }): Promise<Result> {
  const { userId } = await requirePermission("email:preferences_manage");
  const email = z.email().safeParse(input.email.trim());
  if (!email.success) return { ok: false, error: "Enter a valid email address." };
  const address = normalizeEmail(email.data);
  await prisma.emailSuppression.upsert({
    where: { email_scope: { email: address, scope: input.scope } },
    update: {},
    create: { email: address, scope: input.scope, reason: input.reason.trim() || "Added by staff", source: "manual", createdById: userId },
  });
  await logActivity(prisma, { actorId: userId, action: "email.suppression_added", entityType: "EmailSuppression", entityId: address, after: { scope: input.scope } });
  revalidatePath("/email/settings");
  return { ok: true, data: undefined };
}

export async function removeSuppression(id: string): Promise<Result> {
  const { userId } = await requirePermission("email:preferences_manage");
  const row = await prisma.emailSuppression.findUnique({ where: { id } });
  if (!row) return { ok: false, error: "Not found." };
  await prisma.emailSuppression.delete({ where: { id } });
  await logActivity(prisma, { actorId: userId, action: "email.suppression_removed", entityType: "EmailSuppression", entityId: row.email, before: { scope: row.scope, reason: row.reason } });
  revalidatePath("/email/settings");
  return { ok: true, data: undefined };
}

// ---------------------------------------------------------------------------
// Campaigns
// ---------------------------------------------------------------------------

const CampaignSchema = z.object({
  name: z.string().trim().min(1, "Name is required.").max(120),
  category: z.enum(["RELATIONSHIP", "MARKETING"]),
  templateId: z.string().min(1, "Pick a template."),
  subject: z.string().trim().min(1, "Subject is required.").max(300),
  body: z.string().trim().min(1, "Body is required.").max(20000),
  audience: AudienceSchema,
});

export async function saveCampaign(id: string | null, input: z.input<typeof CampaignSchema>): Promise<Result<{ id: string }>> {
  const { userId } = await requirePermission("email:campaign_create");
  const parsed = CampaignSchema.safeParse(input);
  if (!parsed.success) return { ok: false, error: parsed.error.issues[0]?.message ?? "Invalid campaign." };
  const error = templateErrors(parsed.data.subject, parsed.data.body);
  if (error) return { ok: false, error };
  const template = await prisma.emailTemplate.findUnique({ where: { id: parsed.data.templateId } });
  if (!template || template.recipientType !== "REALTOR") return { ok: false, error: "Pick a realtor template." };
  // Marketing content can't be sent as "relationship" to get around
  // marketing preferences.
  if (template.category === "MARKETING" && parsed.data.category !== "MARKETING") return { ok: false, error: "A marketing template can only be used in a marketing campaign." };

  const data = { ...parsed.data, audience: parsed.data.audience as Prisma.InputJsonValue };
  if (id) {
    const existing = await prisma.emailCampaign.findUnique({ where: { id } });
    if (!existing) return { ok: false, error: "Campaign not found." };
    if (existing.status !== "DRAFT" && existing.status !== "READY_FOR_REVIEW") return { ok: false, error: "Only a campaign that hasn't been approved can be edited." };
    // Any edit sends it back to draft: approval covers exactly what was reviewed.
    await prisma.emailCampaign.update({ where: { id }, data: { ...data, status: "DRAFT", submittedAt: null } });
    await logActivity(prisma, { actorId: userId, action: "email.campaign_updated", entityType: "EmailCampaign", entityId: id });
    revalidatePath(`/email/campaigns/${id}`);
    return { ok: true, data: { id } };
  }
  const created = await prisma.emailCampaign.create({ data: { ...data, createdById: userId } });
  await logActivity(prisma, { actorId: userId, action: "email.campaign_created", entityType: "EmailCampaign", entityId: created.id, after: { name: created.name, category: created.category } });
  revalidatePath("/email/campaigns");
  return { ok: true, data: { id: created.id } };
}

export async function getAudiencePreview(input: { audience: unknown; category: "RELATIONSHIP" | "MARKETING" }): Promise<Result<AudiencePreview>> {
  await requirePermission("email:campaign_create");
  const audience = AudienceSchema.safeParse(input.audience);
  if (!audience.success) return { ok: false, error: "Invalid audience." };
  return { ok: true, data: await previewAudience(audience.data, input.category) };
}

export async function submitCampaignForReview(id: string): Promise<Result> {
  const { userId } = await requirePermission("email:campaign_create");
  const { count } = await prisma.emailCampaign.updateMany({ where: { id, status: "DRAFT" }, data: { status: "READY_FOR_REVIEW", submittedAt: new Date() } });
  if (count === 0) return { ok: false, error: "Only a draft can be submitted." };
  await logActivity(prisma, { actorId: userId, action: "email.campaign_submitted", entityType: "EmailCampaign", entityId: id });
  revalidatePath(`/email/campaigns/${id}`);
  return { ok: true, data: undefined };
}

// Human approval is the only thing that lets a campaign send. The worker
// materializes recipients at the scheduled time, re-checking eligibility.
export async function approveCampaign(id: string, input: { sendAt: string | null }): Promise<Result> {
  const { userId } = await requirePermission("email:campaign_approve");
  const sendAt = input.sendAt ? new Date(input.sendAt) : new Date();
  if (Number.isNaN(sendAt.getTime())) return { ok: false, error: "Pick a valid send time." };
  const { count } = await prisma.emailCampaign.updateMany({
    where: { id, status: "READY_FOR_REVIEW" },
    data: { status: "SCHEDULED", scheduledAt: sendAt, approvedAt: new Date(), approvedById: userId },
  });
  if (count === 0) return { ok: false, error: "Only a campaign that's ready for review can be approved." };
  await logActivity(prisma, { actorId: userId, action: "email.campaign_approved", entityType: "EmailCampaign", entityId: id, after: { sendAt: sendAt.toISOString() } });
  revalidatePath(`/email/campaigns/${id}`);
  return { ok: true, data: undefined };
}

// Stops a campaign; every recipient email that hasn't gone out is withdrawn
// (and each one's guard would refuse it anyway).
export async function cancelCampaign(id: string): Promise<Result> {
  const { userId, role } = await requirePermission("email:campaign_create");
  const campaign = await prisma.emailCampaign.findUnique({ where: { id } });
  if (!campaign) return { ok: false, error: "Campaign not found." };
  if (["SCHEDULED", "RUNNING"].includes(campaign.status) && !can(role, "email:campaign_approve")) {
    return { ok: false, error: "Only an approver can cancel an approved campaign." };
  }
  if (campaign.status === "COMPLETED" || campaign.status === "CANCELLED") return { ok: false, error: `The campaign is already ${campaign.status.toLowerCase()}.` };
  await prisma.$transaction([
    prisma.emailCampaign.update({ where: { id }, data: { status: "CANCELLED", cancelledAt: new Date() } }),
    prisma.emailMessage.updateMany({
      where: { campaignId: id, status: { in: ["QUEUED", "SCHEDULED", "DRAFT"] } },
      data: { status: "CANCELLED", statusReason: "Campaign cancelled", cancelledAt: new Date() },
    }),
  ]);
  await logActivity(prisma, { actorId: userId, action: "email.campaign_cancelled", entityType: "EmailCampaign", entityId: id });
  revalidatePath(`/email/campaigns/${id}`);
  return { ok: true, data: undefined };
}
