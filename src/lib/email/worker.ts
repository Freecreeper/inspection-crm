import { createHash, randomUUID } from "node:crypto";
import { Prisma, type EmailMessage, type PrismaClient } from "@prisma/client";
import { prisma } from "@/lib/prisma";
import { getEmailConfig } from "./config";
import { loadEmailVariables } from "./context";
import { checkEligibility, normalizeEmail } from "./eligibility";
import { evaluateGuard, parseGuard } from "./guards";
import { getEmailProvider, type EmailProvider } from "./providers";
import { describeVariables } from "./queue";
import { brandedEmailHtml, renderSubjectAndBody } from "./render";
import { loadEmailBrand } from "@/lib/brand/service";
import { getEmailSettings } from "./settings";
import { oneClickUnsubscribeUrl, unsubscribeUrl } from "./unsubscribe";

type Db = PrismaClient;

export const MAX_ATTEMPTS = 5;
// Minutes to wait before attempt n+1 (n = attempts so far).
const BACKOFF_MINUTES = [1, 5, 15, 60];
// A SENDING row older than this was interrupted mid-send.
const STALE_SENDING_MS = 10 * 60_000;
const REPORT_LINK_DAYS = 30;

export function retryDelayMs(attemptsSoFar: number): number {
  return (BACKOFF_MINUTES[Math.min(attemptsSoFar - 1, BACKOFF_MINUTES.length - 1)] ?? 60) * 60_000;
}

// Claims up to `limit` due emails for this worker. FOR UPDATE SKIP LOCKED
// means two workers can never claim the same row; the status flip to
// SENDING happens in the same statement.
// The worker's own clock is passed in (not Postgres now()): the columns are
// TIMESTAMP without time zone, written by Prisma as UTC, and comparing them
// with now() would go through the database session's time zone.
async function claimBatch(db: Db, limit: number, campaign: "only" | "none", now: Date): Promise<string[]> {
  if (limit <= 0) return [];
  const campaignFilter = campaign === "only" ? Prisma.sql`AND "campaignId" IS NOT NULL` : Prisma.sql`AND "campaignId" IS NULL`;
  const rows = await db.$queryRaw<{ id: string }[]>(Prisma.sql`
    UPDATE "email_messages" SET "status" = 'SENDING', "sendingAt" = ${now}, "attempts" = "attempts" + 1, "updatedAt" = ${now}
    WHERE "id" IN (
      SELECT "id" FROM "email_messages"
      WHERE "status" = 'QUEUED' AND ("nextAttemptAt" IS NULL OR "nextAttemptAt" <= ${now}) ${campaignFilter}
      ORDER BY "queuedAt" ASC NULLS FIRST, "createdAt" ASC
      LIMIT ${limit}
      FOR UPDATE SKIP LOCKED
    )
    RETURNING "id"
  `);
  return rows.map((r) => r.id);
}

// The only place a secure report link is ever created for email: minted
// fresh for this send, its hash written to the delivery, the raw token
// handed straight to the provider and never stored.
async function mintReportLink(message: EmailMessage, db: Db): Promise<string | null> {
  if (!message.reportDeliveryId) return null;
  const raw = randomUUID() + randomUUID();
  await db.reportDelivery.update({
    where: { id: message.reportDeliveryId },
    data: {
      accessTokenHash: createHash("sha256").update(raw).digest("hex"),
      accessExpiresAt: new Date(Date.now() + REPORT_LINK_DAYS * 86_400_000),
    },
  });
  return `${getEmailConfig().baseUrl}/r/${raw}`;
}

