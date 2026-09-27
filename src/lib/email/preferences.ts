import type { Prisma, PrismaClient } from "@prisma/client";
import { prisma } from "@/lib/prisma";
import { logActivity } from "@/lib/activity";
import type { UnsubscribeScope } from "./unsubscribe";

type Db = PrismaClient | Prisma.TransactionClient;

// A recipient's own unsubscribe. Marketing and relationship mail are
// separate switches; neither ever touches operational email. Recorded on
// the realtor (so staff see it) and audited.
export async function applyUnsubscribe(realtorId: string, scope: UnsubscribeScope, source: string, db: Db = prisma) {
  const realtor = await db.realtor.findUnique({ where: { id: realtorId } });
  if (!realtor) return false;
  // Mail clients retry one-click unsubscribes; an already-applied one is a no-op.
  const already = scope === "marketing" ? realtor.marketingUnsubscribedAt !== null && !realtor.marketingOptIn : !realtor.relationshipEmailsEnabled;
  if (already) return true;
  const data: Prisma.RealtorUpdateInput =
    scope === "marketing"
      ? { marketingUnsubscribedAt: realtor.marketingUnsubscribedAt ?? new Date(), marketingOptIn: false }
      : { relationshipEmailsEnabled: false };
  await db.realtor.update({ where: { id: realtorId }, data });
  await logActivity(db, {
    action: scope === "marketing" ? "realtor.marketing_unsubscribed" : "realtor.relationship_emails_disabled",
    entityType: "Realtor",
    entityId: realtorId,
    after: { source },
  });
  return true;
}

export async function applyResubscribe(realtorId: string, scope: UnsubscribeScope, source: string, db: Db = prisma) {
  const data: Prisma.RealtorUpdateInput =
    scope === "marketing"
      ? { marketingUnsubscribedAt: null, marketingOptIn: true, marketingOptInSource: source, marketingOptInAt: new Date() }
      : { relationshipEmailsEnabled: true };
  await db.realtor.update({ where: { id: realtorId }, data });
  await logActivity(db, {
    action: scope === "marketing" ? "realtor.marketing_opted_in" : "realtor.relationship_emails_enabled",
    entityType: "Realtor",
    entityId: realtorId,
    after: { source },
  });
}
