import type { DeliveryRecipientType, EmailRecipientType, Prisma, PrismaClient } from "@prisma/client";
import { prisma } from "@/lib/prisma";
import { enqueueEmail } from "../queue";
import { getAutomation, logAutomationEvent } from "./registry";

type Db = PrismaClient | Prisma.TransactionClient;

const RECIPIENT_TYPE: Record<DeliveryRecipientType, EmailRecipientType> = {
  CUSTOMER: "CUSTOMER",
  SECONDARY_CUSTOMER: "CUSTOMER",
  REALTOR: "REALTOR",
  OTHER_AUTHORIZED: "OTHER",
};

// Emails a secure link for one ReportDelivery — a recipient a staff member
// explicitly chose for one specific, immutable ReportVersion. Nobody is
// ever added here from the transaction's participants, and the link is
// minted by the worker at send time from that delivery (never stored).
export async function onReportDeliveryCreated(deliveryId: string, opts: { actorId?: string | null; db?: Db } = {}) {
  const db = opts.db ?? prisma;
  const auto = await getAutomation("report_ready", db);
  if (!auto.active) return null;

  const delivery = await db.reportDelivery.findUnique({ where: { id: deliveryId }, include: { report: { include: { inspection: true } } } });
  if (!delivery) return null;

  const result = await enqueueEmail(
    {
      mode: auto.sendMode === "REVIEW" ? "REVIEW" : "AUTOMATIC",
      draft: auto.sendMode === "REVIEW",
      templateKey: auto.config.templateKey,
      recipient: { type: RECIPIENT_TYPE[delivery.recipientType], name: delivery.recipientName, email: delivery.recipientEmail },
      refs: {
        reportDeliveryId: delivery.id,
        inspectionId: delivery.report.inspectionId,
        transactionId: delivery.report.inspection.transactionId,
      },
      automationId: auto.row.id,
      idempotencyKey: `report-delivery:${delivery.id}`,
      guard: { checks: [{ kind: "reportDeliveryValid", reportDeliveryId: delivery.id }] },
      createdById: opts.actorId,
    },
    db
  );
  if (result.created) {
    await logAutomationEvent(
      auto.row.id,
      {
        entityType: "ReportDelivery",
        entityId: delivery.id,
        result: result.message.status,
        detail: { emailMessageId: result.message.id, recipient: delivery.recipientName, versionId: delivery.versionId, reason: result.message.statusReason },
        triggeredById: opts.actorId,
      },
      db
    );
  }
  return result;
}