function footerFor(message: EmailMessage, mailingAddress: string | null): { text: string; headers: Record<string, string> } {
  if (message.category === "TRANSACTIONAL" || message.recipientType !== "REALTOR" || !message.realtorId) return { text: "", headers: {} };
  const scope = message.category === "MARKETING" ? "marketing" : "relationship";
  const link = unsubscribeUrl(message.realtorId, scope);
  const lines = ["", "—"];
  if (message.category === "MARKETING") {
    lines.push(`You're receiving this because you work with us in real estate. Unsubscribe from marketing email: ${link}`);
    if (mailingAddress) lines.push(mailingAddress);
  } else {
    lines.push(`Prefer fewer emails like this? Manage your preferences: ${link}`);
  }
  return {
    text: lines.join("\n"),
    headers: {
      "List-Unsubscribe": `<${oneClickUnsubscribeUrl(message.realtorId, scope)}>`,
      "List-Unsubscribe-Post": "List-Unsubscribe=One-Click",
    },
  };
}

type Outcome = { status: EmailMessage["status"]; reason?: string };

export async function processClaimedMessage(id: string, provider: EmailProvider, db: Db = prisma, now = new Date()): Promise<Outcome> {
  const message = await db.emailMessage.findUnique({ where: { id }, include: { template: true } });
  if (!message || message.status !== "SENDING") return { status: message?.status ?? "CANCELLED" };

  // A report delivery's status follows its email: it only becomes SENT
  // (and the report DELIVERED) when the email actually goes out.
  const syncReportDelivery = async (status: EmailMessage["status"]) => {
    if (!message.reportDeliveryId || status === "QUEUED") return;
    if (status === "SENT") {
      const delivery = await db.reportDelivery.update({
        where: { id: message.reportDeliveryId },
        data: { status: "SENT", deliveredAt: now },
      });
      // An amendment opened since this was queued stays open.
      await db.inspectionReport.updateMany({ where: { id: delivery.reportId, status: { in: ["FINALIZED", "DELIVERED"] } }, data: { status: "DELIVERED", deliveredAt: now } });
    } else {
      await db.reportDelivery.updateMany({ where: { id: message.reportDeliveryId, status: "PENDING" }, data: { status: "FAILED" } });
    }
  };

  const finish = async (data: Prisma.EmailMessageUpdateInput): Promise<Outcome> => {
    await db.emailMessage.update({ where: { id }, data });
    await syncReportDelivery(data.status as EmailMessage["status"]);
    return { status: data.status as EmailMessage["status"], reason: (data.statusReason as string | undefined) ?? undefined };
  };

  const guard = parseGuard(message.guard);
  const guardResult = await evaluateGuard(guard, db);
  if (!guardResult.ok) return finish({ status: "CANCELLED", statusReason: guardResult.reason, cancelledAt: now });

  const [settings, realtor, customer] = await Promise.all([
    getEmailSettings(db),
    message.realtorId
      ? db.realtor.findUnique({
          where: { id: message.realtorId },
          select: { email: true, archivedAt: true, relationshipEmailsEnabled: true, marketingOptIn: true, marketingUnsubscribedAt: true },
        })
      : null,
    message.customerId && message.recipientType === "CUSTOMER" ? db.customer.findUnique({ where: { id: message.customerId }, select: { email: true } }) : null,
  ]);

  // Automation email goes to the person's address as it is now, not as it
  // was when the email was queued (a corrected address must not keep
  // receiving reminders at the old one). Messages a person addressed by hand,
  // and report deliveries (whose recipient staff chose explicitly), keep the
  // address they were given.
  let recipientEmail = message.recipientEmail;
  if (message.mode !== "MANUAL" && !message.reportDeliveryId) {
    const current = message.recipientType === "CUSTOMER" && customer ? customer.email : message.recipientType === "REALTOR" && realtor ? realtor.email : undefined;
    if (current !== undefined && (current ?? null) !== recipientEmail) {
      recipientEmail = current ?? null;
      await db.emailMessage.update({ where: { id }, data: { recipientEmail } });
    }
  }

  // Preferences and suppressions can change between queueing and sending.
  const eligibility = await checkEligibility(
    {
      category: message.category,
      recipientType: message.recipientType,
      email: recipientEmail,
      realtor: message.recipientType === "REALTOR" ? realtor : null,
      marketingRequiresOptIn: settings.marketingRequiresOptIn,
    },
    db
  );
  if (!eligibility.ok) return finish({ status: eligibility.status, statusReason: eligibility.reason });

  const vars = await loadEmailVariables(
    {
      customerId: message.customerId,
      realtorId: message.realtorId,
      transactionId: message.transactionId,
      inspectionId: message.inspectionId,
      invoiceId: message.invoiceId,
      reportDeliveryId: message.reportDeliveryId,
    },
    { now, db }
  );
  Object.assign(vars, guard.extraVars ?? {});

  // Automatic emails are re-rendered from their template with current data
  // (an inspector assigned since queueing is included). Anything a person
  // wrote or approved is sent exactly as approved — only send-time values
  // (the secure link) are filled in.
  const automaticFromTemplate = message.mode === "AUTOMATIC" && message.template;
  const sourceSubject = automaticFromTemplate ? message.template!.subject : message.subject;
  const sourceBody = automaticFromTemplate ? message.template!.body : message.bodyText;

  // The secure report link replaces the previous one when it's created, so
  // it's created last: only once every other check has passed and the email
  // is about to go out. A retry that's skipped can't kill a link the
  // customer already has.
  const LINK_PLACEHOLDER = "\u0000report-link\u0000";
  const needsLink = sourceBody.includes("report.secureLink");
  if (needsLink && message.reportDeliveryId) vars["report.secureLink"] = LINK_PLACEHOLDER;
  const rendered = renderSubjectAndBody(sourceSubject, sourceBody, vars, { resolveSendTime: true });
  if (rendered.unknown.length || rendered.missing.length) {
    const fields = [...rendered.unknown.map((k) => `{{${k}}}`), describeVariables(rendered.missing)].filter(Boolean).join(", ");
    return finish({ status: "SKIPPED", statusReason: `Missing information at send time: ${fields}` });
  }

  const fromEmail = settings.fromEmail ?? getEmailConfig().defaultFromEmail;
  if (!fromEmail) return finish({ status: "FAILED", failedAt: now, statusReason: "No From address configured (Email settings or EMAIL_FROM)." });

  let mintedLink: string | null = null;
  if (rendered.body.includes(LINK_PLACEHOLDER) || rendered.subject.includes(LINK_PLACEHOLDER)) {
    mintedLink = await mintReportLink(message, db);
    if (!mintedLink) return finish({ status: "SKIPPED", statusReason: "The report link couldn't be created." });
    rendered.body = rendered.body.split(LINK_PLACEHOLDER).join(mintedLink);
    rendered.subject = rendered.subject.split(LINK_PLACEHOLDER).join(mintedLink);
  }

  const config = getEmailConfig();
  const footer = footerFor(message, settings.mailingAddress);
  const text = rendered.body + footer.text;
  const redirected = config.mode === "redirect" && config.redirectTo;
  const stream = message.category === "MARKETING" || message.campaignId ? "broadcast" : "transactional";

  const result = await provider.send({
    from: `${settings.fromName} <${fromEmail}>`,
    to: redirected ? config.redirectTo! : recipientEmail!,
    replyTo: settings.replyTo,
    subject: redirected ? `[Redirected from ${recipientEmail}] ${rendered.subject}` : rendered.subject,
    text,
    html: brandedEmailHtml(text, await loadEmailBrand(db)),
    stream,
    headers: footer.headers,
    metadata: { emailMessageId: message.id },
  });

  if (result.ok) {
    await db.$transaction(async (tx) => {
      const communication = await tx.communication.create({
        data: {
          channel: "Email",
          direction: "OUTBOUND",
          summary: rendered.subject,
          occurredAt: now,
          transactionId: message.transactionId,
          realtorId: message.realtorId,
          customerId: message.customerId,
          inspectionId: message.inspectionId,
        },
      });
      await tx.emailMessage.update({
        where: { id },
        data: {
          status: "SENT",
          sentAt: now,
          statusReason: provider.simulated ? "Simulated — not delivered (EMAIL_DELIVERY_MODE=log)" : redirected ? `Redirected to ${config.redirectTo}` : null,
          provider: provider.name,
          providerMessageId: result.providerMessageId,
          messageStream: stream,
          simulated: provider.simulated,
          // The stored copy never carries the live report link.
          bodyText: automaticFromTemplate ? (mintedLink ? rendered.body.split(mintedLink).join("[secure link — created when sent]") : rendered.body) : message.bodyText,
          subject: rendered.subject,
          communicationId: communication.id,
        },
      });
    });
    await syncReportDelivery("SENT");
    return { status: "SENT" };
  }

  if (result.suppressed && recipientEmail) {
    await db.emailSuppression.upsert({
      where: { email_scope: { email: normalizeEmail(recipientEmail), scope: "ALL" } },
      update: {},
      create: { email: normalizeEmail(recipientEmail), scope: "ALL", reason: result.error, source: "provider-send" },
    });
    return finish({ status: "SUPPRESSED", statusReason: result.error });
  }
  if (result.ambiguous) {
    return finish({
      status: "FAILED",
      failedAt: now,
      statusReason: `${result.error} Not retried automatically in case it was delivered — check the provider, then retry if needed.`,
    });
  }
  if (result.retryable && message.attempts < MAX_ATTEMPTS) {
    return finish({
      status: "QUEUED",
      nextAttemptAt: new Date(now.getTime() + retryDelayMs(message.attempts)),
      statusReason: `Retry ${message.attempts + 1} of ${MAX_ATTEMPTS} scheduled: ${result.error}`,
    });
  }
  return finish({ status: "FAILED", failedAt: now, statusReason: result.error });
}

