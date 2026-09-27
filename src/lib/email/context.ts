import type { EmailSettings, Prisma, PrismaClient } from "@prisma/client";
import { prisma } from "@/lib/prisma";
import { formatMoney, invoiceTotals } from "@/lib/invoices";
import { realtorDisplayName } from "@/lib/realtors/display";
import { getEmailConfig } from "./config";
import { getEmailSettings } from "./settings";
import type { EmailVariables } from "./variables";

type Db = PrismaClient | Prisma.TransactionClient;

export interface EmailRefs {
  customerId?: string | null;
  realtorId?: string | null;
  transactionId?: string | null;
  inspectionId?: string | null;
  invoiceId?: string | null;
  reportDeliveryId?: string | null;
}

export function formatDateLong(date: Date, timeZone = getEmailConfig().timeZone): string {
  return date.toLocaleDateString("en-US", { timeZone, weekday: "long", month: "long", day: "numeric", year: "numeric" });
}

export function formatTime(date: Date, timeZone = getEmailConfig().timeZone): string {
  return date.toLocaleTimeString("en-US", { timeZone, hour: "numeric", minute: "2-digit" });
}

function formatDateShort(date: Date, timeZone = getEmailConfig().timeZone): string {
  return date.toLocaleDateString("en-US", { timeZone, month: "long", day: "numeric", year: "numeric" });
}

function wholeYearsSince(start: Date, now: Date): number {
  let years = now.getUTCFullYear() - start.getUTCFullYear();
  const beforeAnniversary =
    now.getUTCMonth() < start.getUTCMonth() || (now.getUTCMonth() === start.getUTCMonth() && now.getUTCDate() < start.getUTCDate());
  if (beforeAnniversary) years -= 1;
  return years;
}

export function transactionReference(id: string): string {
  return `T-${id.slice(-6).toUpperCase()}`;
}

export function companyVariables(settings: EmailSettings): EmailVariables {
  return {
    "company.name": settings.companyName,
    "company.phone": settings.companyPhone,
    "company.website": settings.companyWebsite,
    "company.signature": settings.signature || null,
    "company.prepInstructions": settings.inspectionPrepInstructions,
  };
}

// Builds the allow-listed variable map for one email from real records
// only. A value that isn't on file stays null (and shows as missing in
// previews) — nothing is guessed or defaulted here.
export async function loadEmailVariables(refs: EmailRefs, opts: { now?: Date; db?: Db } = {}): Promise<EmailVariables> {
  const db = opts.db ?? prisma;
  const now = opts.now ?? new Date();

  const [settings, customer, realtor, inspection, invoice, delivery, transaction] = await Promise.all([
    getEmailSettings(db),
    refs.customerId ? db.customer.findUnique({ where: { id: refs.customerId } }) : null,
    refs.realtorId ? db.realtor.findUnique({ where: { id: refs.realtorId }, include: { brokerage: true } }) : null,
    refs.inspectionId
      ? db.inspection.findUnique({
          where: { id: refs.inspectionId },
          include: { property: true, inspector: true, inspectionServices: { include: { service: true } } },
        })
      : null,
    refs.invoiceId ? db.invoice.findUnique({ where: { id: refs.invoiceId }, include: { items: true, payments: true } }) : null,
    refs.reportDeliveryId
      ? db.reportDelivery.findUnique({ where: { id: refs.reportDeliveryId }, include: { report: true, version: true } })
      : null,
    refs.transactionId ? db.transaction.findUnique({ where: { id: refs.transactionId }, include: { property: true } }) : null,
  ]);

  const vars: EmailVariables = { ...companyVariables(settings) };

  if (customer) {
    vars["customer.firstName"] = customer.firstName;
    vars["customer.lastName"] = customer.lastName;
    vars["customer.fullName"] = `${customer.firstName} ${customer.lastName}`;
    vars["recipient.firstName"] = customer.firstName;
    vars["recipient.fullName"] = `${customer.firstName} ${customer.lastName}`;
  }

  if (realtor) {
    const first = realtor.preferredName?.trim() || realtor.firstName;
    vars["realtor.firstName"] = first;
    vars["realtor.lastName"] = realtor.lastName;
    vars["realtor.fullName"] = realtorDisplayName(realtor);
    vars["brokerage.name"] = realtor.brokerage?.name ?? null;
    vars["realtor.yearsInCareer"] = realtor.careerStartDate ? String(wholeYearsSince(realtor.careerStartDate, now)) : null;
    vars["realtor.yearsWorkingTogether"] = realtor.relationshipStartDate ? String(wholeYearsSince(realtor.relationshipStartDate, now)) : null;
    if (!customer) {
      vars["recipient.firstName"] = first;
      vars["recipient.fullName"] = realtorDisplayName(realtor);
    }
  }

  const property = inspection?.property ?? transaction?.property ?? null;
  if (property) {
    vars["property.street"] = property.addressLine1;
    vars["property.city"] = property.city;
    vars["property.address"] = `${property.addressLine1}, ${property.city}, ${property.state} ${property.zip}`;
  }

  if (inspection) {
    if (inspection.scheduledAt) {
      vars["inspection.date"] = formatDateLong(inspection.scheduledAt);
      vars["inspection.time"] = formatTime(inspection.scheduledAt);
    }
    const services = inspection.inspectionServices.map((s) => s.service.name);
    vars["inspection.type"] = services.length ? services.join(", ") : null;
    vars["inspector.name"] = inspection.inspector?.name ?? null;
  }

  const transactionId = refs.transactionId ?? inspection?.transactionId ?? invoice?.transactionId ?? null;
  if (transactionId) vars["transaction.number"] = transactionReference(transactionId);

  if (invoice) {
    const totals = invoiceTotals(invoice);
    vars["invoice.number"] = invoice.invoiceNumber;
    vars["invoice.total"] = formatMoney(totals.total);
    vars["invoice.balanceDue"] = formatMoney(totals.balance);
    vars["invoice.dueDate"] = invoice.dueAt ? formatDateShort(invoice.dueAt) : null;
  }

  if (delivery) {
    vars["report.number"] = delivery.report.reportNumber;
    vars["report.version"] = String(delivery.version.versionNumber);
    if (!customer && !realtor) {
      vars["recipient.fullName"] = delivery.recipientName;
      vars["recipient.firstName"] = delivery.recipientName.split(/\s+/)[0] ?? delivery.recipientName;
    }
  }

  return vars;
}
