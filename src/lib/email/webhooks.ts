import { timingSafeEqual } from "node:crypto";
import { Prisma, type EmailStatus, type PrismaClient, type SuppressionScope } from "@prisma/client";
import { prisma } from "@/lib/prisma";
import { getEmailConfig } from "./config";
import { normalizeEmail } from "./eligibility";

type Db = PrismaClient | Prisma.TransactionClient;

// Postmark sends webhooks with HTTP Basic credentials we configure on its
// side (https://user:pass@host/api/webhooks/postmark). Anything without the
// right credentials is rejected before its payload is even parsed.
export function verifyWebhookAuth(authorization: string | null, config = getEmailConfig()): boolean {
  if (!config.webhookUsername || !config.webhookPassword || !authorization?.startsWith("Basic ")) return false;
  const given = Buffer.from(authorization.slice(6));
  const expected = Buffer.from(Buffer.from(`${config.webhookUsername}:${config.webhookPassword}`).toString("base64"));
  return given.length === expected.length && timingSafeEqual(given, expected);
}

type PostmarkPayload = {
  RecordType?: string;
  MessageID?: string;
  ID?: number | string;
  Type?: string;
  TypeCode?: number;
  Inactive?: boolean;
  Email?: string;
  Recipient?: string;
  Description?: string;
  DeliveredAt?: string;
  BouncedAt?: string;
  ChangedAt?: string;
  SuppressSending?: boolean;
  SuppressionReason?: string;
  MessageStream?: string;
  Metadata?: { emailMessageId?: string };
};

export interface ParsedEvent {
  key: string;
  type: "DELIVERED" | "BOUNCED" | "SOFT_BOUNCE" | "COMPLAINT" | "SUPPRESSION_ON" | "SUPPRESSION_OFF" | "IGNORED";
  providerMessageId: string | null;
  emailMessageId: string | null;
  address: string | null;
  occurredAt: Date;
  description: string | null;
  stream: string | null;
}

const HARD_BOUNCES = new Set(["HardBounce", "BadEmailAddress", "ManuallyDeactivated", "Blocked", "SpamNotification"]);

// Deterministic event keys: the same webhook delivered twice maps to the
// same key and is stored once.
export function parsePostmarkEvent(p: PostmarkPayload): ParsedEvent {
  const base = {
    providerMessageId: p.MessageID ?? null,
    emailMessageId: p.Metadata?.emailMessageId ?? null,
    address: p.Email ?? p.Recipient ?? null,
    description: p.Description ?? p.SuppressionReason ?? null,
    stream: p.MessageStream ?? null,
  };
  const when = (v?: string) => (v && !Number.isNaN(Date.parse(v)) ? new Date(v) : new Date());
  switch (p.RecordType) {
    case "Delivery":
      return { ...base, key: `postmark:delivery:${p.MessageID}`, type: "DELIVERED", occurredAt: when(p.DeliveredAt) };
    case "Bounce": {
      const hard = p.Inactive === true || HARD_BOUNCES.has(p.Type ?? "");
      return { ...base, key: `postmark:bounce:${p.ID ?? p.MessageID}`, type: hard ? "BOUNCED" : "SOFT_BOUNCE", occurredAt: when(p.BouncedAt) };
    }
    case "SpamComplaint":
      return { ...base, key: `postmark:complaint:${p.ID ?? p.MessageID}`, type: "COMPLAINT", occurredAt: when(p.BouncedAt) };
    case "SubscriptionChange":
      return {
        ...base,
        key: `postmark:subscription:${p.MessageID ?? p.Recipient}:${p.ChangedAt}:${p.SuppressSending ? "on" : "off"}`,
        type: p.SuppressSending ? "SUPPRESSION_ON" : "SUPPRESSION_OFF",
        occurredAt: when(p.ChangedAt),
      };
    default:
      return { ...base, key: `postmark:other:${p.RecordType}:${p.MessageID ?? p.ID ?? "unknown"}`, type: "IGNORED", occurredAt: new Date() };
  }
}

// Statuses only ever move forward. A late "Delivery" can't undo a bounce,
// and nothing moves a cancelled or skipped email.
const ADVANCE_FROM: Record<"DELIVERED" | "BOUNCED", EmailStatus[]> = {
  DELIVERED: ["SENDING", "SENT"],
  BOUNCED: ["SENDING", "SENT", "DELIVERED"],
};

async function suppress(address: string, scope: SuppressionScope, reason: string, db: Db) {
  await db.emailSuppression.upsert({
    where: { email_scope: { email: normalizeEmail(address), scope } },
    update: {},
    create: { email: normalizeEmail(address), scope, reason, source: "postmark-webhook" },
  });
}

export async function processPostmarkPayload(payload: PostmarkPayload, db: Db = prisma): Promise<{ duplicate: boolean; event: ParsedEvent }> {
  const event = parsePostmarkEvent(payload);

  const message = event.emailMessageId
    ? await db.emailMessage.findUnique({ where: { id: event.emailMessageId } })
    : event.providerMessageId
      ? await db.emailMessage.findUnique({ where: { providerMessageId: event.providerMessageId } })
      : null;

  try {
    await db.emailEvent.create({
      data: {
        provider: "postmark",
        eventKey: event.key,
        type: event.type,
        occurredAt: event.occurredAt,
        emailMessageId: message?.id ?? null,
        // Only what's useful for support — never message content.
        detail: { recordType: payload.RecordType ?? null, bounceType: payload.Type ?? null, description: event.description, stream: event.stream },
      },
    });
  } catch (err) {
    if (err instanceof Prisma.PrismaClientKnownRequestError && err.code === "P2002") return { duplicate: true, event };
    throw err;
  }

  if (message && (event.type === "DELIVERED" || event.type === "BOUNCED")) {
    await db.emailMessage.updateMany({
      where: { id: message.id, status: { in: ADVANCE_FROM[event.type] } },
      data:
        event.type === "DELIVERED"
          ? { status: "DELIVERED", deliveredAt: event.occurredAt }
          : { status: "BOUNCED", bouncedAt: event.occurredAt, statusReason: `Bounced: ${event.description ?? "hard bounce"}` },
    });
  }
  if (message && event.type === "SOFT_BOUNCE") {
    await db.emailMessage.update({ where: { id: message.id }, data: { statusReason: `Temporary delivery problem: ${event.description ?? "soft bounce"}` } });
  }

  const address = event.address ?? message?.recipientEmail ?? null;
  if (address) {
    if (event.type === "BOUNCED") await suppress(address, "ALL", `Hard bounce: ${event.description ?? "undeliverable"}`, db);
    if (event.type === "COMPLAINT") await suppress(address, "NON_TRANSACTIONAL", "Spam complaint", db);
    if (event.type === "SUPPRESSION_ON") {
      const scope: SuppressionScope = event.stream && event.stream !== getEmailConfig().transactionalStream ? "MARKETING" : "ALL";
      await suppress(address, scope, `Provider suppression: ${event.description ?? "suppressed"}`, db);
    }
    if (event.type === "SUPPRESSION_OFF") {
      await db.emailSuppression.deleteMany({ where: { email: normalizeEmail(address), source: "postmark-webhook" } });
    }
  }

  return { duplicate: false, event };
}