// A worker that died between claiming and recording a send leaves a row in
// SENDING. We can't know whether the provider got it, so it's marked
// FAILED for a person to check rather than silently re-sent.
export async function recoverInterruptedSends(db: Db = prisma, now = new Date()) {
  return db.emailMessage.updateMany({
    where: { status: "SENDING", sendingAt: { lt: new Date(now.getTime() - STALE_SENDING_MS) } },
    data: {
      status: "FAILED",
      failedAt: now,
      statusReason: "Sending was interrupted. Not retried automatically in case it was delivered — retry if the recipient didn't receive it.",
    },
  });
}

export async function promoteScheduled(db: Db = prisma, now = new Date()) {
  return db.emailMessage.updateMany({
    where: { status: "SCHEDULED", scheduledFor: { lte: now } },
    data: { status: "QUEUED", queuedAt: now },
  });
}

// Sends what's due, a batch at a time. Campaign mail is additionally held
// to the configured per-minute rate so a big campaign can't crowd out
// operational email.
export async function sendDueEmails(opts: { db?: Db; provider?: EmailProvider; now?: Date } = {}) {
  const db = opts.db ?? prisma;
  const provider = opts.provider ?? getEmailProvider();
  const now = opts.now ?? new Date();
  const { batchSize } = getEmailConfig();
  const settings = await getEmailSettings(db);

  const recentCampaignSends = await db.emailMessage.count({
    where: { campaignId: { not: null }, sentAt: { gte: new Date(now.getTime() - 60_000) } },
  });
  const operational = await claimBatch(db, batchSize, "none", now);
  const campaign = await claimBatch(db, Math.min(batchSize, settings.campaignSendsPerMinute - recentCampaignSends), "only", now);

  const outcomes: Outcome[] = [];
  for (const id of [...operational, ...campaign]) {
    try {
      outcomes.push(await processClaimedMessage(id, provider, db, now));
    } catch (err) {
      // An unexpected error on one email never stops the rest of the batch.
      const reason = err instanceof Error ? err.message : String(err);
      console.error(`[email] failed processing ${id}: ${reason}`);
      await db.emailMessage.update({ where: { id }, data: { status: "FAILED", failedAt: now, statusReason: `Internal error: ${reason}` } });
      outcomes.push({ status: "FAILED", reason });
    }
  }
  return outcomes;
}
