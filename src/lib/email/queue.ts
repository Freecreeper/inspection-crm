import { Prisma, type EmailCategory, type EmailMessage, type EmailRecipientType, type EmailSendMode, type PrismaClient } from "@prisma/client";
import { prisma } from "@/lib/prisma";
import { loadEmailVariables, type EmailRefs } from "./context";
import { checkEligibility } from "./eligibility";
import type { GuardData } from "./guards";
import { renderSubjectAndBody } from "./render";
import { getEmailSettings } from "./settings";
import { TEMPLATE_VARIABLES } from "./variables";

type Db = PrismaClient | Prisma.TransactionClient;

export interface EnqueueEmailInput {
  mode: EmailSendMode;
  category?: EmailCategory;
  templateKey?: string;
  templateId?: string;
  // Content a person wrote or approved; replaces the template's copy.
  subject?: string;
  body?: string;
  recipient: { type: EmailRecipientType; name: string; email: string | null };
  refs: EmailRefs;
  automationId?: string | null;
  campaignId?: string | null;
  idempotencyKey?: string | null;
  guard?: GuardData;
  scheduledFor?: Date | null;
  // Prepare for a person to review instead of sending (REVIEW mode).
  draft?: boolean;
  // Record this email as SKIPPED for a reason decided by the caller (e.g. a
  // duplicate address in a campaign audience) — it is never sent.
  skipReason?: string;
  createdById?: string | null;
  now?: Date;
}

export interface EnqueueResult {
  message: EmailMessage;
  // False when an email for this idempotency key already existed — the
  // same business event never produces a second email.
  created: boolean;
}

const LABELS = new Map(TEMPLATE_VARIABLES.map((v) => [v.key, v.label]));
export const describeVariables = (keys: string[]) => keys.map((k) => LABELS.get(k) ?? k).join(", ");

function isUniqueViolation(err: unknown): boolean {
  return err instanceof Prisma.PrismaClientKnownRequestError && err.code === "P2002";
}

// The single way an email enters the system. It never calls the provider:
// it decides what the email says and whether it may be sent, and records
// that decision — SKIPPED with a reason when it can't go (no address,
// missing data, opted out), never an exception that would break the CRM
// action that triggered it.
export async function enqueueEmail(input: EnqueueEmailInput, db: Db = prisma): Promise<EnqueueResult> {
  const now = input.now ?? new Date();

  if (input.idempotencyKey) {
    const existing = await db.emailMessage.findUnique({ where: { idempotencyKey: input.idempotencyKey } });
    if (existing) return { message: existing, created: false };
  }

  const template = input.templateId
    ? await db.emailTemplate.findUnique({ where: { id: input.templateId } })
    : input.templateKey
      ? await db.emailTemplate.findUnique({ where: { key: input.templateKey } })
      : null;
  if ((input.templateId || input.templateKey) && !template) throw new Error(`Email template not found: ${input.templateKey ?? input.templateId}`);

  const category = input.category ?? template?.category ?? "TRANSACTIONAL";
  const [settings, vars, realtor] = await Promise.all([
    getEmailSettings(db),
    loadEmailVariables(input.refs, { now, db }),
    input.recipient.type === "REALTOR" && input.refs.realtorId
      ? db.realtor.findUnique({
          where: { id: input.refs.realtorId },
          select: { archivedAt: true, relationshipEmailsEnabled: true, marketingOptIn: true, marketingUnsubscribedAt: true },
        })
      : null,
  ]);
  Object.assign(vars, input.guard?.extraVars ?? {});

  const rendered = renderSubjectAndBody(input.subject ?? template?.subject ?? "", input.body ?? template?.body ?? "", vars);

  let status: EmailMessage["status"];
  let statusReason: string | null = null;

  const eligibility = await checkEligibility(
    {
      category,
      recipientType: input.recipient.type,
      email: input.recipient.email,
      realtor,
      marketingRequiresOptIn: settings.marketingRequiresOptIn,
    },
    db
  );

  if (input.skipReason) {
    status = "SKIPPED";
    statusReason = input.skipReason;
  } else if (!eligibility.ok) {
    status = eligibility.status;
    statusReason = eligibility.reason;
  } else if (!input.draft && rendered.unknown.length > 0) {
    status = "SKIPPED";
    statusReason = `Template uses fields that don't exist: ${rendered.unknown.map((k) => `{{${k}}}`).join(", ")}`;
  } else if (!input.draft && rendered.missing.length > 0) {
    // An automatic email is never sent with blanks or invented values.
    status = "SKIPPED";
    statusReason = `Missing information: ${describeVariables(rendered.missing)}`;
  } else if (input.draft) {
    status = "DRAFT";
  } else if (input.scheduledFor && input.scheduledFor > now) {
    status = "SCHEDULED";
  } else {
    status = "QUEUED";
  }

  const data: Prisma.EmailMessageUncheckedCreateInput = {
    status,
    statusReason,
    mode: input.mode,
    category,
    recipientType: input.recipient.type,
    recipientName: input.recipient.name,
    recipientEmail: input.recipient.email?.trim() || null,
    subject: rendered.subject,
    bodyText: rendered.body,
    templateId: template?.id ?? null,
    automationId: input.automationId ?? null,
    campaignId: input.campaignId ?? null,
    customerId: input.refs.customerId ?? null,
    realtorId: input.refs.realtorId ?? null,
    transactionId: input.refs.transactionId ?? null,
    inspectionId: input.refs.inspectionId ?? null,
    invoiceId: input.refs.invoiceId ?? null,
    reportDeliveryId: input.refs.reportDeliveryId ?? null,
    idempotencyKey: input.idempotencyKey ?? null,
    guard: input.guard ? (input.guard as Prisma.InputJsonValue) : undefined,
    scheduledFor: input.scheduledFor ?? null,
    queuedAt: status === "QUEUED" ? now : null,
    cancelledAt: null,
    createdById: input.createdById ?? null,
  };

  try {
    const message = await db.emailMessage.create({ data });
    return { message, created: true };
  } catch (err) {
    // Two triggers racing on the same event: the loser returns the winner's row.
    if (input.idempotencyKey && isUniqueViolation(err)) {
      const existing = await db.emailMessage.findUnique({ where: { idempotencyKey: input.idempotencyKey } });
      if (existing) return { message: existing, created: false };
    }
    throw err;
  }
}

const PENDING: EmailMessage["status"][] = ["SCHEDULED", "QUEUED"];

// Withdraws emails that haven't gone out yet (e.g. reminders for an
// appointment that just moved). Anything already sending/sent is untouched.
export async function cancelPendingEmails(where: Prisma.EmailMessageWhereInput, reason: string, db: Db = prisma): Promise<number> {
  const { count } = await db.emailMessage.updateMany({
    where: { ...where, status: { in: PENDING } },
    data: { status: "CANCELLED", statusReason: reason, cancelledAt: new Date() },
  });
  return count;
}
