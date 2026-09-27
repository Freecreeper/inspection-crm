import type { Prisma, PrismaClient } from "@prisma/client";
import { prisma } from "@/lib/prisma";
import { invoiceTotals, isInvoiceCollectible } from "@/lib/invoices";

type Db = PrismaClient | Prisma.TransactionClient;

// Facts that must still be true at the moment of sending. A reminder is
// written ahead of time; if the inspection moved or was cancelled in the
// meantime, the guard stops it instead of emailing a stale time.
export type GuardCheck =
  | { kind: "inspectionScheduled"; inspectionId: string; scheduleVersion: number }
  | { kind: "inspectionCancelled"; inspectionId: string; scheduleVersion: number }
  | { kind: "invoiceCollectible"; invoiceId: string }
  | { kind: "campaignActive"; campaignId: string }
  | { kind: "reportDeliveryValid"; reportDeliveryId: string };

export interface GuardData {
  checks?: GuardCheck[];
  // Values captured when the email was created that can't be re-read later
  // (e.g. the old time on a reschedule notice).
  extraVars?: Record<string, string>;
}

export type GuardResult = { ok: true } | { ok: false; reason: string };

export function parseGuard(raw: unknown): GuardData {
  if (!raw || typeof raw !== "object") return {};
  return raw as GuardData;
}

export async function evaluateGuardCheck(check: GuardCheck, db: Db = prisma): Promise<GuardResult> {
  switch (check.kind) {
    case "inspectionScheduled":
    case "inspectionCancelled": {
      const inspection = await db.inspection.findUnique({
        where: { id: check.inspectionId },
        select: { status: true, scheduleVersion: true, scheduledAt: true },
      });
      if (!inspection) return { ok: false, reason: "Inspection no longer exists" };
      if (inspection.scheduleVersion !== check.scheduleVersion) {
        return { ok: false, reason: "Appointment changed after this email was written" };
      }
      if (check.kind === "inspectionScheduled") {
        if (inspection.status !== "SCHEDULED") return { ok: false, reason: `Inspection is ${inspection.status.toLowerCase().replace("_", " ")}` };
        if (!inspection.scheduledAt) return { ok: false, reason: "Inspection has no scheduled time" };
      } else if (inspection.status !== "CANCELLED") {
        return { ok: false, reason: "Inspection is no longer cancelled" };
      }
      return { ok: true };
    }
    case "invoiceCollectible": {
      const invoice = await db.invoice.findUnique({ where: { id: check.invoiceId }, include: { items: true, payments: true } });
      if (!invoice) return { ok: false, reason: "Invoice no longer exists" };
      const { balance } = invoiceTotals(invoice);
      if (invoice.status === "VOID") return { ok: false, reason: "Invoice was voided" };
      if (!isInvoiceCollectible(invoice.status, balance)) return { ok: false, reason: "Invoice has no balance due" };
      return { ok: true };
    }
    case "campaignActive": {
      const campaign = await db.emailCampaign.findUnique({ where: { id: check.campaignId }, select: { status: true } });
      if (!campaign || campaign.status === "CANCELLED") return { ok: false, reason: "Campaign was cancelled" };
      return { ok: true };
    }
    case "reportDeliveryValid": {
      const delivery = await db.reportDelivery.findUnique({ where: { id: check.reportDeliveryId }, select: { id: true } });
      if (!delivery) return { ok: false, reason: "Report delivery no longer exists" };
      return { ok: true };
    }
  }
}

export async function evaluateGuard(guard: GuardData, db: Db = prisma): Promise<GuardResult> {
  for (const check of guard.checks ?? []) {
    const result = await evaluateGuardCheck(check, db);
    if (!result.ok) return result;
  }
  return { ok: true };
}
